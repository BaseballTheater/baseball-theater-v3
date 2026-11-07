/**
 * The web app's one door to Logto (S116; ADR-019): the only module that imports Logto's browser
 * SDK. It sends the browser to Logto's hosted sign-in, turns the callback into the ID token BT
 * trades for its own session, and ends Logto's session on sign-out. Everything else in the app
 * talks to the `Session` (`session.ts`), which calls this.
 *
 * Three choices it makes for the whole app:
 *
 * - **Email.** It asks Logto for the `email` scope, so the ID token carries `email` and
 *   `email_verified`, which BT's sign-in needs (every account has an email, S82).
 * - **A fresh sign-in every time** (`prompt=login`). Without it, Logto would answer a second
 *   sign-in from its own session cookie with no new emailed code, and Settings' "Sign in again"
 *   before deleting an account must prove a recent sign-in with one (ADR-028). With it goes
 *   `max_age=0`, so the ID token carries `auth_time`, the sign-in time BT's deletion checks (S120).
 * - **BT's storage.** The SDK's keys go through `web/src/storage/` (labeled personal in
 *   `STORAGE_KEYS`) rather than its own `localStorage`/`sessionStorage` keys, so sign-out and
 *   account deletion clear them with everything else (ADR-028). The ID token is forgotten as soon
 *   as BT has it.
 *
 * The SDK is loaded only on a deployed site that offers Logto (`SessionProvider` imports this
 * module on demand), so it stays out of the first download (ADR-026).
 */
import type { LogtoConfig, SignInOptions } from "@logto/browser";
import {
	BaseClient, generateCodeChallenge, generateCodeVerifier, generateState, Prompt, UserScope,
} from "@logto/browser";
import { SIGN_IN_CALLBACK_PATH } from "@bt/domain";
import { fetchSignInConfig } from "../api/client.js";
import type { StorageKey } from "../storage/storage.js";
import { readStored, writeStored } from "../storage/storage.js";

/** What the web app needs of Logto for one sign-in round trip. */
export interface AuthClient
{
	/** Sends the browser to Logto's hosted sign-in (a navigation; the page unloads). */
	signIn(): Promise<void>;
	/** At the callback: finishes Logto's sign-in and answers its ID token, then forgets it. */
	finishSignIn(callbackUrl: string): Promise<string>;
	/** Ends Logto's own session (a navigation), coming back to `returnUrl`. */
	signOut(returnUrl: string): Promise<void>;
}

/** The SDK's keys and the `STORAGE_KEYS` entry each one is kept under. */
const LOGTO_KEYS = {
	idToken: "logto.idToken",
	accessToken: "logto.accessToken",
	refreshToken: "logto.refreshToken",
	signInSession: "logto.signInSession",
} as const satisfies Record<string, StorageKey>;

type LogtoKey = keyof typeof LOGTO_KEYS;

/** The SDK's storage interface, over BT's storage module (every key labeled personal). */
export type LogtoStorage = {
	getItem(key: LogtoKey): Promise<string | null>;
	setItem(key: LogtoKey, value: string): Promise<void>;
	removeItem(key: LogtoKey): Promise<void>;
};

export const logtoStorage: LogtoStorage = {
	async getItem(key)
	{
		return readStored(LOGTO_KEYS[key]);
	},
	async setItem(key, value)
	{
		writeStored(LOGTO_KEYS[key], value);
	},
	async removeItem(key)
	{
		writeStored(LOGTO_KEYS[key], null);
	},
};

/** The few SDK calls BT makes; tests hand a stand-in. */
export interface LogtoSdk
{
	signIn(options: SignInOptions): Promise<void>;
	handleSignInCallback(callbackUri: string): Promise<void>;
	getIdToken(): Promise<string | null>;
	clearAllTokens(): Promise<void>;
	signOut(postLogoutRedirectUri?: string): Promise<void>;
}

export type LogtoSdkFactory = (config: LogtoConfig, storage: LogtoStorage) => LogtoSdk;

/** The tenant and app a deployment names (`GET /api/v1/sign-in`). */
export type LogtoTarget = { endpoint: string;
	appId: string; };

/**
 * Asked of Logto with every sign-in: `max_age=0` (S120). OIDC Core says an ID token answering a
 * request with `max_age` MUST include `auth_time`, when the user last signed in, which BT's account
 * deletion checks; `0` asks for a fresh sign-in, as `prompt=login` already does, so the fan sees
 * the same emailed code.
 */
export const SIGN_IN_EXTRA_PARAMS = {
	max_age: "0",
} as const satisfies Record<string, string>;

/** The SDK's config: the tenant, the app, and the `email` scope. */
export function logtoConfig(target: LogtoTarget): LogtoConfig
{
	return {
		endpoint: target.endpoint,
		appId: target.appId,
		scopes: [UserScope.Email],
	};
}

/** Logto's SDK on BT's storage, navigating the whole page as a redirect sign-in does. */
export const createLogtoSdk: LogtoSdkFactory = (config, storage) => new BaseClient(config, {
	navigate: (url) => window.location.assign(url),
	storage,
	generateCodeChallenge,
	generateCodeVerifier,
	generateState,
});

/** An `AuthClient` for `target`, its callback on `origin` (`SIGN_IN_CALLBACK_PATH`). */
export function createAuthClient(target: LogtoTarget, origin: string, makeSdk: LogtoSdkFactory = createLogtoSdk): AuthClient
{
	const sdk = makeSdk(logtoConfig(target), logtoStorage);
	return {
		async signIn()
		{
			await sdk.signIn({
				redirectUri: `${origin}${SIGN_IN_CALLBACK_PATH}`,
				// Always a fresh emailed code, never Logto's remembered session (ADR-028's recent sign-in).
				prompt: Prompt.Login,
				// `max_age` makes OIDC put `auth_time` in the ID token; BT's deletion reads that, not when it issued its own session (S120).
				extraParams: SIGN_IN_EXTRA_PARAMS,
			});
		},
		async finishSignIn(callbackUrl)
		{
			await sdk.handleSignInCallback(callbackUrl);
			const idToken = await sdk.getIdToken();
			// BT's own session takes over from here; Logto's tokens aren't kept.
			await sdk.clearAllTokens();
			if (!idToken) throw new Error("Logto's sign-in finished without an ID token");
			return idToken;
		},
		async signOut(returnUrl)
		{
			await sdk.signOut(returnUrl);
		},
	};
}

let loaded: Promise<AuthClient | null> | undefined;

/**
 * This deployment's `AuthClient`, or null where it offers no Logto sign-in. The tenant and app
 * come from the Worker (`GET /api/v1/sign-in`), so the web app keeps no copy of them; asked once
 * per page load. A failed ask isn't remembered, so the next sign-in tries again.
 */
export function loadAuthClient(): Promise<AuthClient | null>
{
	loaded ??= fetchSignInConfig().then(({ logto }) => (logto ? createAuthClient(logto, location.origin) : null)).catch((error: unknown) =>
	{
		loaded = undefined;
		throw error;
	});
	return loaded;
}
