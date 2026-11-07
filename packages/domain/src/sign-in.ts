/**
 * Where a Logto sign-in and sign-out send the browser back to (S116; ADR-019). One copy, read
 * by the web app when it starts a sign-in or sign-out and by production's deploy when it
 * registers the same addresses with Logto (`functions/src/deploy/logto.ts`), so the two can't
 * disagree. Logto accepts a redirect only to an address registered for the app, matched exactly,
 * which is why every address here derives from the environment's one origin (`BT_APP_ORIGIN`).
 */

/** The web route that finishes a sign-in: Logto sends the browser here with its code (S116 AC 3). */
export const SIGN_IN_CALLBACK_PATH = "/sign-in/callback";

/**
 * The pages a sign-out may return to. Settings is one because both ways a signed-in fan
 * leaves (its "Sign out" link and account deletion) start there, and signed out it shows the
 * deleted-account page once after a deletion (S87). Everywhere else returns to `/`.
 */
export const SIGN_OUT_RETURN_PATHS = ["/", "/settings"] as const;

/** The addresses Logto must accept for one origin's single-page app. */
export interface LogtoAppUris
{
	redirectUris: string[];
	postLogoutRedirectUris: string[];
}

/** `origin` without a trailing slash, so `https://x/` and `https://x` register the same addresses. */
function trimOrigin(origin: string): string
{
	return origin.replace(/\/+$/, "");
}

/** Every sign-in and sign-out address for the app served at `origin` (e.g. `https://next.baseball.theater`). */
export function logtoAppUris(origin: string): LogtoAppUris
{
	const base = trimOrigin(origin);
	return {
		redirectUris: [`${base}${SIGN_IN_CALLBACK_PATH}`],
		postLogoutRedirectUris: SIGN_OUT_RETURN_PATHS.map((path) => `${base}${path}`),
	};
}

/**
 * Where a sign-out from `pathname` returns: that page when it is one Logto accepts, else `/`.
 * The answer is always one of {@link logtoAppUris}' post-logout addresses.
 */
export function signOutReturnUri(origin: string, pathname: string): string
{
	const path = SIGN_OUT_RETURN_PATHS.find((candidate) => candidate === pathname) ?? "/";
	return `${trimOrigin(origin)}${path}`;
}
