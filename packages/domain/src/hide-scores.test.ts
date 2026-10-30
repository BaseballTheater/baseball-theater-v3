import {
	describe, expect, it,
} from "vitest";
import { shouldHideScores } from "./hide-scores.js";

describe("shouldHideScores (S68)", () =>
{
	it("on hides, off shows", () =>
	{
		expect(shouldHideScores({
			hideScores: true,
		})).toBe(true);
		expect(shouldHideScores({
			hideScores: false,
		})).toBe(false);
	});

	it("gives the same answer with a game as without, while the setting is on/off", () =>
	{
		const game = {
			gamePk: 823823,
		};
		expect(shouldHideScores({
			hideScores: true,
		}, game)).toBe(true);
		expect(shouldHideScores({
			hideScores: false,
		}, game)).toBe(false);
	});
});
