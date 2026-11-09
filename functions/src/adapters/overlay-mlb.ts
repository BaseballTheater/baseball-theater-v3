/**
 * An `MlbStatsClient` that answers schedule days and games from somewhere else first — a dev
 * seed file, or the local store — and asks the client underneath only for what that source
 * doesn't hold (S112). Everything else (standings, players, the replay feeds) goes straight
 * to the client underneath. Two dev paths use it: loading the seed file goes through ingest
 * with the seed as the overlay (`loadDevSeed`), and the local Worker overlays its own store
 * on the bundled fixtures (`createMlbClient`), so a seeded game is never asked of MLB again.
 */
import type {
	GameSnapshot, ScheduleDay, Unversioned,
} from "@bt/domain";
import { datesBetween } from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";

/** Where the overlay looks first; null means "not here, ask the client underneath". */
export interface MlbOverlaySource {
	schedule(date: string): Promise<Unversioned<ScheduleDay> | null>;
	game(gamePk: number): Promise<Unversioned<GameSnapshot> | null>;
}

/** `source` first for days and games, `inner` for the rest and for whatever `source` lacks. */
export function overlayMlbClient(inner: MlbStatsClient, source: MlbOverlaySource): MlbStatsClient
{
	return {
		fetchSchedule: async (date) => await source.schedule(date) ?? inner.fetchSchedule(date),
		fetchScheduleRange: (startDate, endDate) => overlayScheduleRange(inner, source, startDate, endDate),
		fetchGame: async (gamePk) => await source.game(gamePk) ?? inner.fetchGame(gamePk),
		fetchGameContent: (gamePk) => inner.fetchGameContent(gamePk),
		fetchPlayMetrics: (gamePk) => inner.fetchPlayMetrics(gamePk),
		fetchGameGraphContent: (gamePk) => inner.fetchGameGraphContent(gamePk),
		fetchStandings: (date) => inner.fetchStandings(date),
		fetchFinalStandings: (season) => inner.fetchFinalStandings(season),
		fetchSpringStandings: (season, date) => inner.fetchSpringStandings(season, date),
		fetchSeasonCalendar: (season) => inner.fetchSeasonCalendar(season),
		fetchPlayers: (ids) => inner.fetchPlayers(ids),
		fetchGameTimestamps: (gamePk) => inner.fetchGameTimestamps(gamePk),
		fetchGameDiffPatch: (gamePk, start, end) => inner.fetchGameDiffPatch(gamePk, start, end),
	};
}

/**
 * A range of days (S124): the days `source` holds come from it, and `inner` is asked once, for
 * the span from the first day `source` lacks to the last, only when it lacks any.
 */
async function overlayScheduleRange(inner: MlbStatsClient, source: MlbOverlaySource, startDate: string, endDate: string): Promise<Unversioned<ScheduleDay>[]>
{
	const dates = datesBetween(startDate, endDate);
	const held = await Promise.all(dates.map((date) => source.schedule(date)));
	const missing = dates.filter((_date, i) => held[i] === null);
	if (missing.length === 0) return held as Unversioned<ScheduleDay>[];
	const asked = new Map((await inner.fetchScheduleRange(missing[0]!, missing.at(-1)!)).map((day) => [day.date, day]));
	return dates.map((date, i) => held[i] ?? asked.get(date) ?? {
		date,
		games: [],
		fetchedAt: new Date().toISOString(),
		windowMode: "cache",
	});
}

/** A stored, versioned document as the upstream state it was stamped from (ADR-022 re-stamps it). */
function unversioned<T extends { version: number;
	lastChangedAt: string; }>(stored: T): Omit<T, "version" | "lastChangedAt">
{
	const {
		version: _version, lastChangedAt: _changed, ...content
	} = stored;
	return content;
}

/**
 * The local store as an overlay source: in local dev with the bundled fixtures, a day or game
 * the store already holds (from `pnpm db:seed` or the dev seed file) is its own upstream, so
 * a refresh-on-read stamps it unchanged and writes nothing, and no seeded day is replaced by
 * the fixtures' empty answer for a date they don't have.
 */
export function storeOverlay(repos: { schedules: { getByDate(date: string): Promise<ScheduleDay | null> };
	games: { getByPk(gamePk: number): Promise<GameSnapshot | null> }; }): MlbOverlaySource
{
	return {
		schedule: async (date) =>
		{
			const day = await repos.schedules.getByDate(date);
			return day ? unversioned(day) : null;
		},
		game: async (gamePk) =>
		{
			const game = await repos.games.getByPk(gamePk);
			return game ? unversioned(game) : null;
		},
	};
}
