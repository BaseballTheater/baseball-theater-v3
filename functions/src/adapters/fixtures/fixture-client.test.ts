/**
 * The fixture client's season calendars (S111): the recorded calendar and World Series
 * for a season, mapped as the HTTP client maps them, offline; null for one never recorded.
 */
import {
	describe, expect, it,
} from "vitest";
import { createBundledFixtureClient } from "./bundled.js";
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
			});
			expect((await mlb.fetchSeasonCalendar(2025))?.lastGameDate).toBe("2025-11-01");
		}
	});

	it("season calendar: a season with no recording is null", async () =>
	{
		expect(await new FixtureMlbStatsClient().fetchSeasonCalendar(2031)).toBeNull();
	});
});
