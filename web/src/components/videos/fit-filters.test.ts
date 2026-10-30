import {
	describe, expect, it,
} from "vitest";
import { fittingFilters } from "./fit-filters.js";

describe("fittingFilters (S69)", () =>
{
	it("shows every pill when they all fit, without a Filters button", () =>
	{
		expect(fittingFilters([100, 80], 70, 188, 8)).toEqual([0, 1]);
	});

	it("otherwise every pill, in order, that fits with the Filters button kept at the end", () =>
	{
		expect(fittingFilters([100, 80, 90], 70, 266, 8)).toEqual([0, 1]);
		expect(fittingFilters([100, 80, 90], 70, 180, 8)).toEqual([0]);
		expect(fittingFilters([120, 60], 70, 160, 8)).toEqual([1]);
		expect(fittingFilters([100, 80], 70, 120, 8)).toEqual([]);
	});

	it("a row not laid out yet shows all", () =>
	{
		expect(fittingFilters([100, 80], 70, 0, 8)).toEqual([0, 1]);
	});
});
