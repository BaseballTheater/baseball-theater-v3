import type {
	ApiErrorResponse, ApiResponseFor, ApiRoute, ApiVersionTable, MeDeleteRequest,
} from "@bt/domain";
import type { SettingsRepository } from "@bt/ports";
import {
	API_VERSIONS, DEFAULT_SETTINGS, apiVersionOf, deprecationHeaders, isCalendarMonth, latestScheduleMonth, mlbToday, parseAccountSettings,
	toGameSnapshotResponse, toMeResponse, toScheduleDayResponse,
} from "@bt/domain";
import type { AccountDataDeps } from "../services/account-deletion.js";
import { deleteAccount } from "../services/account-deletion.js";
import type { AuthDeps } from "../services/accounts.js";
import {
	authenticateAccount, completeProviderSignIn, CredentialRefusedError,
} from "../services/accounts.js";
import {
	clearDeletedCookie, hasDeletedCookie, setDeletedCookie,
} from "../services/cookies.js";
import {
	currentDownload, downloadFile, requestDownload,
} from "../services/data-downloads.js";
import type { ApiUsageLog } from "../services/api-usage.js";
import { getDayDigest } from "../services/digest.js";
import { getScheduleMonth } from "../services/schedule-month.js";
import { getDefaultScoreboardDate } from "../services/scoreboard-date.js";
import { getStandings } from "../services/standings.js";
import type { IngestDeps } from "../services/ingest.js";
import { getOrRefreshGame, getOrRefreshSchedule } from "../services/ingest.js";
import { edgeCacheControl } from "./cache-control.js";
import { liveUpgrade } from "./live.js";

export type ApiContext = {
	ingest: IngestDeps;
	auth: AuthDeps;
	/** Each account's settings document (ADR-027, S6). */
	settings: SettingsRepository;
	/** Personal data downloads and deletion (ADR-028, S77, S80). */
	account: AccountDataDeps;
	/**
	 * Hands a live-route WebSocket upgrade to the game's hub (S18; the Worker forwards it to
	 * the `game-hub` Durable Object). Absent where there are no hubs (the Node server).
	 */
	live?: (gamePk: number, request: Request) => Promise<Response>;
	/** Records each versioned request's version and route (S28); absent, nothing is recorded. */
	usage?: ApiUsageLog;
	/** The version lifecycle to enforce; `API_VERSIONS` unless a test supplies its own (S28). */
	versions?: ApiVersionTable;
};

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "Authorization, Content-Type",
	"Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};

function json(status: number, body: unknown): Response
{
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			...CORS_HEADERS,
		},
	});
}

/**
 * Builds a route's typed response. `_route` is not read at runtime — it
 * exists purely so `R` (and therefore `body`'s required type) is inferred
 * from the route-key argument at each call site. `body` is checked against
 * that route's entry in the ApiRoutes table (`@bt/domain`) — sending the
 * wrong shape for a known route fails the `functions` typecheck (S26 check 6
 * proves this).
 */
export function sendJson<R extends ApiRoute>(
	status: number,
	_route: R,
	body: ApiResponseFor<R>,
): Response
{
	return json(status, body);
}

function sendError(status: number, body: ApiErrorResponse): Response
{
	return json(status, body);
}

/**
 * Sets a schedule, schedule month or game response's edge-cache header (S47, ADR-021) from the
 * stored entity's window and last change, judged at ingest's clock. The month route (S124) passes
 * a stand-in entity: `windowMode: "cache"` and the month's last change.
 */
function withCacheControl(response: Response, entity: Parameters<typeof edgeCacheControl>[0], ctx: ApiContext): Response
{
	response.headers.set("Cache-Control", edgeCacheControl(entity, ctx.ingest.now?.() ?? new Date()));
	return response;
}

/** 401 means "signed out" to the web client (S49's API-layer note). */
function unauthorized(): Response
{
	return sendError(401, {
		error: "unauthorized",
	});
}

/** A request's JSON body, or null when it isn't JSON (the routes answer 400). */
async function readJson(request: Request): Promise<unknown>
{
	try
	{
		return await request.json() as unknown;
	}
	catch
	{
		return null;
	}
}

