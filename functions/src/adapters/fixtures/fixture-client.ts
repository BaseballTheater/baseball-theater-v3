import type {
	GameSnapshot,
	MediaHighlight,
	PlayerProfile,
	ScheduleDay,
	StandingsSnapshot,
	AtBat,
	Unversioned,
} from "@bt/domain";
import { rankHighlightsByImpact } from "@bt/domain";
import type { GameDiffPatchResponse, ReplayPatchEntry } from "@bt/mlb-api";
import { parseGameTimestamps, parseRecordedReplayWalk } from "@bt/mlb-api";
import type { MlbStatsClient } from "@bt/ports";

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
		const now = new Date().toISOString();
		return {
			...data,
			plays,
			highlights: rankHighlightsByImpact(data.highlights ?? []),
			fetchedAt: now,
			windowMode: "cache",
		};
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
