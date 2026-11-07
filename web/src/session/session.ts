/**
 * The session's shape and how components read it (S59). `SessionProvider.tsx`
 * holds the state; this module holds what callers import, so the provider file
 * exports only a component (fast refresh).
 */
import { createContext, useContext } from "react";
import type { fetchMe } from "../api/client.js";

/** The signed-in account, as `/api/v1/me` returns it: uid, email, role and entitlements. */
export type Account = NonNullable<Awaited<ReturnType<typeof fetchMe>>>;

export type SessionState =
	| { status: "loading" }
	| { status: "signedOut" }
	| {
		status: "signedIn";
		account: Account;
	};

export type Session = SessionState & {
	/**
	 * The one way to start signing in; the header's "Sign in" and Settings' "Sign in
	 * again" call it (S60, S79). Where the deployment offers Logto (S116) it sends the
	 * browser to Logto's hosted sign-in, always for a fresh emailed code; locally it is
	 * the dev sign-in as `dev:test-user`; a production build without Logto (previews)
	 * does nothing.
	 */
	signIn(): Promise<void>;
	/**
	 * At the sign-in callback route (S116): hands Logto's ID token to BT once, keeps
	 * BT's session, and answers the path the sign-in started from. Calling it again
	 * for the same callback URL answers the same result rather than a second hand-off.
	 */
	finishSignIn(callbackUrl: string): Promise<string>;
	/** Ends BT's session and clears every personal browser key; where Logto signed in, ends Logto's too. */
	signOut(): void;
};

/** The local dev account (S8's `dev:` bearer): uid `test-user`, email `dev@local.test`. */
export const DEV_SIGN_IN_TOKEN = "dev:test-user";

/**
 * The query-key prefix for server data that belongs to the signed-in account
 * (settings, S6). Signing in invalidates these queries; signing out removes
 * them, so the next user never sees the last one's data.
 */
export const ACCOUNT_QUERY_KEY = ["account"] as const;

export const SIGNED_OUT: SessionState = {
	status: "signedOut",
};

export const SessionContext = createContext<Session | null>(null);

/** The current session. Must be used inside `SessionProvider`. */
export function useSession(): Session
{
	const session = useContext(SessionContext);
	if (!session) throw new Error("useSession must be used inside SessionProvider");
	return session;
}
