/**
 * The typed BT API route contract (ADR-014 "the wire boundary").
 *
 * One runtime-enumerable table maps each route to its response type (and, in
 * `ApiRequestBodies`, the routes that take a body to its type). Both the
 * server's sender (`functions/src/handlers/api.ts`) and the client's fetch
 * helper (`web/src/api/client.ts`) consume this same declaration — a route and
 * its response cannot disagree without breaking a typecheck on one end or the
 * other.
 *
 * Response types are named `<DomainType>Response` aliases (ADR-014 "Response
 * aliases — the DTO seam"), not the bare domain type. Each alias is *derived*
 * (`type XResponse = X`) — structurally identical to its source today, so this
 * is not a second, hand-authored shape and does not reopen the "one type
 * source" drift risk. It plants a named seam: the day an internal-only reason
 * forces a domain field to change while the wire needs to stay stable, that
 * divergence lives in the matching `to<DomainType>Response` mapping function
 * (still a passthrough today), not in a rewrite of the route table.
 */
import type { DigestItem } from "./digest.js";
import type { AccountSettings } from "./settings.js";
import type {
	Entitlements, GameSnapshot, Role, ScheduleDay, StandingsSnapshot, UserProfile,
} from "./types.js";

export type ScheduleDayResponse = ScheduleDay;
export type GameSnapshotResponse = GameSnapshot;

/** The division standings as of one day (S4): MLB's tables, projected to BT's shape. */
export type StandingsResponse = StandingsSnapshot;

/** The day the scoreboard opens on (S111): today in season, the last final in the off-season. */
export interface ScoreboardDefaultDateResponse {
	/** The day, `YYYY-MM-DD`. */
	date: string;
}

/** "Best of <date>" (S71): the day's top clips across its games, ranked by `dayDigest`. */
export interface DayDigestResponse {
	/** The day, `YYYY-MM-DD`. */
	date: string;
	/** Best first; empty on a day with no videos yet. */
	items: DigestItem[];
}

/**
 * The signed-in account, for Settings' "Signed in as {email}" (standings-search-settings
 * A3) and for gating UI by entitlement. A projection of `UserProfile`, not the
 * whole record: Patreon IDs and timestamps stay server-side.
 */
export interface MeResponse {
	uid: string;
	/** Every account has an email (owner, 2026-10-28: "It should be impossible for an account to have no email."; S82). */
	email: string;
	role: Role;
	entitlements: Entitlements;
}

/**
 * A stored data download (ADR-028, owner 2026-10-27): its id and when it ages
 * out. Requesting one answers with this, never the data; the file itself is
 * fetched by its id, signed in, while it lasts.
 */
export interface MeDownloadResponse {
	id: string;
	/** ISO time the download stops being fetchable (14 days after it was made; `downloadExpiresAt`). */
	expiresAt: string;
}

/** A download's file: every registered personal data store's export at the time it was made. */
export interface MeDownloadFileResponse extends MeDownloadResponse {
	/** Store name (ADR-028's inventory **Where**) → that store's export; null when it held nothing. */
	stores: Record<string, unknown>;
}

/**
 * The body of an account deletion: the phrase the user typed, which must equal
 * {@link ACCOUNT_DELETION_PHRASE} exactly. Deleting needs no download first
 * (owner, 2026-10-27: "Deleting and downloading aren't connected").
 */
export interface MeDeleteRequest {
	phrase: string;
}

/** A finished deletion. The session that asked no longer resolves to an account. */
export interface MeDeleteResponse {
	deleted: true;
}

/**
 * What a user types to confirm deleting their account (ADR-028: "maximal
 * verification including typing a phrase"). One constant, so S79's
 * confirmation field compares against the same text the server checks.
 */
export const ACCOUNT_DELETION_PHRASE = "delete my account";

/** The signed-in user's settings document (ADR-027); the house defaults until they first save. */
export type SettingsResponse = AccountSettings;

/**
 * A settings write: the whole document with a bumped `version`; an older version is
 * ignored (ADR-022). `gameRowSlot` (S67), `collapseNonFavorites` and `hideScores` (S68), `videoPlayer` (S70)
 * may be left out — each reads as its default — so a page loaded before they shipped can still save.
 */
export type SettingsRequest = Omit<AccountSettings, OptionalSettings> & Partial<Pick<AccountSettings, OptionalSettings>>;

/** Settings added after launch of the document, which a write may leave out (S67, S68, S70). */
type OptionalSettings = "gameRowSlot" | "collapseNonFavorites" | "hideScores" | "videoPlayer";

/** The one error-body shape every 4xx path returns. */
export interface ApiErrorResponse {
	error: string;
	hint?: string;
	/** On a 429 download refusal: the ISO time the next download may be requested (`nextDownloadAllowedAt`). */
	nextAllowedAt?: string;
}

/** Passthrough today — see the module doc for why this indirection exists. */
export function toScheduleDayResponse(day: ScheduleDay): ScheduleDayResponse
{
	return day;
}

