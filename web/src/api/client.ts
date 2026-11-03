import type { AccountSettings } from "@bt/domain";
import createClient from "openapi-fetch";
import { getSessionToken } from "../session/token.js";
import type { paths } from "./generated/bt-api.v1.js";
import { markVersionUnsupported } from "./versionNotice.js";

/**
 * The one way the app calls the BT API (ADR-016, S49): an `openapi-fetch`
 * client typed by the paths generated from the published spec. A path that the
 * spec doesn't declare, a missing parameter, or a wrong response type is a
 * compile error, and paths are never assembled by hand.
 *
 * `baseUrl` is the page's own origin (in dev the Vite proxy forwards API calls):
 * `openapi-fetch` builds a `Request`, which needs an absolute URL outside the
 * browser (jsdom tests). The app only runs where `location` exists. `fetch` is
 * looked up per call rather than captured once, so tests can stub the global.
 */
export const api = createClient<paths>({
	baseUrl: location.origin,
	fetch: (request) => globalThis.fetch(request),
});

/**
 * Every call carries the session, when there is one, through this one
 * middleware (S59), so later account calls (settings, S6) inherit it instead
 * of each adding a header. Every answer passes back through it too: a 426 means
 * the API version this app was built against is retired (S28, ADR-015), which
 * raises the reload-to-update notice; the answer itself still reaches its caller.
 */
api.use({
	onRequest({ request })
	{
		const token = getSessionToken();
		if (token) request.headers.set("Authorization", `Bearer ${token}`);
		return request;
	},
	onResponse({ response })
	{
		if (response.status === 426) markVersionUnsupported();
		return response;
	},
});

/**
 * Unwraps an `openapi-fetch` result: the typed body, or an error naming the
 * status and URL. Every route's success body is required, so `data` is set
 * whenever `response.ok`.
 */
function unwrap<T>(result: { data?: T;
	response: Response; }): T
{
	if (!result.response.ok || result.data === undefined)
	{
		throw new Error(`Request failed (${result.response.status}): ${result.response.url}`);
	}
	return result.data;
}

export async function fetchSchedule(date: string)
{
	return unwrap(await api.GET("/api/v1/schedule", {
		params: {
			query: {
				date,
			},
		},
	}));
}

/** The division standings as of `date` (S4); the server's today when it is absent. */
export async function fetchStandings(date?: string)
{
	return unwrap(await api.GET("/api/v1/standings", {
		params: {
			query: date ? {
				date,
			} : {},
		},
	}));
}

/** The day the scoreboard opens on (S111): today in season, the last final in the off-season. */
export async function fetchScoreboardDefaultDate()
{
	return unwrap(await api.GET("/api/v1/scoreboard/default-date"));
}

/** "Best of <date>" (S71): the day's top videos across its games. */
export async function fetchDigest(date: string)
{
	return unwrap(await api.GET("/api/v1/digest", {
		params: {
			query: {
				date,
			},
		},
	}));
}

export async function fetchGame(gamePk: number)
{
	return unwrap(await api.GET("/api/v1/games/{gamePk}", {
		params: {
			path: {
				gamePk,
			},
		},
	}));
}

/**
 * The signed-in account, or null when the server answers 401: to the session,
 * 401 means "signed out", not a failure. Any other non-OK status throws.
 */
export async function fetchMe()
{
	const result = await api.GET("/api/v1/me");
	if (result.response.status === 401) return null;
	return unwrap(result);
}

/** The signed-in account's settings (S6); the house defaults until the account first saves. */
export async function fetchSettings()
{
	return unwrap(await api.GET("/api/v1/me/settings"));
}

/** Saves the whole settings document; the answer is what the server kept (an older `version` is ignored, ADR-022). */
export async function saveSettings(settings: AccountSettings)
{
	return unwrap(await api.PUT("/api/v1/me/settings", {
		body: settings,
	}));
}

/**
 * The account's current data download (S80): its id and when it ages out, or null
 * when there is none or it has expired (404). Expiry is the server's to decide;
 * the client never works out 14 days itself (ADR-025).
 */
export async function fetchCurrentDownload()
{
	const result = await api.GET("/api/v1/me/download");
	if (result.response.status === 404) return null;
	return unwrap(result);
}

/**
 * Asks for a new data download (S80). The server stores it and emails a link to
 * Settings; the answer is the download's id and expiry, never the data. A third
 * request inside any 24 hours is refused (429) with the time the next is allowed.
 */
export async function requestDownload(): Promise<
	| { kind: "ready";
		download: { id: string;
			expiresAt: string; }; }
	| { kind: "limit";
		nextAllowedAt: string; }
>
{
	const result = await api.POST("/api/v1/me/download");
	if (result.response.status === 429)
	{
		// openapi-fetch hands back the parsed `ApiErrorResponse` as `error`.
		return {
			kind: "limit",
			nextAllowedAt: result.error?.nextAllowedAt ?? "",
		};
	}
	return {
		kind: "ready",
		download: unwrap(result),
	};
}

/** The download's file, fetched with the session (a plain link would send none). */
export async function fetchDownloadFile(downloadId: string)
{
	return unwrap(await api.GET("/api/v1/me/download/{downloadId}", {
		params: {
			path: {
				downloadId,
			},
		},
	}));
}

/**
 * Deletes the account and everything BT holds about it, at once (S77, S80). Sends
 * only the typed phrase. A sign-in older than ten minutes is refused (403
 * `reauth_required`), which the caller turns into the re-sign-in prompt; any other
 * failure throws so the caller can offer "Try again".
 */
export async function deleteAccount(phrase: string): Promise<"deleted" | "reauth_required">
{
	const result = await api.POST("/api/v1/me/delete", {
		body: {
			phrase,
		},
	});
	if (result.response.status === 403 && result.error?.error === "reauth_required") return "reauth_required";
	unwrap(result);
	return "deleted";
}

/**
 * Whether the server says this browser's account was just deleted (S87): asked
 * once, signed out, on `/settings`. The server reads its own `HttpOnly` deletion
 * cookie, answers `account_deleted` the one time, and clears it, so the answer is
 * true at most once per deletion ("Until seen once"). Any other answer — plain
 * signed out, or a failure — is false.
 */
export async function fetchAccountDeleted(): Promise<boolean>
{
	const result = await api.GET("/api/v1/me");
	return result.response.status === 401 && result.error?.error === "account_deleted";
}
