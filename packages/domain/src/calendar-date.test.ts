import {
	describe, expect, it,
} from "vitest";
import { BACKFILL_EARLIEST_DATE } from "./backfill.js";
import {
	addDays, datesBetween, daysOfMonth, EARLIEST_CALENDAR_MONTH, isCalendarDate, isCalendarMonth, yearsBefore,
} from "./calendar-date.js";

describe("addDays (S66)", () =>
{
	it("steps a calendar date forward and back", () =>
	{
		expect(addDays("2026-09-05", 1)).toBe("2026-09-06");
		expect(addDays("2026-09-05", -1)).toBe("2026-09-04");
	});

	it("crosses months, years and leap days", () =>
	{
		expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
		expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
		expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
	});
});

describe("isCalendarDate and yearsBefore (S122)", () =>
{
	it("a real date passes; an impossible or misshapen one does not", () =>
	{
		expect(isCalendarDate("2028-02-29")).toBe(true);
		expect(isCalendarDate("2026-02-30")).toBe(false);
		expect(isCalendarDate("2026-13-01")).toBe(false);
		expect(isCalendarDate("2025-99-99")).toBe(false);
		expect(isCalendarDate("2026-7-04")).toBe(false);
		// Years before 100 are real dates too (Date.UTC alone would read them as 19xx).
		expect(isCalendarDate("0050-01-01")).toBe(true);
		expect(isCalendarDate("0050-02-30")).toBe(false);
		expect(isCalendarDate("0004-02-29")).toBe(true);
		expect(isCalendarDate("1900-02-29")).toBe(false);
	});

	it("leap day: February 29 steps to February 28 in a year without one", () =>
	{
		expect(yearsBefore("2028-02-29", 1)).toBe("2027-02-28");
		expect(yearsBefore("2028-02-29", 10)).toBe("2018-02-28");
		expect(yearsBefore("2028-02-29", 4)).toBe("2024-02-29");
		expect(yearsBefore("2026-11-08", 10)).toBe("2016-11-08");
	});
});

describe("isCalendarMonth, daysOfMonth and datesBetween (S124)", () =>
{
	it("isCalendarMonth: a well-formed month from 1901-04 on passes", () =>
	{
		expect(isCalendarMonth("1901-04")).toBe(true);
		expect(isCalendarMonth("2026-12")).toBe(true);
		expect(isCalendarMonth("2026-01")).toBe(true);
	});

	it("isCalendarMonth: a month before 1901-04, or a malformed one, does not", () =>
	{
		for (const month of ["1901-03", "1900-12", "1901-4", "2026-13", "2026-00", "2026-1", "26-01", "2026-01-01", "", "abcd-ef"])
		{
			expect(isCalendarMonth(month)).toBe(false);
		}
	});

	it("isCalendarMonth: the earliest month is the month of the backfill's earliest date", () =>
	{
		expect(EARLIEST_CALENDAR_MONTH).toBe(BACKFILL_EARLIEST_DATE.slice(0, 7));
	});

	it("daysOfMonth lists every day, leap Februaries included", () =>
	{
		expect(daysOfMonth("2026-09")).toHaveLength(30);
		expect(daysOfMonth("2026-12").at(-1)).toBe("2026-12-31");
		expect(daysOfMonth("2026-02")).toHaveLength(28);
		expect(daysOfMonth("2028-02")).toHaveLength(29);
		expect(daysOfMonth("2026-07")[0]).toBe("2026-07-01");
	});

	it("datesBetween includes both ends and is empty when reversed", () =>
	{
		expect(datesBetween("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
		expect(datesBetween("2026-09-05", "2026-09-05")).toEqual(["2026-09-05"]);
		expect(datesBetween("2026-09-06", "2026-09-05")).toEqual([]);
	});
});
