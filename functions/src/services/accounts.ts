/**
 * Turning a completed sign-in into a BT user and session (ADR-019), and a
 * request's `Authorization` header back into a session.
 *
 * BT owns the user ID: a provider account is looked up by `(provider, subject)`
 * and, on its first sign-in, gets a new BT user linked to it. After that the
 * session BT issues is all an ordinary request needs.
 */
import type { BtSession, UserProfile } from "@bt/domain";
import { entitlementsForTier } from "@bt/domain";
import type {
	IdentityClaims, IdentityProvider, UserRepository,
} from "@bt/ports";
import type { SessionSigner } from "./session.js";

export type AuthDeps = {
	users: UserRepository;
	sessions: SessionSigner;
	/**
	 * The local/CI identity provider that accepts `Bearer dev:<uid>` directly
	 * (`DevIdentityProvider`). Absent in production, where a `dev:` token is just
	 * an invalid session.
	 */
	dev?: IdentityProvider;
	/**
	 * The deployed sign-in (S116): Logto, wherever the Worker's vars name its tenant
	 * (`LOGTO_ENDPOINT`, `LOGTO_APP_ID`). The web app reads `config` to start a sign-in and hands
	 * the ID token it gets back to `POST /api/v1/sign-in` ({@link completeProviderSignIn}).
	 * Absent locally, on previews, and on staging until its own tenant exists.
	 */
	logto?: {
		provider: IdentityProvider;
		config: { endpoint: string;
			appId: string; };
	};
	now?: () => Date;
};

/** A completed sign-in: the token to hand the client, and the session it carries. */
export type SignedIn = {
	token: string;
	session: BtSession;
};

/** The prefix of a local/CI bearer token that signs in as the named uid (ADR-013 local auth). */
export const DEV_TOKEN_PREFIX = "dev:";

/** A sign-in BT refuses because the provider vouched for no email address (S82). */
export class NoEmailError extends Error
{
	constructor(provider: string)
	{
		super(`a ${provider} sign-in carried no email address; every BT account has one`);
		this.name = "NoEmailError";
	}
}

/**
 * Finds or creates the BT user for a provider account and issues their
 * session. `newUid` names a first-time user; it defaults to a random UUID, and
 * the dev provider passes the subject so `dev:test-user` is uid `test-user`.
 *
 * A sign-in with no email is refused before anything is read or written: every
 * account has an email (owner, 2026-10-28: "It should be impossible for an
 * account to have no email."; S82).
 */
export async function signIn(
	deps: AuthDeps,
	claims: IdentityClaims,
	newUid: () => string = () => crypto.randomUUID(),
): Promise<SignedIn>
{
	if (!claims.email.trim()) throw new NoEmailError(claims.provider);
	let uid = await deps.users.getByIdentity(claims.provider, claims.subject);
	let user = uid ? await deps.users.getByUid(uid) : null;
	if (!user)
	{
		uid ??= newUid();
		const now = (deps.now?.() ?? new Date()).toISOString();
		user = {
			uid,
			email: claims.email,
			displayName: null,
			patreonUserId: null,
			role: "member",
			entitlements: entitlementsForTier("none"),
			createdAt: now,
			updatedAt: now,
		};
		await deps.users.upsert(user);
		await deps.users.linkIdentity(claims.provider, claims.subject, uid);
	}
	const token = await deps.sessions.issue({
		uid: user.uid,
		role: user.role,
		entitlements: user.entitlements,
	});
	const session = await deps.sessions.verify(token);
	if (!session) throw new Error("a freshly issued session failed to verify");
	return {
		token,
		session,
	};
}

/**
 * A sign-in hand-off (S116 AC 2): the provider checks `credential` (Logto's ID token) and BT
 * finds or creates the user and issues its own session, through the same {@link signIn} the dev
 * provider uses. Null when this deployment offers no provider sign-in; throws when the
 * credential doesn't verify or carries no email. A `dev:` token never signs in here: it isn't
 * a Logto ID token.
 */
export async function completeProviderSignIn(deps: AuthDeps, credential: string): Promise<SignedIn | null>
{
	if (!deps.logto) return null;
	return signIn(deps, await deps.logto.provider.completeSignIn(credential));
}

/**
 * The session a request carries in `Authorization: Bearer …`, or null when it
 * has none or an invalid one. A BT session token is verified by signature
 * alone. A `dev:` token, only when `deps.dev` is wired, signs in through the
 * dev provider first, so local requests exercise the same link-and-issue path
 * a real sign-in does.
 */
export async function authenticate(request: Request, deps: AuthDeps): Promise<BtSession | null>
{
	const header = request.headers.get("Authorization");
	if (!header?.startsWith("Bearer ")) return null;
	const token = header.slice("Bearer ".length).trim();
	if (deps.dev && token.startsWith(DEV_TOKEN_PREFIX))
	{
		const claims = await deps.dev.completeSignIn(token);
		return (await signIn(deps, claims, () => claims.subject)).session;
	}
	return deps.sessions.verify(token);
}

/**
 * The session a request carries **and** the account it still names, or null.
 * A session verifies by signature alone, so a deleted user's session keeps
 * verifying until it expires (S77); every route that acts for an account goes
 * through this one check rather than repeating the profile read (ADR-025).
 */
export async function authenticateAccount(request: Request, deps: AuthDeps): Promise<{ session: BtSession;
	user: UserProfile } | null>
{
	const session = await authenticate(request, deps);
	const user = session ? await deps.users.getByUid(session.uid) : null;
	return session && user ? {
		session,
		user,
	} : null;
}
