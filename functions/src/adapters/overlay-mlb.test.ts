/**
 * The overlay client (S112): days and games come from its source when the source has them and
 * from the client underneath when it doesn't; every other call goes straight underneath.
 */
import type { MlbStatsClient } from "@bt/ports";
import {
	describe, expect, it,
} from "vitest";
import { FixtureMlbStatsClient } from "./fixtures/mlb.js";
import { overlayMlbClient, storeOverlay } from "./overlay-mlb.js";

describe("overlayMlbClient (S112)", () =>
{
	it("answers days and games from the source first, and the rest from the client underneath", async () =>
	{
		const inner = new FixtureMlbStatsClient();
		const fromInner = await inner.fetchSchedule("2024-07-04");
		const mlb = overlayMlbClient(inner, {
			schedule: async (date) => date === "2026-01-01" ? {
				...fromInner,
				date,
			} : null,
			game: async () => null,
		});
		expect((await mlb.fetchSchedule("2026-01-01")).date).toBe("2026-01-01");
		expect((await mlb.fetchSchedule("2024-07-04")).games).toEqual(fromInner.games);
		expect((await mlb.fetchGame(823823)).gamePk).toBe(823823);
	});

	it("passes every other call through unchanged", async () =>
	{
		const calls: unknown[][] = [];
		const answer = <T>(name: string, value: T) => async (...args: unknown[]) =>
		{
			calls.push([name, ...args]);
			return value;
		};
		const inner = {
			fetchSchedule: answer("fetchSchedule", null),
			fetchGame: answer("fetchGame", null),
			fetchGameContent: answer("fetchGameContent", []),
			fetchPlayMetrics: answer("fetchPlayMetrics", null),
			fetchGameGraphContent: answer("fetchGameGraphContent", null),
			fetchStandings: answer("fetchStandings", null),
			fetchFinalStandings: answer("fetchFinalStandings", null),
			fetchSpringStandings: answer("fetchSpringStandings", null),
			fetchSeasonCalendar: answer("fetchSeasonCalendar", null),
			fetchPlayers: answer("fetchPlayers", []),
			fetchGameTimestamps: answer("fetchGameTimestamps", []),
			fetchGameDiffPatch: answer("fetchGameDiffPatch", null),
		} as unknown as MlbStatsClient;
		const mlb = overlayMlbClient(inner, {
			schedule: async () => null,
			game: async () => null,
		});
		await mlb.fetchGameContent(1);
		await mlb.fetchPlayMetrics(1);
		await mlb.fetchGameGraphContent(1);
		await mlb.fetchStandings("2026-09-05");
		await mlb.fetchFinalStandings(2026);
		await mlb.fetchSpringStandings(2026, "2026-03-01");
		await mlb.fetchSeasonCalendar(2026);
		await mlb.fetchPlayers([1]);
		await mlb.fetchGameTimestamps(1);
		await mlb.fetchGameDiffPatch(1, "a", "b");
		expect(calls).toEqual([
			["fetchGameContent", 1],
			["fetchPlayMetrics", 1],
			["fetchGameGraphContent", 1],
			["fetchStandings", "2026-09-05"],
			["fetchFinalStandings", 2026],
			["fetchSpringStandings", 2026, "2026-03-01"],
			["fetchSeasonCalendar", 2026],
			["fetchPlayers", [1]],
			["fetchGameTimestamps", 1],
			["fetchGameDiffPatch", 1, "a", "b"],
		]);
	});

	it("storeOverlay hands back a stored day or game without its version, and null for what isn't stored", async () =>
	{
		const source = storeOverlay({
			schedules: {
				getByDate: async (date) => date === "2026-09-05" ? {
					date,
					games: [],
					fetchedAt: "2026-09-05T00:00:00.000Z",
					windowMode: "cache",
					version: 3,
					lastChangedAt: "2026-09-05T00:00:00.000Z",
				} : null,
			},
			games: {
				getByPk: async () => null,
			},
		});
		const day = await source.schedule("2026-09-05");
		expect(day).not.toHaveProperty("version");
		expect(day).not.toHaveProperty("lastChangedAt");
		expect(await source.schedule("2026-09-06")).toBeNull();
		expect(await source.game(1)).toBeNull();
	});
});

describe("overlayMlbClient schedule range (S124)", () =>
{
	it("answers the days the source holds and asks the client underneath once, for the span it lacks", async () =>
	{
		const inner = new FixtureMlbStatsClient();
		const fromInner = await inner.fetchSchedule("2024-07-04");
		const asked: [string, string][] = [];
		const counting = Object.assign(Object.create(inner) as MlbStatsClient, {
			fetchScheduleRange: async (from: string, to: string) =>
			{
				asked.push([from, to]);
				return inner.fetchScheduleRange(from, to);
			},
		});
		const mlb = overlayMlbClient(counting, {
			schedule: async (date) => date === "2024-07-02" ? {
				...fromInner,
				date,
			} : null,
			game: async () => null,
		});
		const days = await mlb.fetchScheduleRange("2024-07-01", "2024-07-04");
		expect(days.map((day) => day.date)).toEqual(["2024-07-01", "2024-07-02", "2024-07-03", "2024-07-04"]);
		expect(days[1]!.games).toEqual(fromInner.games);
		expect(days[3]!.games).toEqual(fromInner.games);
		expect(days[0]!.games).toEqual([]);
		expect(asked).toEqual([["2024-07-01", "2024-07-04"]]);
	});

	it("asks nothing underneath when the source holds every day", async () =>
	{
		const inner = new FixtureMlbStatsClient();
		const fromInner = await inner.fetchSchedule("2024-07-04");
		let asked = 0;
		const counting = Object.assign(Object.create(inner) as MlbStatsClient, {
			fetchScheduleRange: async () =>
			{
				asked++;
				return [];
			},
		});
		const mlb = overlayMlbClient(counting, {
			schedule: async (date) => ({
				...fromInner,
				date,
			}),
			game: async () => null,
		});
		expect(await mlb.fetchScheduleRange("2024-07-01", "2024-07-02")).toHaveLength(2);
		expect(asked).toBe(0);
	});
});
