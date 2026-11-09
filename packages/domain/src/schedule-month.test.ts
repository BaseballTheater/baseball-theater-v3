import {
	describe, expect, it,
} from "vitest";
import {
	latestScheduleMonth, monthGameCounts, monthLastChangedAt, scheduleFillWindow,
} from "./schedule-month.js";

describe("monthGameCounts (S124)", () =>
{
	it("gives each date its stored count, 0 for a stored day with no games, null for no stored day", () =>
	{
		expect(monthGameCounts(["2026-09-04", "2026-09-05", "2026-09-06"], [
			{
				date: "2026-09-05",
				gameCount: 15,
			},
			{
				date: "2026-09-06",
				gameCount: 0,
			},
		])).toEqual([
			{
				date: "2026-09-04",
				count: null,
			},
			{
				date: "2026-09-05",
				count: 15,
			},
			{
				date: "2026-09-06",
				count: 0,
			},
		]);
	});
});

describe("monthLastChangedAt (S124)", () =>
{
	it("is the latest change among the stored days, undefined with none", () =>
	{
		expect(monthLastChangedAt([])).toBeUndefined();
		expect(monthLastChangedAt([
			{
				lastChangedAt: "2026-09-05T10:00:00.000Z",
			},
			{
				lastChangedAt: "2026-10-01T00:00:00.000Z",
			},
			{
				lastChangedAt: "2026-09-30T00:00:00.000Z",
			},
		])).toBe("2026-10-01T00:00:00.000Z");
	});

	it("skips a stamp that doesn't parse, wherever it is", () =>
	{
		expect(monthLastChangedAt([
			{
				lastChangedAt: null as unknown as string,
			},
			{
				lastChangedAt: "2026-09-05T10:00:00.000Z",
			},
			{
				lastChangedAt: "not a time",
			},
		])).toBe("2026-09-05T10:00:00.000Z");
	});
});

describe("scheduleFillWindow and latestScheduleMonth (S124)", () =>
{
	it("runs from the current season's first day through December 31 of next year", () =>
	{
		expect(scheduleFillWindow("2026-11-09")).toEqual({
			first: "2026-01-01",
			last: "2027-12-31",
		});
		expect(scheduleFillWindow("2026-12-31")).toEqual({
			first: "2026-01-01",
			last: "2027-12-31",
		});
		expect(scheduleFillWindow("2027-01-01")).toEqual({
			first: "2027-01-01",
			last: "2028-12-31",
		});
	});

	it("latestScheduleMonth is December of next year", () =>
	{
		expect(latestScheduleMonth("2026-11-09")).toBe("2027-12");
		expect(latestScheduleMonth("2027-01-01")).toBe("2028-12");
	});
});
