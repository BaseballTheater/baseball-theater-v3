import {
	describe, expect, it,
} from "vitest";
import type { GamePhase } from "./game-phase.js";
import type { GameRowSlot } from "./settings.js";
import type { SlotOccupant } from "./slot-occupant.js";
import {
	countShorthand, probableLine, slotOccupant,
} from "./slot-occupant.js";

describe("slotOccupant (S67)", () =>
{
	it.each([
		["status", "final", "pitchersOfRecord"],
		["status", "live", "count"],
		["status", "pregame", "probables"],
		["roomMenu", "final", "roomMenu"],
		["roomMenu", "live", "roomMenu"],
		["roomMenu", "pregame", "roomMenu"],
	] as [GameRowSlot, GamePhase, SlotOccupant][])("slotOccupant: %s on a %s game → %s", (setting, phase, occupant) =>
	{
		expect(slotOccupant(setting, phase)).toBe(occupant);
	});
});

describe("probableLine (S67)", () =>
{
	it("W-L, ERA as the frame draws it", () =>
	{
		expect(probableLine({
			wins: 11,
			losses: 5,
			era: "3.12",
		})).toBe("11-5, 3.12");
	});

	it("leaves out what MLB didn't send; null when it sent nothing", () =>
	{
		expect(probableLine({
			wins: null,
			losses: null,
			era: "0.00",
		})).toBe("0.00");
		expect(probableLine({
			wins: 0,
			losses: 1,
			era: null,
		})).toBe("0-1");
		expect(probableLine({
			wins: null,
			losses: null,
			era: null,
		})).toBeNull();
	});
});

describe("countShorthand (S67)", () =>
{
	it("balls-strikes, then outs, as the frame writes it", () =>
	{
		expect(countShorthand({
			balls: 0,
			strikes: 2,
			outs: 2,
		})).toBe("0-2, 2 out");
		expect(countShorthand({
			balls: 3,
			strikes: 1,
			outs: null,
		})).toBe("3-1");
	});

	it("null until MLB sends a count", () =>
	{
		expect(countShorthand({
			balls: null,
			strikes: 0,
			outs: 1,
		})).toBeNull();
	});
});