/**
 * The JSON body of `POST /api/v1/me/delete`, or null when it isn't one. A
 * malformed body is the client's mistake, so it answers 400, never a thrown
 * error (which `adapters/node/http.ts` would log with whatever it carried).
 */
async function readDeleteRequest(request: Request): Promise<MeDeleteRequest | null>
{
	const body = await readJson(request);
	if (body === null || typeof body !== "object") return null;
	const { phrase } = body as Record<string, unknown>;
	return typeof phrase === "string" ? {
		phrase,
	} : null;
}

/** The ID token of `POST /api/v1/sign-in`, or null when the body isn't `{ idToken }` (400). */
async function readSignInRequest(request: Request): Promise<string | null>
{
	const body = await readJson(request);
	if (body === null || typeof body !== "object") return null;
	const { idToken } = body as Record<string, unknown>;
	return typeof idToken === "string" && idToken ? idToken : null;
}

function notFound(): Response
{
	return sendError(404, {
		error: "not_found",
	});
}

/**
 * Routes that stream instead of returning one JSON body (S18's live-game hub
 * upgrades to a WebSocket, ADR-020). They have no response type, so they can't
 * be keys of `ApiRoutes`; the route-table check allows a dispatched route
 * outside `ApiRoutes` only if it is named here.
 */
export const STREAMING_ROUTE_EXCEPTIONS = ["GET /api/v1/games/:gamePk/live"] as const satisfies readonly string[];

type StreamingRoute = (typeof STREAMING_ROUTE_EXCEPTIONS)[number];

/** One dispatchable route: its `"<METHOD> <path>"` key, as written in `ApiRoutes`. */
export interface RouteEntry
{
	route: ApiRoute | StreamingRoute;
	/** Per-parameter value patterns; a `:param` without one matches any single segment. */
	params?: Record<string, RegExp>;
	handle: (url: URL, params: Record<string, string>, ctx: ApiContext, request: Request) => Promise<Response>;
}

/**
 * Every route the API dispatches, keyed exactly as in `ApiRoutes`, so the
 * route-table test can compare the two sets (S44). Typing `route` as
 * `ApiRoute | StreamingRoute` also makes an undeclared key a compile error.
 */
