import { readFileSync } from "node:fs";
import {
	describe, expect, it,
} from "vitest";
import type { SeasonCalendar } from "./scoreboard-date.js";
import { previousStandingsPhase, standingsPhase } from "./standings-phase.js";

/** A season's calendar from the committed recording `fixtures/raw/seasons-<season>.json` (MLB's own dates). */
function recorded(season: number): SeasonCalendar
{
	const raw = JSON.parse(readFileSync(new URL(`../../../fixtures/raw/seasons-${season}.json`, import.meta.url), "utf8")) as {
		seasons: Array<Record<string, string>>;
	};
	const s = raw.seasons[0]!;
	return {
		season,
		springStartDate: s.springStartDate!,
		lastGameDate: s.postSeasonEndDate!,
		regularSeasonStartDate: s.regularSeasonStartDate!,
		regularSeasonEndDate: s.regularSeasonEndDate!,
	};
}

const S2025 = recorded(2025);
const S2026 = recorded(2026);
const S2027 = recorded(2027);
const ALL = [S2027, S2025, S2026];

describe("standingsPhase", () =>
{
	it("the recordings carry MLB's dates", () =>
	{
		expect([S2025.regularSeasonStartDate, S2025.regularSeasonEndDate]).toEqual(["2025-03-18", "2025-09-28"]);
		expect([S2026.springStartDate, S2026.regularSeasonStartDate, S2026.regularSeasonEndDate]).toEqual(["2026-02-20", "2026-03-25", "2026-09-27"]);
		expect([S2027.springStartDate, S2027.regularSeasonStartDate, S2027.regularSeasonEndDate]).toEqual(["2027-02-19", "2027-03-25", "2027-09-26"]);
	});

	it("the last regular-season day is that day's table", () =>
	{
		expect(standingsPhase("2026-09-27", ALL)).toEqual({
			phase: "regularSeason",
			season: 2026,
			date: "2026-09-27",
		});
	});

	it("the day after the regular season is the final table", () =>
	{
		expect(standingsPhase("2026-09-28", ALL)).toEqual({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
	});

	it("a postseason day is the final table", () =>
	{
		expect(standingsPhase("2026-10-20", ALL)).toEqual({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
	});

	it("a January day is the previous season's final table", () =>
	{
		expect(standingsPhase("2027-01-15", [S2026, S2027])).toEqual({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
	});

	it("the day before spring is still the final table", () =>
	{
		expect(standingsPhase("2027-02-18", [S2026, S2027])).toEqual({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
	});

	it("the first spring day is spring's table as of that day", () =>
	{
		expect(standingsPhase("2027-02-19", [S2026, S2027])).toEqual({
			phase: "spring",
			season: 2027,
			date: "2027-02-19",
		});
	});

	it("the day before the regular season is spring's table", () =>
	{
		expect(standingsPhase("2026-03-24", ALL)).toEqual({
			phase: "spring",
			season: 2026,
			date: "2026-03-24",
		});
	});

	it("the first regular-season day is that day's table", () =>
	{
		expect(standingsPhase("2026-03-25", ALL)).toEqual({
			phase: "regularSeason",
			season: 2026,
			date: "2026-03-25",
		});
	});

	it("after an early opener it is the regular season though other teams still play spring games (2025 Tokyo Series)", () =>
	{
		expect(standingsPhase("2025-03-17", [S2024Unknown(), S2025])).toMatchObject({
			phase: "spring",
		});
		expect(standingsPhase("2025-03-20", [S2025])).toEqual({
			phase: "regularSeason",
			season: 2025,
			date: "2025-03-20",
		});
	});

	it("next season unpublished: the final table is kept", () =>
	{
		expect(standingsPhase("2027-03-01", [S2026])).toEqual({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
	});

	it("with no calendar, before every known season, or with an incomplete calendar it is the day's regular-season table", () =>
	{
		const regular = (date: string) => ({
			phase: "regularSeason",
			season: Number(date.slice(0, 4)),
			date,
		});
		expect(standingsPhase("2026-11-08", [])).toEqual(regular("2026-11-08"));
		expect(standingsPhase("2025-01-10", [S2025, S2026])).toEqual(regular("2025-01-10"));
		expect(standingsPhase("2026-11-08", [{
			season: 2026,
			springStartDate: "2026-02-20",
			lastGameDate: "2026-10-28",
		}])).toEqual(regular("2026-11-08"));
	});
});

/** A 2024 calendar with no regular-season dates: unknown for standings, so it changes nothing. */
function S2024Unknown(): SeasonCalendar
{
	return {
		season: 2024,
		springStartDate: "2024-02-22",
		lastGameDate: "2024-10-30",
	};
}

describe("previousStandingsPhase", () =>
{
	it("spring's previous table is the season before's final table (empty first spring morning)", () =>
	{
		expect(previousStandingsPhase(standingsPhase("2027-02-19", [S2026, S2027]), [S2026, S2027])).toEqual({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
	});

	it("the regular season's previous table is spring's as of the last spring day (empty opening-day morning)", () =>
	{
		expect(previousStandingsPhase(standingsPhase("2026-03-25", ALL), ALL)).toEqual({
			phase: "spring",
			season: 2026,
			date: "2026-03-24",
		});
	});

	it("nothing comes before a final table, a first known spring, or a day with no calendar", () =>
	{
		expect(previousStandingsPhase(standingsPhase("2026-10-01", ALL), ALL)).toBeNull();
		expect(previousStandingsPhase(standingsPhase("2025-03-01", [S2025]), [S2025])).toBeNull();
		expect(previousStandingsPhase(standingsPhase("2026-07-01", []), [])).toBeNull();
	});
});
