/**
 * The fixture client's season calendars (S111): the recorded calendar and World Series
 * for a season, mapped as the HTTP client maps them, offline; null for one never recorded.
 * And its final and spring standings (S128), from the season's recorded tables. And a game's
 * videos and recap on their own (S122), null when the game has neither or no recording.
 */
import {
	describe, expect, it,
} from "vitest";
import { createBundledFixtureClient } from "./bundled.js";
import { FixtureClient } from "./fixture-client.js";
import { FixtureMlbStatsClient } from "./mlb.js";

describe("FixtureClient season calendar (S111)", () =>
{
	it("season calendar: serves the recorded seasons from files and from the Worker bundle", async () =>
	{
		for (const mlb of [new FixtureMlbStatsClient(), createBundledFixtureClient()])
		{
			expect(await mlb.fetchSeasonCalendar(2026)).toEqual({
				season: 2026,
				springStartDate: "2026-02-20",
				lastGameDate: "2026-10-28",
				regularSeasonStartDate: "2026-03-25",
				regularSeasonEndDate: "2026-09-27",
			});
			expect((await mlb.fetchSeasonCalendar(2027))?.springStartDate).toBe("2027-02-19");
			expect((await mlb.fetchSeasonCalendar(2025))?.lastGameDate).toBe("2025-11-01");
		}
	});

	it("season calendar: a season with no recording is null", async () =>
	{
		expect(await new FixtureMlbStatsClient().fetchSeasonCalendar(2031)).toBeNull();
	});
});

describe("FixtureClient final and spring standings (S128)", () =>
{
	it("standings: serves 2026's recorded final and spring tables from files and from the Worker bundle", async () =>
	{
		for (const mlb of [new FixtureMlbStatsClient(), createBundledFixtureClient()])
		{
			const final = await mlb.fetchFinalStandings(2026);
			const spring = await mlb.fetchSpringStandings(2026, "2026-03-01");
			for (const table of [final, spring])
			{
				expect(table.divisions.map((d) => d.divisionId)).toEqual([201, 202, 200, 204, 205, 203]);
				expect(table.divisions.reduce((n, d) => n + d.teams.length, 0)).toBe(30);
			}
			expect(spring.date).toBe("2026-03-01");
		}
	});

	it("standings: a season with no recording is an empty table, as MLB answers before it starts", async () =>
	{
		const mlb = new FixtureMlbStatsClient();
		expect((await mlb.fetchFinalStandings(2031)).divisions).toEqual([]);
		expect((await mlb.fetchSpringStandings(2027, "2027-02-19")).divisions).toEqual([]);
	});
});

describe("FixtureClient fetchGameEditorial (S122)", () =>
{
	it("a game with no videos and no recap is null, a missing game is null, a recorded one is its videos and recap", async () =>
	{
		const empty = new FixtureClient({
			read: async (name) =>
			{
				if (name !== "game-1.json") throw new Error(`no fixture ${name}`);
				return {
					gamePk: 1,
					highlights: [],
				};
			},
			list: async () => ["game-1.json"],
		});
		expect(await empty.fetchGameEditorial(1)).toBeNull();
		expect(await empty.fetchGameEditorial(2)).toBeNull();

		const recorded = await new FixtureMlbStatsClient().fetchGameEditorial(823823);
		expect(recorded?.highlights).toHaveLength(40);
		expect(recorded?.recap).toBeTruthy();
	});
});
