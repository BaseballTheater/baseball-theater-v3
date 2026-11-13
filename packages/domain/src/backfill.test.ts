import {
	describe, expect, it,
} from "vitest";
import {
	BACKFILL_EARLIEST_DATE, backfillDays, defaultBackfillRange, GIVE_UP_AFTER_DAYS, isOffSeasonDay, isScheduleDaySettled, isSettledGame, isSourceGivenUp,
	recordSourceDay, sourceGivenUpAt,
} from "./backfill.js";
import { addDays } from "./calendar-date.js";
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
	const FRESH: SourceStreak = {
		stretches: [],
	};

	/**
	 * Counts `count` days of games from `first` back, one a day, as a run whose walk started at
	 * `walkFrom` (its `to`, `first` by default) would: each day failed unless `failed` says not.
	 */
	function countDays(state: SourceStreak, first: string, count: number, walkFrom = first, failed = true): SourceStreak
	{
		let next = state;
		for (let i = 0; i < count; i++) next = recordSourceDay(next, addDays(first, -i), failed, walkFrom);
		return next;
	}

	it("streak: the 14th failed day in a row gives the source up at that day", () =>
	{
		const thirteen = countDays(FRESH, "2026-07-31", GIVE_UP_AFTER_DAYS - 1);
		expect(thirteen.stretches).toEqual([{
			newest: "2026-07-31",
			oldest: "2026-07-19",
			streak: 13,
			newestStreak: 13,
			allFailed: true,
			givenUp: false,
		}]);
		expect(sourceGivenUpAt(thirteen)).toBeUndefined();
		const fourteen = recordSourceDay(thirteen, "2026-07-18", true, "2026-07-31");
		expect(sourceGivenUpAt(fourteen)).toBe("2026-07-18");
		expect(isSourceGivenUp(fourteen, "2026-07-18")).toBe(true);
		expect(isSourceGivenUp(fourteen, "2026-07-01")).toBe(true);
		expect(isSourceGivenUp(fourteen, "2026-07-19")).toBe(false);
		expect(recordSourceDay(fourteen, "2026-07-17", false, "2026-07-31")).toBe(fourteen);
	});

	it("streak: a day with any success resets it", () =>
	{
		const state = recordSourceDay(countDays(FRESH, "2026-07-31", 10), "2026-07-21", false, "2026-07-31");
		expect(state.stretches).toEqual([{
			newest: "2026-07-31",
			oldest: "2026-07-21",
			streak: 0,
			newestStreak: 10,
			allFailed: false,
			givenUp: false,
		}]);
	});

	it("streak: a day inside what was counted is a revisit and is not counted again", () =>
	{
		const state = countDays(FRESH, "2026-07-31", 3);
		expect(recordSourceDay(state, "2026-07-31", true, "2026-07-31")).toBe(state);
		expect(recordSourceDay(state, "2026-07-29", true, "2026-07-31")).toBe(state);
		expect(isSourceGivenUp(undefined, "2026-07-29")).toBe(false);
	});

	it("split run: a resume from the same `to`, or from just below where it stopped, continues the streak", () =>
	{
		const thirteen = countDays(FRESH, "2026-07-31", GIVE_UP_AFTER_DAYS - 1);
		expect(sourceGivenUpAt(recordSourceDay(thirteen, "2026-07-18", true, "2026-07-31"))).toBe("2026-07-18");
		expect(sourceGivenUpAt(recordSourceDay(thirteen, "2026-07-18", true, "2026-07-18"))).toBe("2026-07-18");
		// The off-season between is never walked, so a run from the last day before it continues a streak that stopped after it.
		const spring = countDays(FRESH, "2010-02-28", GIVE_UP_AFTER_DAYS - 1);
		expect(spring.stretches[0]?.oldest).toBe("2010-02-16");
		expect(sourceGivenUpAt(recordSourceDay(spring, "2009-11-14", true, "2009-11-14"))).toBe("2009-11-14");
	});

	it("walkFrom: a run that started above a stretch continues it across days it walked without counting", () =>
	{
		const ten = countDays(FRESH, "2010-04-10", 10);
		// The run started at 2010-05-01, so 03-31 … 03-21 were walked (no games counted) before 03-20.
		const eleven = recordSourceDay(ten, "2010-03-20", true, "2010-05-01");
		expect(eleven.stretches).toEqual([{
			newest: "2010-04-10",
			oldest: "2010-03-20",
			streak: 11,
			newestStreak: 11,
			allFailed: true,
			givenUp: false,
		}]);
		expect(sourceGivenUpAt(countDays(eleven, "2010-03-19", 3, "2010-05-01"))).toBe("2010-03-17");
		// A run that started at 03-20 didn't walk those days, so it counts from zero.
		expect(recordSourceDay(ten, "2010-03-20", true, "2010-03-20").stretches).toHaveLength(2);
	});

	it("newer range after a give-up: its own 14 failed days give the source up again, so it isn't asked for ten seasons", () =>
	{
		// pnpm mlb:backfill --from 1995-04-01 --to 1995-05-31 gives content up …
		const first = countDays(FRESH, "1995-05-31", GIVE_UP_AFTER_DAYS);
		expect(sourceGivenUpAt(first)).toBe("1995-05-18");
		// … then --from 1996-03-01 --to 2005-11-01 is newer than that give-up and starts its own streak.
		const thirteen = countDays(first, "2005-11-01", GIVE_UP_AFTER_DAYS - 1);
		expect(isSourceGivenUp(thirteen, "2005-10-19")).toBe(false);
		const fourteen = recordSourceDay(thirteen, "2005-10-19", true, "2005-11-01");
		expect(sourceGivenUpAt(fourteen)).toBe("2005-10-19");
		expect(isSourceGivenUp(fourteen, "2000-06-01")).toBe(true);
		expect(isSourceGivenUp(fourteen, "1995-05-18")).toBe(true);
	});

	it("older range that doesn't touch: it starts its own streak rather than continuing an unrelated one", () =>
	{
		// A run that ended with ten failed days at 2010-04-01 …
		const ten = countDays(FRESH, "2010-04-10", 10);
		expect(ten.stretches[0]).toMatchObject({
			oldest: "2010-04-01",
			streak: 10,
		});
		// … then --to 1995-10-01: four failed 1995 days aren't the 11th–14th in a row.
		const four = countDays(ten, "1995-10-01", 4);
		expect(sourceGivenUpAt(four)).toBeUndefined();
		expect(four.stretches).toHaveLength(2);
		expect(sourceGivenUpAt(countDays(ten, "1995-10-01", GIVE_UP_AFTER_DAYS))).toBe("1995-09-18");
	});

	it("a walk from above that reaches an older stretch carries on that stretch's streak below it", () =>
	{
		const old = countDays(FRESH, "2010-04-01", 10);
		// A later run from 2010-06-01 counts 05-01 (answered) as a new stretch, revisits the old one, then goes below it.
		const above = recordSourceDay(old, "2010-05-01", false, "2010-06-01");
		expect(above.stretches).toHaveLength(2);
		expect(recordSourceDay(above, "2010-03-25", true, "2010-06-01")).toBe(above);
		const below = countDays(above, "2010-03-22", 4, "2010-06-01");
		expect(sourceGivenUpAt(below)).toBe("2010-03-19");
	});

	it("one-day catch-up runs, each the day after the last, count as one streak: the 14th gives up, the 15th is still asked", () =>
	{
		// An older, unrelated stretch below: each day joins the nearest stretch below it, not this one.
		const older = countDays(FRESH, "1995-06-10", 3);
		let state = older;
		for (let i = 0; i < GIVE_UP_AFTER_DAYS - 1; i++) state = countDays(state, addDays("2026-07-01", i), 1);
		expect(state.stretches).toHaveLength(2);
		expect(sourceGivenUpAt(state)).toBeUndefined();
		state = countDays(state, "2026-07-14", 1);
		expect(sourceGivenUpAt(state)).toBe("2026-07-01");
		// Stretches are kept newest first.
		expect(state.stretches.map((stretch) => stretch.newest)).toEqual(["2026-07-14", "1995-06-10"]);
		expect(isSourceGivenUp(state, "2026-07-15")).toBe(false);
		expect(sourceGivenUpAt(countDays(state, "2026-07-15", 1))).toBe("2026-07-01");
	});

	it("10 + 10: a newer run ending just above an all-failed stretch joins it and gives up", () =>
	{
		const first = countDays(FRESH, "2010-04-01", 10);
		const second = countDays(first, "2010-04-11", 10);
		expect(second.stretches).toEqual([{
			newest: "2010-04-11",
			oldest: "2010-03-23",
			streak: 20,
			newestStreak: 20,
			allFailed: true,
			givenUp: true,
		}]);
		expect(sourceGivenUpAt(second)).toBe("2010-03-23");
	});

	it("10 + 10: a run from above that walks into an older stretch folds its own counted days in", () =>
	{
		const first = countDays(FRESH, "2010-04-01", 10);
		// 04-20 … 04-11 fail; 04-10 … 04-02 have no games; 04-01 … 03-23 are revisits; then 03-22.
		const upper = countDays(first, "2010-04-20", 10, "2010-04-20");
		expect(sourceGivenUpAt(upper)).toBeUndefined();
		const below = recordSourceDay(upper, "2010-03-22", true, "2010-04-20");
		expect(below.stretches).toEqual([{
			newest: "2010-04-20",
			oldest: "2010-03-22",
			streak: 21,
			newestStreak: 21,
			allFailed: true,
			givenUp: true,
		}]);
		expect(sourceGivenUpAt(below)).toBe("2010-03-22");
	});

	it("a catch-up run joining a given-up stretch from above keeps that give-up", () =>
	{
		// Run 1, --to 2010-04-30: 04-30 answered, then 14 failed days give up at 04-16.
		const first = countDays(recordSourceDay(FRESH, "2010-04-30", false, "2010-04-30"), "2010-04-29", GIVE_UP_AFTER_DAYS, "2010-04-30");
		expect(sourceGivenUpAt(first)).toBe("2010-04-16");
		// Catch-up run --to 2010-05-01, 05-01 answered: it counts a stretch of its own, and the give-up below holds.
		const caughtUp = recordSourceDay(first, "2010-05-01", false, "2010-05-01");
		expect(caughtUp.stretches).toHaveLength(2);
		expect(sourceGivenUpAt(caughtUp)).toBe("2010-04-16");
		expect(isSourceGivenUp(caughtUp, "2010-04-15")).toBe(true);
	});

	it("one-day runs above a given-up stretch count their own streak: the 14th failed day above moves the give-up", () =>
	{
		// --from 2010-04-01 --to 2010-04-30, every day failing: given up at 04-17.
		let state = countDays(FRESH, "2010-04-30", GIVE_UP_AFTER_DAYS);
		expect(sourceGivenUpAt(state)).toBe("2010-04-17");
		for (let i = 0; i < GIVE_UP_AFTER_DAYS - 1; i++) state = countDays(state, addDays("2010-05-01", i), 1);
		expect(sourceGivenUpAt(state)).toBe("2010-04-17");
		state = countDays(state, "2010-05-14", 1);
		expect(sourceGivenUpAt(state)).toBe("2010-05-01");
		expect(isSourceGivenUp(state, "2010-04-17")).toBe(true);
	});

	it("weekly runs above a given-up stretch count their own streak: two failed weeks move the give-up", () =>
	{
		const first = countDays(FRESH, "2010-04-30", GIVE_UP_AFTER_DAYS);
		const week = countDays(first, "2010-05-07", 7);
		expect(sourceGivenUpAt(week)).toBe("2010-04-17");
		expect(sourceGivenUpAt(countDays(week, "2010-05-14", 7))).toBe("2010-05-01");
	});

	it("joining a stretch with a success in it adds no failures across the success", () =>
	{
		// 04-05 answered, 04-04 … 04-01 failed.
		const first = countDays(recordSourceDay(FRESH, "2010-04-05", false, "2010-04-05"), "2010-04-04", 4, "2010-04-05");
		const joined = countDays(first, "2010-04-08", 3);
		expect(joined.stretches).toEqual([{
			newest: "2010-04-08",
			oldest: "2010-04-01",
			streak: 4,
			newestStreak: 3,
			allFailed: false,
			givenUp: false,
		}]);
	});

	it("catch-up runs above an answered day: the failures at the newest end count, so the 14th one-day run gives up", () =>
	{
		let state = recordSourceDay(FRESH, "2026-06-30", false, "2026-06-30");
		for (let i = 0; i < GIVE_UP_AFTER_DAYS - 1; i++) state = countDays(state, addDays("2026-07-01", i), 1);
		expect(sourceGivenUpAt(state)).toBeUndefined();
		state = countDays(state, "2026-07-14", 1);
		expect(state.stretches).toHaveLength(1);
		// Every day from 07-14 to 06-30 is counted, so skipping from 06-30 back skips what the 14th failure would.
		expect(sourceGivenUpAt(state)).toBe("2026-06-30");
		expect(isSourceGivenUp(state, "2026-06-29")).toBe(true);
		expect(isSourceGivenUp(state, "2026-07-15")).toBe(false);
	});

	it("weekly runs above an answered day: two failed weeks join into 14 in a row and give up", () =>
	{
		const answered = recordSourceDay(FRESH, "2026-06-30", false, "2026-06-30");
		const week = countDays(answered, "2026-07-07", 7);
		expect(sourceGivenUpAt(week)).toBeUndefined();
		const twoWeeks = countDays(week, "2026-07-14", 7);
		expect(sourceGivenUpAt(twoWeeks)).toBe("2026-06-30");
	});

	it("a run that gives up just above a stretch keeps its give-up rather than joining the stretch's shorter streak", () =>
	{
		// Run 1, --from 2010-04-01 --to 2010-04-05: 04-05 answered, 04-04 … 04-01 failed.
		const first = countDays(recordSourceDay(FRESH, "2010-04-05", false, "2010-04-05"), "2010-04-04", 4, "2010-04-05");
		// Run 2, --to 2010-04-19, every day failing: the 14th, 04-06, gives up.
		const second = countDays(first, "2010-04-19", GIVE_UP_AFTER_DAYS);
		expect(sourceGivenUpAt(second)).toBe("2010-04-06");
		expect(isSourceGivenUp(second, "2010-04-05")).toBe(true);
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
