/**
 * Per-version API usage (ADR-015, S28): one record per `/api/<version>/` request, so retiring
 * a version is decided from evidence (README "API versions": retire only when the log shows
 * no traffic). A record holds the version and the route template only, never a uid, session,
 * email or IP (ADR-028: logs carry no personal fields). It goes to the platform's own logs
 * (Workers logs, the local server's console); no telemetry service.
 */
export interface ApiUsageRecord
{
	version: string;
	/** The matched route as `ApiRoutes` keys it (`GET /api/v1/games/:gamePk`), or `"unmatched"`. */
	route: string;
}

/** Where usage records go: the handler calls it once per versioned request. */
export type ApiUsageLog = (record: ApiUsageRecord) => void;

/** Writes one JSON log line per request, as `{"event":"api_usage","version":"v1","route":"…"}`. */
export const logApiUsage: ApiUsageLog = (record) =>
{
	console.info(JSON.stringify({
		event: "api_usage",
		...record,
	}));
};
