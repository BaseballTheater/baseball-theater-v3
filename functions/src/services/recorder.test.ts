/**
 * Drives both recording paths into a temp dir and reads the result back through
 * the real `FixtureMlbStatsClient`. No network: the raw path gets an injected
 * stub `fetch`, the normalized path a fake `MlbStatsClient` adapter.
 *
 * The asserts are deliberately non-empty rather than non-throwing —
 * `FixtureMlbStatsClient.fetchSchedule`/`fetchStandings` swallow read errors
 * and return empty shells, so "it loaded" would pass against a recorder that
 * wrote nothing.
 */
import {
	mkdtemp, readFile, readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import type {
	AtBat,
	GameSnapshot,
	MediaHighlight,
	PlayerProfile,
	ScheduleDay,
	StandingsSnapshot,
	Unversioned,
} from "@bt/domain";
import type { GameDiffPatchResponse } from "@bt/mlb-api";
import type { MlbStatsClient } from "@bt/ports";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	rawEndpoints, recordNormalized, recordRaw,
} from "./recorder.js";

const FIXTURES = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../fixtures",
);

const DATE = "2024-07-04";
const GAME_PK = 744834;

async function readFixture<T>(name: string): Promise<T>
{
	return JSON.parse(await readFile(path.join(FIXTURES, name), "utf8")) as T;
}

/** Serves committed fixture shapes for any date, so both paths see real data. */
class FakeMlbStatsClient implements MlbStatsClient
{
	async fetchSchedule(date: string): Promise<Unversioned<ScheduleDay>>
	{
		const day = await readFixture<{ games: ScheduleDay["games"] }>(
			"schedule-2024-07-04.json",
		);
		return {
			date,
			games: day.games,
			fetchedAt: "",
			windowMode: "cache",
		};
	}

	async fetchGame(gamePk: number): Promise<GameSnapshot>
	{
		const game = await readFixture<GameSnapshot>("game-744834.json");
		const plays = await readFixture<AtBat[]>("plays-744834.json");
		return {
			...game,
			gamePk,
			plays,
			fetchedAt: "",
			windowMode: "cache",
		};
	}

	async fetchGameContent(): Promise<MediaHighlight[]>
	{
		return [];
	}

	async fetchPlayMetrics(): Promise<null>
	{
		return null;
	}

	async fetchSeasonCalendar(): Promise<null>
	{
		return null;
	}

	async fetchStandings(date: string): Promise<StandingsSnapshot>
	{
		const table = await readFixture<StandingsSnapshot>("standings-2026-09-05.json");
		return {
			...table,
			date,
			fetchedAt: "",
			windowMode: "cache",
		};
	}

	async fetchPlayers(): Promise<PlayerProfile[]>
	{
		return [];
	}

	async fetchGameTimestamps(): Promise<string[]>
	{
		return [];
	}

	async fetchGameDiffPatch(): Promise<GameDiffPatchResponse>
	{
		return [{
			diff: [],
		}];
	}
}

describe("fixture recorder", () =>
{
	it("raw path writes verbatim upstream bytes through the injected fetch", async () =>
	{
		const out = await mkdtemp(path.join(tmpdir(), "bt-raw-"));
		const body = '{"copyright":"  spaced  ","totalGames":1}';
		const seen: string[] = [];
		const fakeFetch = (async (input: string | URL | Request) =>
		{
			seen.push(String(input));
			return new Response(body, {
				status: 200,
			});
		}) as unknown as typeof fetch;

		const written = await recordRaw(
			{
				date: DATE,
				gamePk: GAME_PK,
				playerIds: [1],
			},
			out,
			{
				baseUrl: "",
				fetchImpl: fakeFetch,
			},
		);

		// The seven names packages/mlb-api/src/coverage.test.ts consumes (play metrics since S93).
		expect(written).toEqual([
			`schedule-${DATE}.json`,
			`live-${GAME_PK}.json`,
			`content-${GAME_PK}.json`,
			`timestamps-${GAME_PK}.json`,
			`playmetrics-${GAME_PK}.json`,
			`standings-${DATE}.json`,
			`people-${GAME_PK}.json`,
		]);
		expect(seen).toHaveLength(7);
		expect(await readdir(path.join(out, "raw"))).toHaveLength(7);

		// Byte-exact: not re-stringified through JSON.parse.
		const onDisk = await readFile(path.join(out, "raw", `live-${GAME_PK}.json`), "utf8");
		expect(onDisk).toBe(body);
	});

	it("names every raw endpoint the coverage gate expects", () =>
	{
		const names = rawEndpoints({
			date: DATE,
			gamePk: GAME_PK,
			playerIds: [1],
		}).map(
			(e) => e.name,
		);
		expect(names).toContain(`schedule-${DATE}`);
		expect(names).toContain(`live-${GAME_PK}`);
		expect(names).toContain(`content-${GAME_PK}`);
		expect(names).toContain(`timestamps-${GAME_PK}`);
		expect(names).toContain(`playmetrics-${GAME_PK}`);
		expect(names).toContain(`standings-${DATE}`);
		expect(names).toContain(`people-${GAME_PK}`);
	});

	it("normalized path round-trips non-empty through FixtureMlbStatsClient", async () =>
	{
		const out = await mkdtemp(path.join(tmpdir(), "bt-norm-"));
		await recordNormalized(
			new FakeMlbStatsClient(),
			{
				date: DATE,
				gamePk: GAME_PK,
			},
			out,
		);

		const client = new FixtureMlbStatsClient(out);

		const schedule = await client.fetchSchedule(DATE);
		expect(schedule.games.length).toBeGreaterThan(0);

		const standings = await client.fetchStandings(DATE);
		expect(standings.divisions.length).toBeGreaterThan(0);

		const game = await client.fetchGame(GAME_PK);
		expect(game.gamePk).toBe(GAME_PK);
		// plays-<gamePk>.json must be its own file; fetchGame overwrites inlined plays.
		expect(game.plays.length).toBeGreaterThan(0);
	});

	it("writes plays as a separate file, not inlined into the game", async () =>
	{
		const out = await mkdtemp(path.join(tmpdir(), "bt-plays-"));
		await recordNormalized(
			new FakeMlbStatsClient(),
			{
				date: DATE,
				gamePk: GAME_PK,
			},
			out,
		);

		const written = JSON.parse(
			await readFile(path.join(out, `game-${GAME_PK}.json`), "utf8"),
		) as Record<string, unknown>;
		expect(written.plays).toBeUndefined();

		const plays = JSON.parse(
			await readFile(path.join(out, `plays-${GAME_PK}.json`), "utf8"),
		) as AtBat[];
		expect(plays.length).toBeGreaterThan(0);
	});
});