export const API_ROUTER: readonly RouteEntry[] = [
	{
		route: "GET /api/v1/schedule",
		handle: async (url, _params, ctx) =>
		{
			const date = url.searchParams.get("date");
			if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
			{
				return sendError(400, {
					error: "date_required",
					hint: "YYYY-MM-DD",
				});
			}
			const force = url.searchParams.get("refresh") === "1";
			const day = await getOrRefreshSchedule(ctx.ingest, date, {
				force,
			});
			return withCacheControl(sendJson(200, "GET /api/v1/schedule", toScheduleDayResponse(day)), day, ctx);
		},
	},
	{
		route: "GET /api/v1/schedule/month/:month",
		handle: async (_url, params, ctx) =>
		{
			// One check of the month (S124 AC 5): its shape, a real month, and none before 1901-04.
			const month = params.month ?? "";
			if (!isCalendarMonth(month))
			{
				return sendError(400, {
					error: "month_invalid",
					hint: "YYYY-MM, 1901-04 or later",
				});
			}
			// Nor after December of next year, by MLB's today (owner, 2026-11-09: "Reject past next year"):
			// MLB can't have published it, and answering it would cost an MLB request and stored rows.
			const latest = latestScheduleMonth(mlbToday(ctx.ingest.now?.() ?? new Date()));
			if (month > latest)
			{
				return sendError(400, {
					error: "month_too_late",
					hint: `YYYY-MM, ${latest} or earlier`,
				});
			}
			const result = await getScheduleMonth(ctx.ingest, month);
			// Cached by when the month's data last changed (ADR-021), never by whether it is past.
			return withCacheControl(sendJson(200, "GET /api/v1/schedule/month/:month", {
				month: result.month,
				days: result.days,
			}), {
				windowMode: "cache",
				lastChangedAt: result.lastChangedAt,
			}, ctx);
		},
	},
	{
		route: "GET /api/v1/digest",
		handle: async (url, _params, ctx) =>
		{
			const date = url.searchParams.get("date");
			if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
			{
				return sendError(400, {
					error: "date_required",
					hint: "YYYY-MM-DD",
				});
			}
			const { day, digest } = await getDayDigest(ctx.ingest, date);
			// The digest is cached as long as its day (S71): live while the day is in its window.
			return withCacheControl(sendJson(200, "GET /api/v1/digest", digest), day, ctx);
		},
	},
	{
		route: "GET /api/v1/standings",
		handle: async (url, _params, ctx) =>
		{
			// The day to show standings for; MLB's today when absent (S128).
			const date = url.searchParams.get("date") ?? undefined;
			if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date))
			{
				return sendError(400, {
					error: "date_invalid",
					hint: "YYYY-MM-DD",
				});
			}
			return sendJson(200, "GET /api/v1/standings", await getStandings(ctx.ingest, date));
		},
	},
	{
		route: "GET /api/v1/scoreboard/default-date",
		handle: async (_url, _params, ctx) =>
		{
			const response = sendJson(200, "GET /api/v1/scoreboard/default-date", await getDefaultScoreboardDate(ctx.ingest));
			// The answer moves once a day at most; five minutes spares MLB a calendar read per visit.
			response.headers.set("Cache-Control", "public, max-age=300");
			return response;
		},
	},
	{
		route: "GET /api/v1/games/:gamePk",
		params: {
			gamePk: /^\d+$/,
		},
		handle: async (url, params, ctx) =>
		{
			const gamePk = Number(params.gamePk);
			const force = url.searchParams.get("refresh") === "1";
			const game = await getOrRefreshGame(ctx.ingest, gamePk, {
				force,
			});
			if (!game)
			{
				return notFound();
			}
			return withCacheControl(sendJson(200, "GET /api/v1/games/:gamePk", toGameSnapshotResponse(game)), game, ctx);
		},
	},
	{
		route: "GET /api/v1/games/:gamePk/live",
		params: {
			gamePk: /^\d+$/,
		},
		handle: (_url, params, ctx, request) => liveUpgrade(Number(params.gamePk), request, ctx),
	},
	{
		route: "GET /api/v1/me",
		handle: async (_url, _params, ctx, request) =>
		{
			// The session proves who is asking; the profile read is for the email, which the session doesn't carry.
			const account = await authenticateAccount(request, ctx.auth);
			// Right after a deletion (S87): signed out with the deletion cookie answers
			// `account_deleted` once, and any /me that sees the cookie clears it, signed in or
			// not (owner, 2026-10-29: "Drop it (clear on any /me)").
			const deleted = hasDeletedCookie(request);
			const response = account
				? sendJson(200, "GET /api/v1/me", toMeResponse(account.user))
				: deleted ? sendError(401, {
					error: "account_deleted",
				}) : unauthorized();
			return deleted ? clearDeletedCookie(response, request) : response;
		},
	},
	{
		route: "POST /api/v1/me/download",
		handle: async (_url, _params, ctx, request) =>
		{
			const account = await authenticateAccount(request, ctx.auth);
			if (!account) return unauthorized();
			const result = await requestDownload(ctx.account, account.user);
			if ("nextAllowedAt" in result)
			{
				return sendError(429, {
					error: "download_limit",
					hint: "two downloads per rolling 24 hours",
					nextAllowedAt: result.nextAllowedAt,
				});
			}
			return sendJson(200, "POST /api/v1/me/download", result.download);
		},
	},
	{
		route: "GET /api/v1/me/download",
		handle: async (_url, _params, ctx, request) =>
		{
			const account = await authenticateAccount(request, ctx.auth);
			if (!account) return unauthorized();
			const download = await currentDownload(ctx.account, account.session.uid);
			return download ? sendJson(200, "GET /api/v1/me/download", download) : notFound();
		},
	},
	{
		route: "GET /api/v1/me/download/:downloadId",
		handle: async (_url, params, ctx, request) =>
		{
			// Owner only: another user's id, an aged-out download and an unknown id all look the same (404).
			const account = await authenticateAccount(request, ctx.auth);
			if (!account) return unauthorized();
			const file = await downloadFile(ctx.account, account.session.uid, params.downloadId ?? "");
			return file ? sendJson(200, "GET /api/v1/me/download/:downloadId", file) : notFound();
		},
	},
	{
		route: "POST /api/v1/me/delete",
		handle: async (_url, _params, ctx, request) =>
		{
			const account = await authenticateAccount(request, ctx.auth);
			if (!account) return unauthorized();
			const body = await readDeleteRequest(request);
			if (!body)
			{
				return sendError(400, {
					error: "invalid_body",
					hint: "{ phrase }",
				});
			}
			const refusal = await deleteAccount(ctx.account, account.session, body);
			if (refusal) return sendError(refusal.status, {
				error: refusal.error,
			});
			// The next visit to Settings says the account is gone, once (S87, A5).
			return setDeletedCookie(sendJson(200, "POST /api/v1/me/delete", {
				deleted: true,
			}), request);
		},
	},
	{
		route: "GET /api/v1/sign-in",
		handle: async (_url, _params, ctx) =>
		{
			// The web app reads its Logto tenant and app ID from here, so it keeps no copy of its own (S116).
			const response = sendJson(200, "GET /api/v1/sign-in", {
				logto: ctx.auth.logto?.config ?? null,
			});
			response.headers.set("Cache-Control", "no-store");
			return response;
		},
	},
	{
		route: "POST /api/v1/sign-in",
		handle: async (_url, _params, ctx, request) =>
		{
			const idToken = await readSignInRequest(request);
			if (!idToken) return sendError(400, {
				error: "invalid_body",
				hint: "{ idToken }",
			});
			let signedIn: Awaited<ReturnType<typeof completeProviderSignIn>>;
			try
			{
				signedIn = await completeProviderSignIn(ctx.auth, idToken);
			}
			catch (error)
			{
				// A token that doesn't verify (or carries no email) is the caller's to fix by signing in again; nothing is logged.
				if (error instanceof CredentialRefusedError) return sendError(401, {
					error: "sign_in_refused",
				});
				// Anything else is BT's (the tenant's keys can't be fetched, the database or the session key failed):
				// not the fan's sign-in being refused (S120). Logged by the error's name only: a message can carry an
				// account's subject (`linkIdentity`), which deletion couldn't follow into the logs (ADR-028).
				console.error("sign-in failed:", error instanceof Error ? error.name : typeof error);
				return sendError(503, {
					error: "sign_in_failed",
				});
			}
			return signedIn ? sendJson(200, "POST /api/v1/sign-in", {
				token: signedIn.token,
			}) : sendError(404, {
				error: "sign_in_unavailable",
			});
		},
	},
	{
		route: "GET /api/v1/me/settings",
		handle: async (_url, _params, ctx, request) =>
		{
			const account = await authenticateAccount(request, ctx.auth);
			if (!account) return unauthorized();
			return sendJson(200, "GET /api/v1/me/settings", await ctx.settings.get(account.session.uid) ?? DEFAULT_SETTINGS);
		},
	},
	{
		route: "PUT /api/v1/me/settings",
		handle: async (_url, _params, ctx, request) =>
		{
			// The account check matters here: a deleted user's still-valid session must not write settings back (ADR-028).
			const account = await authenticateAccount(request, ctx.auth);
			if (!account) return unauthorized();
			const settings = parseAccountSettings(await readJson(request));
			if (!settings)
			{
				return sendError(400, {
					error: "invalid_settings",
					hint: "{ favoriteTeamIds, opensFirst, gameRowSlot?, collapseNonFavorites?, hideScores?, videoPlayer?, version }",
				});
			}
			// Apply-if-newer (ADR-022): an older version is ignored, and the answer is what is stored.
			await ctx.settings.upsert(account.session.uid, settings);
			return sendJson(200, "PUT /api/v1/me/settings", await ctx.settings.get(account.session.uid) ?? settings);
		},
	},
];

