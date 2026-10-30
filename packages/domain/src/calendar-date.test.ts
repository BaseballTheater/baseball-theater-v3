import {
	describe, expect, it,
} from "vitest";
import { addDays } from "./calendar-date.js";

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
