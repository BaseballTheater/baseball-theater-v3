/**
 * Who is using the app (S59). Session state lives in its own provider, not as
 * a TanStack query next to game data (ADR-014 rule 7). When it changes, it
 * invalidates the server data that depends on it.
 *
 * The session is the account `GET /api/v1/me` returns for the stored bearer
 * token (`token.ts`). The server answers 401 when there is no valid session,
 * which reads as signed out.
 *
 * Signing in is Logto's wherever the deployment offers it (S116): the `AuthClient`
 * (the one module that loads Logto's SDK, imported on demand so it stays out of
 * the first download) goes to Logto's hosted sign-in, and the callback route hands
 * the ID token to BT for BT's own session token. Locally it stays the dev sign-in.
 */
import { useQueryClient } from "@tanstack/react-query";
import {
	useEffect, useState, type ReactNode,
} from "react";
import { signOutReturnUri } from "@bt/domain";
import { exchangeIdToken, fetchMe } from "../api/client.js";
import type { AuthClient } from "./AuthClient.js";
import {
	ACCOUNT_QUERY_KEY, DEV_SIGN_IN_TOKEN, SessionContext, SIGNED_OUT, type Session, type SessionState,
} from "./session.js";
import {
	clearPersonalData, readStored, writeStored,
} from "../storage/storage.js";
import { getSessionToken, setSessionToken } from "./token.js";

/**
 * Reads the account for the stored token. A 401 drops the token. If the server
 * can't be reached, this load counts as signed out but the token is kept, so
 * the next load can try again.
 *
 * Null when the stored token changed while the load was under way (S120): its
 * answer is about a token that is no longer the session's, so it neither sets
 * the state nor, on a 401, clears the newer token. On the sign-in callback the
 * startup load runs with the old token and can finish after the hand-off has
 * stored the new one.
 */
async function loadSession(): Promise<SessionState | null>
{
	const token = getSessionToken();
	let next: SessionState = SIGNED_OUT;
	let refused = false;
	try
	{
		const account = await fetchMe();
		if (account) next = {
			status: "signedIn",
			account,
		};
		else refused = true;
	}
	catch
	{
		// Unreachable: signed out for now, the token kept.
	}
	if (getSessionToken() !== token) return null;
	if (refused) setSessionToken(null);
	return next;
}

/**
 * This deployment's `AuthClient`, or null where it offers no Logto sign-in. A production
 * build asks the Worker (`AuthClient.ts`); a development build signs in as `dev:` and never
 * loads Logto's SDK. Tests pass their own.
 */
export type AuthClientLoader = () => Promise<AuthClient | null>;

const deployedAuthClient: AuthClientLoader = async () =>
{
	if (!import.meta.env.PROD) return null;
	const { loadAuthClient } = await import("./AuthClient.js");
	return loadAuthClient();
};

/**
 * Each callback URL's hand-off, so the ID token goes to BT once even when the callback
 * route's effect runs twice (React's development double-run, or a re-render).
 */
const handOffs = new Map<string, Promise<string>>();

export function SessionProvider({ children, authClient = deployedAuthClient }: { children: ReactNode;
	authClient?: AuthClientLoader; })
{
	const queryClient = useQueryClient();
	// With no stored token there is nothing to ask the server, so start signed out.
	const [state, setState] = useState<SessionState>(() => (getSessionToken() ? {
		status: "loading",
	} : SIGNED_OUT));

	useEffect(() =>
	{
		if (!getSessionToken()) return;
		let current = true;
		void loadSession().then((next) =>
		{
			if (current && next) setState(next);
		});
		return () =>
		{
			current = false;
		};
	}, []);

	/** Loads the session for the token just stored and shows it, unless a newer token replaced it meanwhile. */
	async function applySession(): Promise<void>
	{
		const next = await loadSession();
		if (next) setState(next);
	}

	const session: Session = {
		...state,
		async signIn()
		{
			const client = await authClient();
			if (client)
			{
				// The callback returns here once Logto is done (`finishSignIn`).
				writeStored("bt.signInReturnTo", `${location.pathname}${location.search}`);
				await client.signIn();
				return;
			}
			if (import.meta.env.PROD) return;
			setSessionToken(DEV_SIGN_IN_TOKEN);
			await applySession();
			await queryClient.invalidateQueries({
				queryKey: ACCOUNT_QUERY_KEY,
			});
		},
		finishSignIn(callbackUrl)
		{
			let handOff = handOffs.get(callbackUrl);
			if (!handOff)
			{
				handOff = (async () =>
				{
					const client = await authClient();
					if (!client) throw new Error("this deployment offers no Logto sign-in");
					setSessionToken(await exchangeIdToken(await client.finishSignIn(callbackUrl)));
					await applySession();
					await queryClient.invalidateQueries({
						queryKey: ACCOUNT_QUERY_KEY,
					});
					const returnTo = readStored("bt.signInReturnTo") ?? "/";
					writeStored("bt.signInReturnTo", null);
					return returnTo;
				})();
				handOffs.set(callbackUrl, handOff);
			}
			return handOff;
		},
		signOut()
		{
			setSessionToken(null);
			// Every personal browser key, Logto's included, not just the token (ADR-028).
			clearPersonalData();
			setState(SIGNED_OUT);
			queryClient.removeQueries({
				queryKey: ACCOUNT_QUERY_KEY,
			});
			// Then Logto's own session, where Logto signed in: a navigation, back to this page when Logto accepts it.
			void authClient().then((client) => client?.signOut(signOutReturnUri(location.origin, location.pathname))).catch(() =>
			{
				// BT's session is already over; a Logto session left behind only skips the email on the next sign-in, which asks for a fresh code anyway.
			});
		},
	};

	return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
