import type { Entitlements, UserProfile } from "@bt/domain";

/**
 * Who a sign-in proved the user to be, as the identity provider sees them
 * (ADR-019). `provider` + `subject` is the provider's own key for the account;
 * BT never uses it as a user ID, only to find the BT `uid` it is linked to.
 */
export interface IdentityClaims
{
	/** Which provider vouched for this account, e.g. `"logto"`, or `"dev"` locally. */
	provider: string;
	/** The provider's stable ID for the account. */
	subject: string;
	/**
	 * Every account has an email (owner, 2026-10-28: "It should be impossible for an account to have no email."; S82).
	 * An adapter whose provider sent none passes an empty string, and BT refuses the sign-in (`signIn`, functions/src/services/accounts.ts).
	 */
	email: string;
	/** Whether the provider confirmed the user controls `email`; relinking by email (ADR-019) trusts only verified addresses. */
	emailVerified: boolean;
	/**
	 * When the provider last made the user prove who they are (Unix seconds), as it signed it:
	 * Logto's ID-token `auth_time`; the dev provider's own sign-in time. Absent when the provider
	 * didn't say. Account deletion's recent-sign-in check reads this, never when BT issued its
	 * session, because the same provider credential can be traded for a new BT session without
	 * a new sign-in (S120).
	 */
	authTime?: number;
}

/**
 * The sign-in side of an identity provider (ADR-019; grows from the old
 * `AuthVerifier`). Called once per sign-in, never per request: after it, BT
 * issues its own session, so ordinary requests touch no provider.
 */
export interface IdentityProvider
{
	/**
	 * Finishes a sign-in from the credential the web app got from the provider,
	 * and throws when it doesn't verify. The local dev provider takes a
	 * `dev:<uid>` token.
	 *
	 * For Logto, the credential is the **ID token**. Only the web `AuthClient`
	 * runs Logto's SDK (ADR-019), and it hands the token to BT once per sign-in.
	 * The ID token is the one to use: it carries `email` and `email_verified`
	 * when the app requests the `email` scope, while a Logto access token for an
	 * API resource carries only `sub`, `aud`, `scope` and `client_id`. The Logto
	 * adapter checks the token's signature against the tenant's JWKS
	 * (`<tenant>/oidc/jwks`), that the issuer is `<tenant>/oidc` and the audience
	 * is the web app's client ID, and that it hasn't expired. `sub` becomes
	 * `subject`. (Logto docs, checked 2026-10-23.)
	 */
	completeSignIn(credential: string): Promise<IdentityClaims>;
}

/** One account as the identity provider lists it. */
export interface IdentityAccount
{
	subject: string;
	/** Every account has an email (owner, 2026-10-28: "It should be impossible for an account to have no email."; S82). */
	email: string;
	disabled: boolean;
}

/**
 * The few account operations BT needs from the provider's admin side
 * (ADR-019: minimal on purpose, so switching providers stays cheap). On Logto
 * these map to the Management API, called by a machine-to-machine app:
 * `GET /api/users`, `PATCH /api/users/{id}/is-suspended` (a suspended user
 * can't sign in), and `DELETE /api/users/{id}`, which can't be undone.
 */
export interface IdentityAdmin
{
	/**
	 * The `IdentityClaims.provider` whose accounts this admin manages (`"logto"`,
	 * locally `"dev"`). Account deletion (S77) calls it only for a user's identity
	 * links with this provider, since a subject means nothing to another one.
	 */
	readonly provider: string;
	listAccounts(): Promise<IdentityAccount[]>;
	/** Blocks further sign-ins; existing BT sessions run out on their own expiry. */
	disableAccount(subject: string): Promise<void>;
	deleteAccount(subject: string): Promise<void>;
}

/**
 * BT's user records. BT owns `uid` (ADR-019): each provider account is linked
 * to one `uid` by `(provider, subject)`, and a user may have several links
 * (e.g. email now, a social login later).
 */
export interface UserRepository
{
	getByUid(uid: string): Promise<UserProfile | null>;
	upsert(user: UserProfile): Promise<void>;
	setEntitlements(uid: string, entitlements: Entitlements): Promise<void>;
	/**
	 * Links a provider account to a BT user. Linking the same account to the same
	 * `uid` again is a no-op; linking it to a different `uid` throws, because one
	 * provider account must never resolve to two BT users.
	 */
	linkIdentity(provider: string, subject: string, uid: string): Promise<void>;
	/** The BT `uid` a provider account is linked to, or null when it isn't linked. */
	getByIdentity(provider: string, subject: string): Promise<string | null>;
	/** The user's profile and identity links for their download (ADR-028); null when neither exists. */
	exportFor(uid: string): Promise<UserDataExport | null>;
	/** Removes the user's profile and every identity link to them; a no-op when there are none (ADR-028). */
	deleteFor(uid: string): Promise<void>;
}

/** What the user repository holds for one user, as their data download shows it. */
export interface UserDataExport
{
	profile: UserProfile | null;
	identities: { provider: string;
		subject: string }[];
}

export interface SecretsProvider
{
	get(name: string): Promise<string | null>;
}
