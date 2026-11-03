import {
	describe, expect, it,
} from "vitest";
import type { SeasonCalendar } from "./scoreboard-date.js";
import { defaultScoreboardDate, mlbToday } from "./scoreboard-date.js";

// MLB's published calendars, with 2026's final from its World Series schedule (fixtures/raw/).
const S2025: SeasonCalendar = {
	season: 2025,
	springStartDate: "2025-02-20",
	lastGameDate: "2025-11-01",
};
const S2026: SeasonCalendar = {
	season: 2026,
	springStartDate: "2026-02-20",
	lastGameDate: "2026-10-28",
};
const S2027: SeasonCalendar = {
	season: 2027,
	springStartDate: "2027-02-19",
	lastGameDate: "2027-10-31",
};

describe("defaultScoreboardDate", () =>
{
	it("in season it is today", () =>
	{
		expect(defaultScoreboardDate("2026-07-04", [S2025, S2026])).toBe("2026-07-04");
	});

	it("the day of the final is today", () =>
	{
		expect(defaultScoreboardDate("2026-10-28", [S2026, S2027])).toBe("2026-10-28");
	});

	it("the day after the final opens on the final", () =>
	{
		expect(defaultScoreboardDate("2026-10-29", [S2026, S2027])).toBe("2026-10-28");
	});

	it("the day before the first spring game still opens on the last final", () =>
	{
		expect(defaultScoreboardDate("2027-02-18", [S2026, S2027])).toBe("2026-10-28");
	});

	it("the day of the first spring game is today", () =>
	{
		expect(defaultScoreboardDate("2027-02-19", [S2026, S2027])).toBe("2027-02-19");
	});

	it("with no next season published it stays on the final", () =>
	{
		expect(defaultScoreboardDate("2027-03-30", [S2025, S2026])).toBe("2026-10-28");
	});

	it("takes the seasons in any order", () =>
	{
		expect(defaultScoreboardDate("2026-01-15", [S2026, S2025])).toBe("2025-11-01");
	});

	it("before every known season, or with none, it is today", () =>
	{
		expect(defaultScoreboardDate("2024-12-01", [S2025])).toBe("2024-12-01");
		expect(defaultScoreboardDate("2026-11-02", [])).toBe("2026-11-02");
	});
});

describe("mlbToday", () =>
{
	it("is the America/New_York date across midnight UTC", () =>
	{
		// 23:30 Eastern on Sep 5 is 03:30 UTC on Sep 6.
		expect(mlbToday(new Date("2026-09-06T03:30:00Z"))).toBe("2026-09-05");
		// Midnight Eastern (04:00 UTC in daylight time) turns the day.
		expect(mlbToday(new Date("2026-09-06T04:00:00Z"))).toBe("2026-09-06");
		// In standard time the turn is 05:00 UTC.
		expect(mlbToday(new Date("2026-12-01T04:59:00Z"))).toBe("2026-11-30");
		expect(mlbToday(new Date("2026-12-01T05:00:00Z"))).toBe("2026-12-01");
	});
});
