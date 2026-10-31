import { CACHE_LIFETIME_FLOOR_MS, cacheLifetimeMs } from "@bt/domain";

/**
 * How long the edge may serve a stale copy while it fetches a fresh one (ADR-021:
 * "`stale-while-revalidate` so viewers never wait on a refresh"). One floor's worth, so
 * the cap's staleness guarantee for late scoring corrections stretches by minutes, not
 * by another lifetime.
 */
export const STALE_WHILE_REVALIDATE_S = CACHE_LIFETIME_FLOOR_MS / 1000;

/**
 * The `Cache-Control` a schedule or game response carries (S47, ADR-021). Workers Cache
 * (`wrangler.jsonc`) stores the response at Cloudflare's edge, tiered, and answers later
 * requests before the Worker runs, for as long as this header allows.
 *
 * Outside the live window (`windowMode: "cache"`) the edge keeps it for
 * `cacheLifetimeMs(now − lastChangedAt)`, the same ladder refresh-on-read uses, so a game
 * unchanged for hours is served for hours without reaching the Worker. Inside the window
 * (or without the timestamps to judge) nothing is stored: live data moves pitch by pitch,
 * and the in-window path is ingest's (ADR-002), so the edge never holds it past the floor.
 */
export function edgeCacheControl(entity: { windowMode?: "active" | "cache";
	lastChangedAt?: string; }, now: Date): string
{
	const changedAt = entity.lastChangedAt ? Date.parse(entity.lastChangedAt) : Number.NaN;
	if (entity.windowMode !== "cache" || Number.isNaN(changedAt)) return "no-store";
	const lifetimeS = cacheLifetimeMs(now.getTime() - changedAt) / 1000;
	return `public, s-maxage=${lifetimeS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`;
}
