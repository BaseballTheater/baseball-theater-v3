import {
	describe, expect, it,
} from "vitest";
import { formatDate, formatTime } from "./datetime.js";

describe("datetime formatting (S79)", () =>
{
	it("writes a date as A4 does", () =>
	{
		expect(formatDate("2026-11-11T12:00:00.000Z")).toMatch(/^Nov 1[01], 2026$/);
	});

	it("writes a calendar date as that day in any zone, Sep 5, 2026 (S66, merged from the game top bar)", () =>
	{
		expect(formatDate("2026-09-05")).toBe("Sep 5, 2026");
		expect(formatDate("2024-07-04")).toBe("Jul 4, 2024");
		expect(formatDate("2026-12-31")).toBe("Dec 31, 2026");
	});

	it("passes through anything that is not a date", () =>
	{
		expect(formatDate("TBD")).toBe("TBD");
		expect(formatDate("2024-13-01")).toBe("2024-13-01");
		expect(formatDate("2026-02-30")).toBe("2026-02-30");
	});

	it("writes a time with hours and minutes, AM/PM", () =>
	{
		expect(formatTime("2026-10-28T15:15:00.000Z")).toMatch(/^\d{1,2}:15\s?[AP]M$/);
	});
});
