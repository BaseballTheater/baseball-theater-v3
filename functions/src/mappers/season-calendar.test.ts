import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ScheduleResponse } from "@bt/mlb-api";
import { parseScheduleResponse, parseSeasonsResponse } from "@bt/mlb-api";
import {
	describe, expect, it,
} from "vitest";
import { mapSeasonCalendar } from "./season-calendar.js";

function raw(name: string): unknown
{
	return JSON.parse(readFileSync(fileURLToPath(new URL(`../../../fixtures/raw/${name}`, import.meta.url)), "utf8"));
}

const seasons2026 = parseSeasonsResponse(raw("seasons-2026.json"));
const worldSeries2026 = parseScheduleResponse(raw("worldseries-2026.json"));
const noSeries: ScheduleResponse = {
	dates: [],
} as unknown as ScheduleResponse;

describe("mapSeasonCalendar", () =>
{
	it("takes the final from the World Series, not MLB's scheduled postseason end", () =>
	{
		// The recorded calendar still says 2026-10-31; the Series ended in five on 10-28.
		expect(seasons2026.seasons[0]?.postSeasonEndDate).toBe("2026-10-31");
		expect(mapSeasonCalendar(seasons2026, worldSeries2026)).toEqual({
			season: 2026,
			springStartDate: "2026-02-20",
			lastGameDate: "2026-10-28",
		});
	});

	it("before the Series is scheduled, the calendar's postseason end stands in", () =>
	{
		expect(mapSeasonCalendar(seasons2026, noSeries)?.lastGameDate).toBe("2026-10-31");
	});

	it("skips a cancelled Series day", () =>
	{
		const cancelledLast = structuredClone(worldSeries2026);
		const last = cancelledLast.dates.at(-1)!;
		last.games = last.games.map((game) => ({
			...game,
			status: {
				...game.status,
				detailedState: "Cancelled",
			},
		}));
		expect(mapSeasonCalendar(seasons2026, cancelledLast)?.lastGameDate).toBe("2026-10-27");
	});

	it("an unpublished season is null", () =>
	{
		expect(mapSeasonCalendar({
			seasons: [],
		}, noSeries)).toBeNull();
	});
});
