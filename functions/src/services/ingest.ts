import type {
	CadenceParams, GameSnapshot, ScheduleDay, Unversioned,
} from "@bt/domain";
import {
	cacheLifetimeMs, DEFAULT_CADENCE, isGameInActiveWindow, projectGame, stampVersion,
} from "@bt/domain";
import type {
	GameProjectionRepository, GameRepository, MlbStatsClient, ScheduleRepository,
} from "@bt/ports";
import type { RefreshCoordinator } from "./refresh.js";
import { CACHE_TTL_MS, isStale } from "./refresh.js";

export type IngestDeps = {
	mlb: MlbStatsClient;
	schedules: ScheduleRepository;
	games: GameRepository;
	projections: GameProjectionRepository;
	now?: () => Date;
	/**
   * Single-flight + cooldown coordinator for out-of-window refresh-on-read.
   * Owned by the long-lived server context (see `local-server.ts`); when absent
   * the read path refreshes directly, without dedup or cooldown.
   */
	refresh?: RefreshCoordinator;
};

/**
 * Run one upstream refresh for `key`. With a coordinator this is single-flighted
 * and cooldown-gated (it may resolve `undefined` when the cooldown blocks it);
 * without one it just runs `fn`.
 */
function runRefresh<T>(
	deps: IngestDeps,
	key: string,
	fn: () => Promise<T>,
): Promise<T | undefined>
{
	return deps.refresh ? deps.refresh.run(key, fn) : fn();
}

/**
 * Stamp a fetched game against the stored one and store it if it changed
 * (ADR-022): an unchanged poll keeps its version and writes nothing. One
 * snapshot becomes five BT store documents. Callers read the projections,
 * never the upstream tree, so the snapshot upsert stays the raw-ish record and
 * the projection is what the UI binds to. Returns what is now stored.
 */
async function storeGame(deps: IngestDeps, fetched: Unversioned<GameSnapshot>): Promise<GameSnapshot>
{
	const stored = await deps.games.getByPk(fetched.gamePk);
	const snapshot = stampVersion(stored, fetched, fetched.fetchedAt);
	if (stored && snapshot.version === stored.version) return stored;
	await deps.games.upsert(snapshot);
	await deps.projections.upsert(projectGame(snapshot));
	return snapshot;
}

/** The schedule-day counterpart of {@link storeGame}. */
async function storeSchedule(deps: IngestDeps, fetched: Unversioned<ScheduleDay>): Promise<ScheduleDay>
{
	const stored = await deps.schedules.getByDate(fetched.date);
	const day = stampVersion(stored, fetched, fetched.fetchedAt);
	if (stored && day.version === stored.version) return stored;
	await deps.schedules.upsert(day);
	return day;
}

export async function ingestScheduleDay(
	deps: IngestDeps,
	date: string,
): Promise<ScheduleDay>
{
	const now = deps.now?.() ?? new Date();
	const fetched = await deps.mlb.fetchSchedule(date);
	const anyActive = fetched.games.some((g) => isGameInActiveWindow(g, now));
	const day = await storeSchedule(deps, {
		...fetched,
		fetchedAt: now.toISOString(),
		windowMode: anyActive ? "active" : "cache",
	});

	for (const summary of day.games)
	{
		if (!isGameInActiveWindow(summary, now) && summary.status.codedGameState !== "F")
		{
			continue;
		}
		try
		{
			const game = await deps.mlb.fetchGame(summary.gamePk);
			await storeGame(deps, {
				...game,
				fetchedAt: now.toISOString(),
				windowMode: day.windowMode,
			});
		}
		catch
		{
			// Fixture may omit some gamePks; schedule summary still useful.
		}
	}

	return day;
}

/**
 * A cached entity is served as-is unless the caller forces a refresh or it has
 * gone stale: missing, or `windowMode: "cache"` and last checked longer ago than
 * the lifetime that check earned, `cacheLifetimeMs(checkedAt − lastChangedAt)`
 * (ADR-021, S47; the same ladder the edge's `s-maxage` uses), or {@link CACHE_TTL_MS},
 * the floor, without the timestamps. The lifetime is fixed at the check, not at the
 * read: measured from `now` it would always outgrow the time since the check, and
 * nothing would be re-checked before the cap. So each check that finds nothing new
 * lengthens the wait before the next, and one that finds new content resets
 * `lastChangedAt` and drops it back to the floor. An `active`-window entity is never treated as stale
 * here — the cadence loop (S16) owns its freshness.
 *
 * "Last checked" is the later of the stored `fetchedAt` and the coordinator's
 * last refresh of `key`: an unchanged poll writes nothing (ADR-022), so the
 * stored `fetchedAt` stays at the last change, and without the coordinator's
 * time every read past the TTL would pull MLB again.
 */
