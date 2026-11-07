/**
 * Account deletion (ADR-028). Separate from downloading (owner, 2026-10-27:
 * "Deleting and downloading aren't connected"; downloads are
 * `data-downloads.ts`): the deletion accepts only the exact typed phrase and a
 * recent sign-in, then erases the user from every registered store, stored
 * downloads included, and every identity provider at once.
 *
 * The order inside a deletion is what makes a failed attempt retryable with the
 * same session: identity links are read first (the provider accounts need
 * them), the outside providers and other stores go next, `BT database: users`
 * goes last (it holds the links and the account the retry authenticates as),
 * and only after all of that succeeds is the uid logged. Every `deleteFor` is
 * idempotent, so rerunning the steps that already ran is harmless.
 */
import type { BtSession, MeDeleteRequest } from "@bt/domain";
import { ACCOUNT_DELETION_PHRASE } from "@bt/domain";
import type {
	DeletionLog, ExportStore, IdentityAdmin, Mailer, PersonalDataStore, SecretsProvider, UserRepository,
} from "@bt/ports";
import { USERS_STORE } from "./personal-data.js";

/** How recent the sign-in must be to delete (ADR-028's "recent sign-in"). */
export const RECENT_SIGN_IN_SECONDS = 10 * 60;

export type AccountDataDeps = {
	/** Read for the identity links a deletion must reach at each provider. */
	users: UserRepository;
	/** The registry (`personalDataStores`); downloads and deletion reach nothing else. */
	stores: PersonalDataStore[];
	/** One per identity provider BT links accounts from. */
	identityAdmins: IdentityAdmin[];
	deletionLog: DeletionLog;
	/** Where downloads are kept; also in `stores`, so a deletion removes them. */
	downloads: ExportStore;
	/** Sends the download-ready email; also in `stores`. */
	mailer: Mailer;
	/** Where the app's origin for email links is read (`APP_ORIGIN_SECRET`). */
	secrets: SecretsProvider;
	now?: () => Date;
};

/** Why a deletion was refused, as the route answers it. */
export type DeletionRefusal =
	| { status: 403;
		error: "reauth_required" }
	| { status: 400;
		error: "phrase_mismatch" };

function nowSeconds(deps: AccountDataDeps): number
{
	return Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
}

/**
 * Whether the session's sign-in is recent enough to delete: the identity provider's own sign-in
 * time (`authTime`, as the provider signed it) is within {@link RECENT_SIGN_IN_SECONDS}. Not when
 * BT issued the session: a still-valid Logto ID token can be traded for a fresh session with no
 * new emailed code (S120). A session without `authTime` (issued before S120, or a provider that
 * didn't say) is never recent.
 */
function signedInRecently(deps: AccountDataDeps, session: BtSession): boolean
{
	return session.authTime !== undefined && nowSeconds(deps) - session.authTime <= RECENT_SIGN_IN_SECONDS;
}

/**
 * Deletes everything of `session.uid`'s, or says why not. Checks, in order: the
 * sign-in is recent, the phrase is exact. Throws when a store or provider
 * fails, so the same request can be retried.
 */
export async function deleteAccount(deps: AccountDataDeps, session: BtSession, request: MeDeleteRequest): Promise<DeletionRefusal | null>
{
	if (!signedInRecently(deps, session)) return {
		status: 403,
		error: "reauth_required",
	};
	if (request.phrase !== ACCOUNT_DELETION_PHRASE) return {
		status: 400,
		error: "phrase_mismatch",
	};

	const identities = (await deps.users.exportFor(session.uid))?.identities ?? [];
	for (const admin of deps.identityAdmins)
	{
		for (const link of identities.filter((i) => i.provider === admin.provider)) await admin.deleteAccount(link.subject);
	}
	for (const store of deps.stores.filter((s) => s.name !== USERS_STORE)) await store.deleteFor(session.uid);
	for (const store of deps.stores.filter((s) => s.name === USERS_STORE)) await store.deleteFor(session.uid);

	await deps.deletionLog.record({
		uid: session.uid,
		deletedAt: (deps.now?.() ?? new Date()).toISOString(),
	});
	return null;
}

/**
 * After restoring a backup, deletes again every uid the deletion log names, from
 * every registered store (ADR-028: a restore must not bring deleted users back).
 * Returns how many logged uids it re-applied.
 */
export async function reapplyDeletions(deps: Pick<AccountDataDeps, "stores" | "deletionLog">): Promise<number>
{
	const entries = await deps.deletionLog.list();
	for (const { uid } of entries)
	{
		for (const store of deps.stores) await store.deleteFor(uid);
	}
	return entries.length;
}
