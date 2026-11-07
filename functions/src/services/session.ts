/**
 * BT's own signed session (ADR-019). After a sign-in, BT issues a token that
 * carries `uid`, role and entitlements, signed with HMAC-SHA-256 through
 * WebCrypto (`crypto.subtle`, the same API in Node and Workers). Verifying it
 * needs only the key: no Postgres read and no identity-provider call, which is
 * what keeps an ordinary request cheap and keeps Logto's token use near one per
 * sign-in.
 *
 * The token format and HMAC live in `signed-token.ts`, BT's one signing
 * scheme; it is not encrypted, and nothing in it is secret.
 */
import type { BtSession } from "@bt/domain";
import type { SecretsProvider } from "@bt/ports";
import { createSignedTokens } from "./signed-token.js";

export { SESSION_KEY_SECRET } from "./signed-token.js";

/** How long a session lasts. Role or entitlement changes reach a user no later than this. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** What the session's fields are, without the times the signer stamps. */
export type SessionGrant = Omit<BtSession, "issuedAt" | "expiresAt">;

export interface SessionSigner
{
	/** Stamps issue/expiry times on `grant` and returns the signed token. */
	issue(grant: SessionGrant): Promise<string>;
	/** The session a token carries, or null when it is malformed, forged or expired. */
	verify(token: string): Promise<BtSession | null>;
}

/**
 * True when `value` has every session field with the right type. Guards against a validly signed but older-shaped token.
 * `authTime` is optional (S120): a session issued before it still verifies, and deletion treats its sign-in as not recent.
 */
function isSession(value: unknown): value is BtSession
{
	if (value === null || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return typeof v.uid === "string" && (v.role === "member" || v.role === "admin")
		&& v.entitlements !== null && typeof v.entitlements === "object"
		&& typeof v.issuedAt === "number" && typeof v.expiresAt === "number"
		&& (v.authTime === undefined || typeof v.authTime === "number");
}

/**
 * A signer whose key is read once, on first use, from `secrets`. A missing key
 * throws: running without one would mean no request could ever be signed in.
 * `now` is injectable so tests can cross the expiry.
 */
export function createSessionSigner(secrets: SecretsProvider, now: () => Date = () => new Date()): SessionSigner
{
	const tokens = createSignedTokens(secrets, "session");
	const seconds = (): number => Math.floor(now().getTime() / 1000);

	return {
		async issue(grant)
		{
			const issuedAt = seconds();
			const session: BtSession = {
				...grant,
				issuedAt,
				expiresAt: issuedAt + SESSION_TTL_SECONDS,
			};
			return tokens.sign(session);
		},

		async verify(token)
		{
			const claims = await tokens.verify(token);
			if (!isSession(claims) || claims.expiresAt <= seconds()) return null;
			return claims;
		},
	};
}
