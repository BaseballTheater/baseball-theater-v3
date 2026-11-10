/**
 * ADR-002 cadence tick, on an injected clock with a counting fake client.
 *
 * The load-bearing assertion is the negative one: a game outside the window is
 * never fetched. Egress has to scale with concurrent game windows, not with the
 * size of the day's schedule, so "we fetched it and ignored the result" is a
 * failure even though the store would look identical.
 */
import {
	describe, expect, it,
} from "vitest";
import type {
	GameSnapshot,
	MediaHighlight,
	Unversioned,
	PlayerProfile,
	ScheduleDay,
	StandingsSnapshot,
} from "@bt/domain";
import { datesBetween } from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository,
	InMemoryGameRepository,
	InMemoryScheduleRepository,
} from "../adapters/memory/repos.js";
import { tickIngest } from "./ingest.js";

const NOW = new Date("2024-07-04T23:00:00.000Z");
const IN_WINDOW = 744834;
const OUT_OF_WINDOW = 745001;

/** Counts fetchGame per gamePk so "never fetched" is observable. */
class CountingMlbClient implements MlbStatsClient
{
	readonly gameCalls: number[] = [];
	private readonly fixtures = new FixtureMlbStatsClient();

	constructor(private readonly day: Unversioned<ScheduleDay>) {}

	async fetchSchedule(): Promise<Unversioned<ScheduleDay>>
	{
		return this.day;
	}

	async fetchScheduleRange(startDate: string, endDate: string): Promise<Unversioned<ScheduleDay>[]>
	{
		return datesBetween(startDate, endDate).map((date) => ({
			...this.day,
			date,
		}));
	}

	async fetchGame(gamePk: number): Promise<Unversioned<GameSnapshot>>
	{
		this.gameCalls.push(gamePk);
		const game = await this.fixtures.fetchGame(IN_WINDOW);
		return {
			...game,
			gamePk,
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

	async fetchGameGraphContent(): Promise<null>
	{
		return null;
	}

	async fetchSeasonCalendar(): Promise<null>
	{
		return null;
	}

	async fetchStandings(): Promise<StandingsSnapshot>
	{
		return {
			date: "",
			divisions: [],
			fetchedAt: "",
			windowMode: "cache",
		};
	}

	async fetchFinalStandings(): Promise<StandingsSnapshot>
	{
		return this.fetchStandings();
	}

	async fetchSpringStandings(): Promise<StandingsSnapshot>
	{
		return this.fetchStandings();
	}

	async fetchPlayers(): Promise<PlayerProfile[]>
	{
		return [];
	}

	fetchGameTimestamps(gamePk: number): Promise<string[]>
	{
		return this.fixtures.fetchGameTimestamps(gamePk);
	}

	fetchGameDiffPatch(
		gamePk: number,
		startTimecode: string,
		endTimecode: string,
	): ReturnType<MlbStatsClient["fetchGameDiffPatch"]>
	{
		return this.fixtures.fetchGameDiffPatch(gamePk, startTimecode, endTimecode);
	}

	callsFor(gamePk: number): number
	{
		return this.gameCalls.filter((pk) => pk === gamePk).length;
	}
}

/** One live game and one that finished long before `NOW`. */
async function scheduleDay(): Promise<Unversioned<ScheduleDay>>
{
	const day = await new FixtureMlbStatsClient().fetchSchedule("2024-07-04");
	const [first, second] = day.games;
	return {
		...day,
		games: [
			{
				...first!,
				gamePk: IN_WINDOW,
				officialDate: "2024-07-04",
				// Scheduled, not live: selection must come from the real start time.
				gameDate: "2024-07-04T22:30:00.000Z",
				status: {
					...first!.status,
					codedGameState: "S",
				},
			},
			{
				...second!,
				gamePk: OUT_OF_WINDOW,
				officialDate: "2024-07-04",
				gameDate: "2024-07-04T02:00:00.000Z",
				status: {
					...second!.status,
					codedGameState: "S",
				},
			},
		],
	};
}

function deps(mlb: MlbStatsClient)
{
	return {
		mlb,
		schedules: new InMemoryScheduleRepository(),
		games: new InMemoryGameRepository(),
		projections: new InMemoryGameProjectionRepository(),
	};
}

describe("tickIngest — ADR-002 active window", () =>
{
	it("projects the in-window game and never fetches the out-of-window one", async () =>
	{
		const mlb = new CountingMlbClient(await scheduleDay());
		const d = deps(mlb);

		const result = await tickIngest(d, NOW);

		expect(result.ingested).toEqual([IN_WINDOW]);
		expect(result.skipped).toEqual([OUT_OF_WINDOW]);

		// The bound that matters: no upstream call was made for the skipped game.
		expect(mlb.callsFor(OUT_OF_WINDOW)).toBe(0);
		expect(mlb.callsFor(IN_WINDOW)).toBe(1);

		const projection = await d.projections.getByPk(IN_WINDOW);
		expect(projection).not.toBeNull();
		expect(await d.projections.getByPk(OUT_OF_WINDOW)).toBeNull();
	});

	it("stamps the injected clock and windowMode active on what it writes", async () =>
	{
		const mlb = new CountingMlbClient(await scheduleDay());
		const d = deps(mlb);

		await tickIngest(d, NOW);

		const stored = await d.games.getByPk(IN_WINDOW);
		expect(stored?.windowMode).toBe("active");
		expect(stored?.fetchedAt).toBe(NOW.toISOString());

		const day = await d.schedules.getByDate("2024-07-04");
		expect(day?.windowMode).toBe("active");
		expect(day?.fetchedAt).toBe(NOW.toISOString());
	});

	it("marks the day cache and fetches nothing when no game is in window", async () =>
	{
		const day = await scheduleDay();
		const quiet = {
			...day,
			games: day.games.map((g) => ({
				...g,
				gameDate: "2024-07-04T02:00:00.000Z",
				status: {
					...g.status,
					codedGameState: "S",
				},
			})),
		};
		const mlb = new CountingMlbClient(quiet);
		const d = deps(mlb);

		const result = await tickIngest(d, NOW);

		expect(result.ingested).toEqual([]);
		expect(mlb.gameCalls).toHaveLength(0);
		expect((await d.schedules.getByDate("2024-07-04"))?.windowMode).toBe("cache");
	});
});
