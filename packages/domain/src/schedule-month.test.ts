import {
	describe, expect, it,
} from "vitest";
import { monthGameCounts, monthLastChangedAt } from "./schedule-month.js";

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
});
