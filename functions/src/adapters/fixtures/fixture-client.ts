import type {
	GameGraphContent,
	GamePlayMetrics,
	GameSnapshot,
	MediaHighlight,
	PlayerProfile,
	ScheduleDay,
	SeasonCalendar,
	StandingsSnapshot,
	AtBat,
	Unversioned,
} from "@bt/domain";
import { rankHighlightsByImpact } from "@bt/domain";
import type { GameDiffPatchResponse, ReplayPatchEntry } from "@bt/mlb-api";
import {
	parseGameTimestamps, parseGraphContentResponse, parsePlayMetricsResponse, parseRecordedReplayWalk, parseScheduleResponse, parseSeasonsResponse, parseStandingsResponse,
} from "@bt/mlb-api";
import type { MlbStatsClient } from "@bt/ports";
import { withGameExtras } from "../../mappers/game-extras.js";
import { mapGraphContent } from "../../mappers/graph-content.js";
import { mapPlayMetrics } from "../../mappers/play-metrics.js";
import { mapSeasonCalendar } from "../../mappers/season-calendar.js";
import { mapStandings } from "../../mappers/standings.js";

type ScheduleFixture = {
	date: string;
	games: ScheduleDay["games"];
};

type GameFixture = Omit<Unversioned<GameSnapshot>, "fetchedAt" | "windowMode" | "plays"> & {
	plays?: AtBat[];
};

/**
 * Where the committed fixtures come from: files under `fixtures/` (Node, `./mlb.ts`)
 * or JSON bundled into the Worker (`./bundled.ts`, ADR-017 — a Worker has no `node:fs`).
 * Names are relative to `fixtures/` (`game-744834.json`, `raw/timestamps-823823.json`).
 */
export interface FixtureFiles
{
	/** The parsed JSON of `name`; rejects when there is no such fixture. */
	read(name: string): Promise<unknown>;
	/** The top-level fixture names (`fixtures/*`, not `raw/`). */
	list(): Promise<string[]>;
}

/**
 * The MLB client over committed fixtures (local dev and CI never touch the network).
 * Reads go through a `FixtureFiles` source, so the same client serves Node and the Worker.
 */
export class FixtureClient implements MlbStatsClient
{
	/** The recorded diffPatch walk is 5+ MB; the capture command asks for every
   * adjacent pair, so parse it once per gamePk and index the pairs. */
	private readonly diffPatchWalks = new Map<number, Map<string, ReplayPatchEntry>>();

	constructor(private readonly files: FixtureFiles) {}

	private async readJson<T>(name: string): Promise<T>
	{
		return await this.files.read(name) as T;
	}

	async fetchSchedule(date: string): Promise<Unversioned<ScheduleDay>>
	{
		const file = `schedule-${date}.json`;
		try
		{
			const data = await this.readJson<ScheduleFixture>(file);
			const now = new Date().toISOString();
			return {
				date: data.date,
				games: data.games,
				fetchedAt: now,
				windowMode: "cache",
			};
		}
		catch
		{
			return {
				date,
				games: [],
				fetchedAt: new Date().toISOString(),
				windowMode: "cache",
			};
		}
	}

	async fetchGame(gamePk: number): Promise<Unversioned<GameSnapshot>>
	{
		const file = `game-${gamePk}.json`;
		const data = await this.readJson<GameFixture>(file);
		const plays = await this.loadPlays(gamePk);
		const playMetrics = await this.fetchPlayMetrics(gamePk);
		const graph = await this.fetchGameGraphContent(gamePk);
		const now = new Date().toISOString();
		return withGameExtras({
			...data,
			plays,
			highlights: data.highlights ?? [],
			fetchedAt: now,
			windowMode: "cache" as const,
		}, playMetrics, graph);
	}

	/** Highlights are already ranked onto the committed game fixture. */
	async fetchGameContent(gamePk: number): Promise<MediaHighlight[]>
	{
		const file = `game-${gamePk}.json`;
		try
		{
			const data = await this.readJson<GameFixture>(file);
			return rankHighlightsByImpact(data.highlights ?? []);
		}
		catch
		{
			return [];
		}
	}

	/**
   * Missing-date behaviour matches `fetchSchedule`: an empty table rather than
   * a throw, so a local day with no committed fixture still renders.
   */
	async fetchStandings(date: string): Promise<StandingsSnapshot>
	{
		const file = `standings-${date}.json`;
		try
		{
			const data = await this.readJson<StandingsSnapshot>(file);
			return {
				...data,
				fetchedAt: new Date().toISOString(),
				windowMode: "cache",
			};
		}
		catch
		{
			return {
				date,
				divisions: [],
				fetchedAt: new Date().toISOString(),
				windowMode: "cache",
			};
		}
	}

	/**
   * The committed player fixtures are keyed by the game they were recorded
   * from, so this scans them and returns the requested ids in the order asked.
   */
	async fetchPlayers(ids: number[]): Promise<PlayerProfile[]>
	{
		const players = await this.loadPlayers();
		const byId = new Map(players.map((player) => [player.playerId, player]));
		return ids
			.map((id) => byId.get(id))
			.filter((player): player is PlayerProfile => player !== undefined);
	}