/**
 * Matches a request against one route key. Returns the `:param` values, or
 * null when the method, segment count, a literal segment, or a param pattern
 * differs. Path segments are compared raw (no decoding), as the hand-written
 * matcher before S44 did.
 */
function matchRoute(entry: RouteEntry, method: string, pathname: string): Record<string, string> | null
{
	const [routeMethod, routePath = ""] = entry.route.split(" ");
	if (routeMethod !== method) return null;
	const want = routePath.split("/");
	const got = pathname.split("/");
	if (want.length !== got.length) return null;
	const params: Record<string, string> = {};
	for (let i = 0; i < want.length; i++)
	{
		const w = want[i] ?? "";
		const g = got[i] ?? "";
		if (w.startsWith(":"))
		{
			const name = w.slice(1);
			const pattern = entry.params?.[name];
			if (g === "" || (pattern && !pattern.test(g))) return null;
			params[name] = g;
		}
		else if (w !== g)
		{
			return null;
		}
	}
	return params;
}

/**
 * What disagrees between the routes a router dispatches and the declared
 * contract: a dispatched route that is neither declared nor a named streaming
 * exception, or a declared route nothing dispatches. Empty means they agree.
 */
export function routeTableMismatches(
	router: readonly { route: string }[],
	declared: readonly string[],
	streaming: readonly string[],
): string[]
{
	const dispatched = new Set(router.map((r) => r.route));
	const undeclared = [...dispatched]
		.filter((r) => !declared.includes(r) && !streaming.includes(r))
		.map((r) => `dispatched but not in ApiRoutes: ${r}`);
	const undispatched = declared
		.filter((r) => !dispatched.has(r))
		.map((r) => `in ApiRoutes but not dispatched: ${r}`);
	return [...undeclared, ...undispatched];
}