function needsRefresh(
	deps: IngestDeps,
	key: string,
	entity: { fetchedAt?: string;
		lastChangedAt?: string;
		windowMode?: "active" | "cache" } | null,
	now: Date,
	force: boolean,
): boolean
{
	if (force || !entity) return true;
	if (entity.windowMode !== "cache") return false;
	const refreshedAt = deps.refresh?.lastRefreshedAt(key);
	const fetchedAt = entity.fetchedAt ? Date.parse(entity.fetchedAt) : Number.NaN;
	const checkedAt = refreshedAt !== undefined && !(fetchedAt >= refreshedAt) ? new Date(refreshedAt).toISOString() : entity.fetchedAt;
	const changedAt = entity.lastChangedAt ? Date.parse(entity.lastChangedAt) : Number.NaN;
	const checkedMs = checkedAt ? Date.parse(checkedAt) : Number.NaN;
	const lifetime = Number.isNaN(changedAt) || Number.isNaN(checkedMs) ? CACHE_TTL_MS : cacheLifetimeMs(checkedMs - changedAt);
	return isStale(checkedAt, now, lifetime);
}

export async function getOrRefreshSchedule(
	deps: IngestDeps,
	date: string,
	opts?: { force?: boolean },
): Promise<ScheduleDay>
{
	const now = deps.now?.() ?? new Date();
	const existing = await deps.schedules.getByDate(date);
	if (existing && !needsRefresh(deps, `schedule:${date}`, existing, now, opts?.force ?? false)) return existing;

	const refreshed = await runRefresh(deps, `schedule:${date}`, () =>
		ingestScheduleDay(deps, date),
	);
	return refreshed ?? existing ?? ingestScheduleDay(deps, date);
}

export async function getOrRefreshGame(
	deps: IngestDeps,
	gamePk: number,
	opts?: { force?: boolean },
): Promise<GameSnapshot | null>
{
	const now = deps.now?.() ?? new Date();
	const existing = await deps.games.getByPk(gamePk);
	if (!needsRefresh(deps, `game:${gamePk}`, existing, now, opts?.force ?? false)) return existing;

	const refreshed = await runRefresh(deps, `game:${gamePk}`, async () =>
	{
		try
		{
			const game = await deps.mlb.fetchGame(gamePk);
			return await storeGame(deps, {
				...game,
				fetchedAt: (deps.now?.() ?? new Date()).toISOString(),
				windowMode: "cache",
			});
		}
		catch
		{
			return deps.games.getByPk(gamePk);
		}
	});
	return refreshed ?? existing ?? deps.games.getByPk(gamePk);
}

/** What one cadence tick touched. `skipped` are the games left unfetched. */
export type TickResult = {
	date: string;
	ingested: number[];
	skipped: number[];
};

/**
 * One ADR-002 active-window tick.
 *
 * Selects only the games inside the cadence window at `now` and fetches those.
 * Games outside the window are never fetched — that bound is the whole point:
 * MLB egress scales with concurrent game windows, not with viewers or with the
 * size of the day's schedule.
 */
export async function tickIngest(
	deps: IngestDeps,
	now: Date = deps.now?.() ?? new Date(),
	params: CadenceParams = DEFAULT_CADENCE,
): Promise<TickResult>
{
	const date = now.toISOString().slice(0, 10);
	const fetchedAt = now.toISOString();
	const fetched = await deps.mlb.fetchSchedule(date);

	const active = fetched.games.filter((g) => isGameInActiveWindow(g, now, params));
	await storeSchedule(deps, {
		...fetched,
		fetchedAt,
		windowMode: active.length > 0 ? "active" : "cache",
	});

	const ingested: number[] = [];
	const skipped = fetched.games
		.filter((g) => !isGameInActiveWindow(g, now, params))
		.map((g) => g.gamePk);

	for (const summary of active)
	{
		try
		{
			const game = await deps.mlb.fetchGame(summary.gamePk);
			await storeGame(deps, {
				...game,
				fetchedAt,
				windowMode: "active",
			});
			ingested.push(summary.gamePk);
		}
		catch
		{
			// A single unavailable game must not stop the rest of the tick.
		}
	}

	return {
		date,
		ingested,
		skipped,
	};
}