	private async loadPlayers(): Promise<PlayerProfile[]>
	{
		const dir = await this.files.list().catch(() => [] as string[]);
		const files = dir.filter(
			(name) => name.startsWith("players-") && name.endsWith(".json"),
		);
		const loaded = await Promise.all(
			files.map((name) =>
				this.readJson<PlayerProfile[]>(name).catch(() => []),
			),
		);
		return loaded.flat();
	}

	/**
	 * The recorded GraphQL game content, `fixtures/raw/graphql-content-<gamePk>.json` (S94),
	 * mapped; null for a game with no recording, as the HTTP client answers when the call fails.
	 */
	async fetchGameGraphContent(gamePk: number): Promise<GameGraphContent | null>
	{
		try
		{
			return mapGraphContent(parseGraphContentResponse(await this.readJson(`raw/graphql-content-${gamePk}.json`)), gamePk);
		}
		catch
		{
			return null;
		}
	}

	/**
	 * The recorded play-metrics feed, `fixtures/raw/playmetrics-<gamePk>.json` (S93), mapped;
	 * null for a game with no recording, as the HTTP client answers when the feed fails.
	 */
	async fetchPlayMetrics(gamePk: number): Promise<GamePlayMetrics | null>
	{
		try
		{
			return mapPlayMetrics(parsePlayMetricsResponse(await this.readJson(`raw/playmetrics-${gamePk}.json`)));
		}
		catch
		{
			return null;
		}
	}

	/**
	 * A season's final table from the recording `fixtures/raw/standings-<season>-final.json`
	 * (S128), mapped as the HTTP client maps it; an empty table for a season with no recording.
	 */
	async fetchFinalStandings(season: number): Promise<StandingsSnapshot>
	{
		return this.recordedStandings(`raw/standings-${season}-final.json`, `${season}-12-31`);
	}

	/**
	 * A season's spring table from `fixtures/raw/standings-<season>-spring.json` (S128): one
	 * recording per season, served for every spring day; an empty table for a season with none.
	 */
	async fetchSpringStandings(season: number, date: string): Promise<StandingsSnapshot>
	{
		return this.recordedStandings(`raw/standings-${season}-spring.json`, date);
	}

	private async recordedStandings(file: string, date: string): Promise<StandingsSnapshot>
	{
		let records: unknown;
		try
		{
			records = await this.readJson(file);
		}
		catch
		{
			records = {
				records: [],
			};
		}
		return mapStandings(parseStandingsResponse(records), date);
	}

	/**
	 * The recorded calendar and World Series, `fixtures/raw/seasons-<season>.json` and
	 * `worldseries-<season>.json` (S111), mapped as the HTTP client maps them; null for a
	 * season with no recording, as MLB answers for one it hasn't published.
	 */
	async fetchSeasonCalendar(season: number): Promise<SeasonCalendar | null>
	{
		try
		{
			const [seasons, worldSeries] = await Promise.all([
				this.readJson(`raw/seasons-${season}.json`),
				this.readJson(`raw/worldseries-${season}.json`),
			]);
			return mapSeasonCalendar(parseSeasonsResponse(seasons), parseScheduleResponse(worldSeries));
		}
		catch
		{
			return null;
		}
	}

	/** Recorded timecode list from `fixtures/raw/timestamps-<gamePk>.json`. */
	async fetchGameTimestamps(gamePk: number): Promise<string[]>
	{
		const file = `raw/timestamps-${gamePk}.json`;
		return parseGameTimestamps(await this.readJson(file));
	}

	/**
   * The recorded walk in `fixtures/raw/diffpatch-<gamePk>.json` holds one entry
   * per adjacent timecode pair, so a lookup by `(start, end)` reproduces what
   * `/feed/live/diffPatch` returned. An unknown pair means no change.
   */
	async fetchGameDiffPatch(
		gamePk: number,
		startTimecode: string,
		endTimecode: string,
	): Promise<GameDiffPatchResponse>
	{
		let byPair = this.diffPatchWalks.get(gamePk);
		if (!byPair)
		{
			const file = `raw/diffpatch-${gamePk}.json`;
			const walk = parseRecordedReplayWalk(await this.readJson(file));
			byPair = new Map(
				walk.map((step) => [`${step.startTimecode}:${step.endTimecode}`, step]),
			);
			this.diffPatchWalks.set(gamePk, byPair);
		}
		const entry = byPair.get(`${startTimecode}:${endTimecode}`);
		return [{
			diff: entry?.diff ?? [],
		}];
	}

	private async loadPlays(gamePk: number): Promise<AtBat[]>
	{
		const file = `plays-${gamePk}.json`;
		try
		{
			return await this.readJson<AtBat[]>(file);
		}
		catch
		{
			return [];
		}
	}
}