/** Passthrough today — see the module doc for why this indirection exists. */
export function toGameSnapshotResponse(game: GameSnapshot): GameSnapshotResponse
{
	return game;
}

/** Picks the wire fields from a stored user; everything else on `UserProfile` stays server-side. */
export function toMeResponse(user: UserProfile): MeResponse
{
	return {
		uid: user.uid,
		email: user.email,
		role: user.role,
		entitlements: user.entitlements,
	};
}

/**
 * How this deployment signs fans in (S116; ADR-019): its Logto tenant's address and the web
 * app's ID, read from the Worker's `vars` (`LOGTO_ENDPOINT`, `LOGTO_APP_ID`) so the web app keeps
 * no second copy. `logto` is null where the Worker offers no Logto sign-in: local dev (which signs
 * in as `dev:`), previews, and staging until its own tenant exists.
 */
export interface SignInConfigResponse {
	logto: {
		/** The tenant's address, e.g. `https://auth.baseball.theater`. */
		endpoint: string;
		/** The single-page app's ID, the ID token's audience. */
		appId: string;
	} | null;
}

/** A sign-in hand-off: the ID token Logto's hosted sign-in gave the web app, sent once. */
export interface SignInRequest {
	idToken: string;
}

/** A finished sign-in: BT's own session token, which the web app sends as `Authorization: Bearer`. */
export interface SignInResponse {
	token: string;
}

/** Registry a route's response-type name is checked against — no unenforced string keys. */
export interface ApiResponseTypes {
	ScheduleDayResponse: ScheduleDayResponse;
	GameSnapshotResponse: GameSnapshotResponse;
	DayDigestResponse: DayDigestResponse;
	StandingsResponse: StandingsResponse;
	ScoreboardDefaultDateResponse: ScoreboardDefaultDateResponse;
	MeResponse: MeResponse;
	MeDownloadResponse: MeDownloadResponse;
	MeDownloadFileResponse: MeDownloadFileResponse;
	MeDeleteResponse: MeDeleteResponse;
	SettingsResponse: SettingsResponse;
	SignInConfigResponse: SignInConfigResponse;
	SignInResponse: SignInResponse;
	ApiErrorResponse: ApiErrorResponse;
}

/**
 * `"<METHOD> <path>"` → the name of its response type in {@link ApiResponseTypes}.
 * A runtime value (not just a type), so S27 can walk it to generate a spec.
 * `satisfies` makes an unknown type-name key a compile error.
 */
export const ApiRoutes = {
	"GET /api/v1/schedule": "ScheduleDayResponse",
	"GET /api/v1/games/:gamePk": "GameSnapshotResponse",
	"GET /api/v1/digest": "DayDigestResponse",
	"GET /api/v1/standings": "StandingsResponse",
	"GET /api/v1/scoreboard/default-date": "ScoreboardDefaultDateResponse",
	"GET /api/v1/me": "MeResponse",
	"POST /api/v1/me/download": "MeDownloadResponse",
	"GET /api/v1/me/download": "MeDownloadResponse",
	"GET /api/v1/me/download/:downloadId": "MeDownloadFileResponse",
	"POST /api/v1/me/delete": "MeDeleteResponse",
	"GET /api/v1/me/settings": "SettingsResponse",
	"PUT /api/v1/me/settings": "SettingsResponse",
	"GET /api/v1/sign-in": "SignInConfigResponse",
	"POST /api/v1/sign-in": "SignInResponse",
} as const satisfies Record<string, keyof ApiResponseTypes>;

export type ApiRoute = keyof typeof ApiRoutes;

/** The response type a given route resolves to, via the registry above. */
export type ApiResponseFor<R extends ApiRoute> = ApiResponseTypes[(typeof ApiRoutes)[R]];

/** Registry a route's request-body type name is checked against, like {@link ApiResponseTypes}. */
export interface ApiRequestTypes {
	MeDeleteRequest: MeDeleteRequest;
	SettingsRequest: SettingsRequest;
	SignInRequest: SignInRequest;
}

/**
 * The routes that take a JSON request body → its type's name in
 * {@link ApiRequestTypes} (S77; S6's settings write reuses it). A runtime value
 * so the spec generator can emit each `requestBody`; a route absent here takes none.
 */
export const ApiRequestBodies = {
	"POST /api/v1/me/delete": "MeDeleteRequest",
	"PUT /api/v1/me/settings": "SettingsRequest",
	"POST /api/v1/sign-in": "SignInRequest",
} as const satisfies Partial<Record<ApiRoute, keyof ApiRequestTypes>>;

export type ApiRouteWithBody = keyof typeof ApiRequestBodies;

/** The request-body type a route takes, via the registry above. */
export type ApiRequestFor<R extends ApiRouteWithBody> = ApiRequestTypes[(typeof ApiRequestBodies)[R]];