/**
 * The API as a Fetch-standard handler (ADR-017: a Worker's handler is
 * `(Request) => Response`). Node's local server adapts to it in
 * `adapters/node/http.ts`. `/health` is an operational probe for the local
 * server, not part of the `/api` contract, so it sits outside `API_ROUTER`.
 */
export async function handleApiRequest(
	request: Request,
	ctx: ApiContext,
): Promise<Response>
{
	if (request.method === "OPTIONS")
	{
		return new Response(null, {
			status: 204,
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				...CORS_HEADERS,
			},
		});
	}

	const url = new URL(request.url);
	const { pathname } = url;

	if (request.method === "GET" && pathname === "/health")
	{
		return json(200, {
			ok: true,
			service: "bt-functions-local",
		});
	}

	let match: { entry: RouteEntry;
		params: Record<string, string>; } | null = null;
	for (const entry of API_ROUTER)
	{
		const params = matchRoute(entry, request.method, pathname);
		if (params)
		{
			match = {
				entry,
				params,
			};
			break;
		}
	}

	// ADR-015's lifecycle (S28): record the version asked for; a retired version gets 426 and
	// no data; a deprecated one is served with Deprecation and Sunset headers.
	const version = apiVersionOf(pathname);
	const state = version ? (ctx.versions ?? API_VERSIONS)[version] : undefined;
	if (version) ctx.usage?.({
		version,
		route: match?.entry.route ?? "unmatched",
	});
	if (state?.status === "sunset")
	{
		return sendError(426, {
			error: "version_unsupported",
			hint: "This version of the app has been retired; reload to update.",
		});
	}
	if (!match) return notFound();
	const response = await match.entry.handle(url, match.params, ctx, request);
	const headers = state ? deprecationHeaders(state) : {};
	// A WebSocket upgrade (101) can't be re-wrapped; it carries no warning.
	if (Object.keys(headers).length === 0 || response.status === 101) return response;
	const warned = new Response(response.body, response);
	for (const [name, value] of Object.entries(headers)) warned.headers.set(name, value);
	return warned;
}
