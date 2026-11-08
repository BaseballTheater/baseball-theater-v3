import {
	describe, expect, it,
} from "vitest";
import {
	BACKFILL_EARLIEST_DATE, backfillDays, defaultBackfillRange, GIVE_UP_AFTER_DAYS, isOffSeasonDay, isScheduleDaySettled, isSettledGame, isSourceGivenUp, recordSourceDay,
} from "./backfill.js";
import type { SourceStreak } from "./backfill.js";

describe("isOffSeasonDay (S122 AC 2)", () =>
{
	it("off-season: November 15 through February 15 are skipped, the days either side are not", () =>
	{
		expect(isOffSeasonDay("2025-11-14")).toBe(false);
		expect(isOffSeasonDay("2025-11-15")).toBe(true);
		expect(isOffSeasonDay("2025-12-31")).toBe(true);
		expect(isOffSeasonDay("2026-01-01")).toBe(true);
		expect(isOffSeasonDay("2026-02-15")).toBe(true);
		expect(isOffSeasonDay("2026-02-16")).toBe(false);
		expect(isOffSeasonDay("2026-07-04")).toBe(false);
	});
});

describe("backfillDays (S122 AC 1, 5)", () =>
{
	it("range: walks newest to oldest, both ends included, without off-season days", () =>
	{
		expect(backfillDays("2025-11-13", "2026-02-17")).toEqual(["2026-02-17", "2026-02-16", "2025-11-14", "2025-11-13"]);
	});

	it("range: clamps a from before 1901-04-18", () =>
	{
		const days = backfillDays("1899-01-01", "1901-04-20");
		expect(days).toEqual(["1901-04-20", "1901-04-19", BACKFILL_EARLIEST_DATE]);
	});

	it("range: is empty when from is after to", () =>
	{
		expect(backfillDays("2026-05-02", "2026-05-01")).toEqual([]);
	});

	it("range: defaults to one year before to, through today", () =>
	{
		expect(defaultBackfillRange("2026-11-08")).toEqual({
			from: "2025-11-08",
			to: "2026-11-08",
		});
		expect(defaultBackfillRange("2026-11-08", undefined, "2024-02-29")).toEqual({
			from: "2023-02-28",
			to: "2024-02-29",
		});
		expect(defaultBackfillRange("2026-11-08", "1901-01-01")).toEqual({
			from: "1901-01-01",
			to: "2026-11-08",
		});
	});
});

describe("isSettledGame (S122 AC 4)", () =>
{
	it("final, postponed and cancelled games are settled; scheduled, live and suspended are not", () =>
	{
		expect(isSettledGame({
			codedGameState: "F",
			detailedState: "Final",
		})).toBe(true);
		expect(isSettledGame({
			codedGameState: "D",
			detailedState: "Postponed",
		})).toBe(true);
		expect(isSettledGame({
			codedGameState: "X",
			detailedState: "Cancelled",
		})).toBe(true);
		expect(isSettledGame({
			codedGameState: "S",
			detailedState: "Scheduled",
		})).toBe(false);
		expect(isSettledGame({
			codedGameState: "I",
			detailedState: "In Progress",
		})).toBe(false);
		expect(isSettledGame({
			codedGameState: "T",
			detailedState: "Suspended: Rain",
		})).toBe(false);
	});
});

describe("recordSourceDay (S122 AC 7)", () =>
{
	function failDays(state: SourceStreak, first: string, count: number): SourceStreak
	{
		let next = state;
		let day = first;
		for (let i = 0; i < count; i++)
		{
			next = recordSourceDay(next, day, true);
			const d = new Date(`${day}T00:00:00Z`);
			d.setUTCDate(d.getUTCDate() - 1);
			day = d.toISOString().slice(0, 10);
		}
		return next;
	}

	it("streak: the 14th failed day in a row gives the source up at that day", () =>
	{
		const thirteen = failDays({
			streak: 0,
		}, "2026-07-31", GIVE_UP_AFTER_DAYS - 1);
		expect(thirteen.streak).toBe(13);
		expect(thirteen.givenUpAt).toBeUndefined();
		const fourteen = recordSourceDay(thirteen, "2026-07-17", true);
		expect(fourteen.givenUpAt).toBe("2026-07-17");
		expect(isSourceGivenUp(fourteen, "2026-07-17")).toBe(true);
		expect(isSourceGivenUp(fourteen, "2026-07-01")).toBe(true);
		expect(isSourceGivenUp(fourteen, "2026-07-18")).toBe(false);
		expect(recordSourceDay(fourteen, "2026-07-16", false)).toBe(fourteen);
	});

	it("streak: a day with any success resets it", () =>
	{
		const state = recordSourceDay(failDays({
			streak: 0,
		}, "2026-07-31", 10), "2026-07-21", false);
		expect(state.streak).toBe(0);
		expect(state.lastCountedDay).toBe("2026-07-21");
	});

	it("streak: a day not older than the last counted one is not counted again", () =>
	{
		const state = failDays({
			streak: 0,
		}, "2026-07-31", 3);
		expect(recordSourceDay(state, "2026-07-31", true)).toBe(state);
		expect(recordSourceDay(state, "2026-07-29", true)).toBe(state);
		expect(isSourceGivenUp(undefined, "2026-07-29")).toBe(false);
	});
});

describe("isScheduleDaySettled (S122 AC 4)", () =>
{
	const final = {
		status: {
			abstractGameState: "Final",
			codedGameState: "F",
			detailedState: "Final",
		},
	};
	const scheduled = {
		status: {
			abstractGameState: "Preview",
			codedGameState: "S",
			detailedState: "Scheduled",
		},
	};

	it("empty day: unsettled on its own date or before, settled once MLB's today is past it", () =>
	{
		expect(isScheduleDaySettled({
			date: "2026-07-04",
			games: [],
		}, "2026-07-04")).toBe(false);
		expect(isScheduleDaySettled({
			date: "2026-07-04",
			games: [],
		}, "2026-07-03")).toBe(false);
		expect(isScheduleDaySettled({
			date: "2026-07-04",
			games: [],
		}, "2026-07-05")).toBe(true);
	});

	it("a day with games is settled when every game is, whatever the date", () =>
	{
		expect(isScheduleDaySettled({
			date: "2026-07-04",
			games: [final] as never,
		}, "2026-07-04")).toBe(true);
		expect(isScheduleDaySettled({
			date: "2026-07-04",
			games: [final, scheduled] as never,
		}, "2026-07-05")).toBe(false);
	});
});

describe("defaultBackfillRange leap day (S122)", () =>
{
	it("a February 29 --to defaults --from to February 28 a year before", () =>
	{
		expect(defaultBackfillRange("2028-02-29")).toEqual({
			from: "2027-02-28",
			to: "2028-02-29",
		});
	});
});
