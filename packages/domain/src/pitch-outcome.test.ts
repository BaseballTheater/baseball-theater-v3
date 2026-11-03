import {
	describe, expect, it,
} from "vitest";
import {
	isSwingingStrike, pitchCallLabel, pitchOutcome,
} from "./pitch-outcome.js";

function pitch(isBall: boolean, isStrike: boolean, isInPlay: boolean)
{
	return {
		details: {
			call: "X",
			callDescription: "test",
			type: "FF",
			typeDescription: "Four-Seam Fastball",
			isBall,
			isStrike,
			isInPlay,
			ballColor: "rgba(170, 21, 11, 1.0)",
		},
	};
}

describe("pitchOutcome", () =>
{
	it("reads a ball", () =>
	{
		expect(pitchOutcome(pitch(true, false, false))).toBe("ball");
	});

	it("reads a called / swinging strike or foul", () =>
	{
		expect(pitchOutcome(pitch(false, true, false))).toBe("strike");
	});

	it("reads a ball in play, even if a strike flag is also set", () =>
	{
		expect(pitchOutcome(pitch(false, false, true))).toBe("inPlay");
		expect(pitchOutcome(pitch(false, true, true))).toBe("inPlay");
	});

	it("reads an unflagged pitch (hit-by-pitch, pitchout) as a ball", () =>
	{
		expect(pitchOutcome(pitch(false, false, false))).toBe("ball");
	});
});

describe("isSwingingStrike", () =>
{
	const call = (code: string | null, isStrike = true) => ({
		details: {
			...pitch(!isStrike, isStrike, false).details,
			call: code,
		},
	});

	it("reads a swing and a miss — swinging, blocked, foul tip, missed bunt, swinging pitchout — as swinging", () =>
	{
		for (const code of ["S", "W", "T", "M", "Q"]) expect(isSwingingStrike(call(code))).toBe(true);
	});

	it("reads a called strike, a foul, a ball or a missing call as not swinging", () =>
	{
		expect(isSwingingStrike(call("C"))).toBe(false);
		expect(isSwingingStrike(call("F"))).toBe(false);
		expect(isSwingingStrike(call("S", false))).toBe(false);
		expect(isSwingingStrike(call(null))).toBe(false);
	});
});

describe("pitchCallLabel (S75)", () =>
{
	const call = (code: string, callDescription: string, outcome: [boolean, boolean, boolean]) =>
	{
		const p = pitch(...outcome);
		return {
			details: {
				...p.details,
				call: code,
				callDescription,
			},
		};
	};
	const scored = call("E", "In play, run(s)", [false, false, true]);
	const out = call("X", "In play, out(s)", [false, false, true]);
	const strike = call("C", "Called Strike", [false, true, false]);

	it("reads IN PLAY for an in-play pitch that scored with scores hidden", () =>
	{
		expect(pitchCallLabel(scored, true)).toBe("IN PLAY");
	});

	it("leaves an in-play pitch that didn't score as MLB words it with scores hidden (owner, 2026-11-03)", () =>
	{
		expect(pitchCallLabel(out, true)).toBe("In play, out(s)");
	});

	it("is MLB's full call with scores shown", () =>
	{
		expect(pitchCallLabel(scored, false)).toBe("In play, run(s)");
		expect(pitchCallLabel(out, false)).toBe("In play, out(s)");
	});

	it("leaves every other call alone with scores hidden", () =>
	{
		expect(pitchCallLabel(strike, true)).toBe("Called Strike");
	});

	it("falls back to the call code when MLB sent no description", () =>
	{
		expect(pitchCallLabel({
			details: {
				...strike.details,
				callDescription: null,
			},
		}, false)).toBe("C");
	});
});
