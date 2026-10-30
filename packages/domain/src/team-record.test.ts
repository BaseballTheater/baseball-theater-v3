import {
	describe, expect, it,
} from "vitest";
import { teamRecordLabel, winningPercentage } from "./team-record.js";

const cubs = {
	abbreviation: "CHC",
	record: {
		wins: 79,
		losses: 73,
	},
};

describe("teamRecordLabel (S66)", () =>
{
	it("a final or live row: abbreviation and record, as R7 draws NYY (94-58)", () =>
	{
		expect(teamRecordLabel({
			abbreviation: "NYY",
			record: {
				wins: 94,
				losses: 58,
			},
		}, "final")).toBe("NYY (94-58)");
		expect(teamRecordLabel(cubs, "live")).toBe("CHC (79-73)");
	});

	it("a scheduled row: record with its percentage, 79 - 73 (.520)", () =>
	{
		expect(teamRecordLabel(cubs, "pregame")).toBe("79 - 73 (.520)");
	});

	it("no record from MLB: the abbreviation alone on a scored row, no line on a scheduled one", () =>
	{
		expect(teamRecordLabel({
			abbreviation: "SD",
		}, "final")).toBe("SD");
		expect(teamRecordLabel({
			abbreviation: "SD",
			record: null,
		}, "pregame")).toBeNull();
	});
});

describe("winningPercentage (S66)", () =>
{
	it("three places with no leading zero", () =>
	{
		expect(winningPercentage({
			wins: 89,
			losses: 63,
		})).toBe(".586");
	});

	it("an unbeaten team is 1.000; before any game, .000", () =>
	{
		expect(winningPercentage({
			wins: 3,
			losses: 0,
		})).toBe("1.000");
		expect(winningPercentage({
			wins: 0,
			losses: 0,
		})).toBe(".000");
	});
});
