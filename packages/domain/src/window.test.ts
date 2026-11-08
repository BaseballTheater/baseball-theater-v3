import {
	describe, expect, it,
} from "vitest";
import {
	DEFAULT_CADENCE,
	isFinalStatus,
	isGameInActiveWindow,
	isLiveStatus,
	normalizeStatusCode,
	scheduleWindowMode,
} from "./window.js";
import type { ScheduleGameSummary } from "./types.js";

type WindowGame = Pick<ScheduleGameSummary, "officialDate" | "status"> & {
	gameDateTime?: string | null;
};

function game(codedGameState: string, gameDateTime?: string | null): WindowGame
{
	return {
		officialDate: "2024-07-04",
		status: {
			abstractGameState: "Preview",
			codedGameState,
			detailedState: "Scheduled",
		},
		gameDateTime,
	};
}

describe("isLiveStatus", () =>
{
	it("treats only in-progress as live", () =>
	{
		expect(isLiveStatus("I")).toBe(true);
	});

	it("treats pre-game warm-up and delays as not live (no Live tab)", () =>
	{
		expect(isLiveStatus("P")).toBe(false);
		expect(isLiveStatus("D")).toBe(false);
	});

	it("rejects scheduled and final codes", () =>
	{
		expect(isLiveStatus("S")).toBe(false);
		expect(isLiveStatus("F")).toBe(false);
		expect(isLiveStatus("U")).toBe(false);
	});
});

describe("isFinalStatus", () =>
{
	it("treats final, game over, and cancelled as final", () =>
	{
		expect(isFinalStatus("F")).toBe(true);
		expect(isFinalStatus("O")).toBe(true);
		expect(isFinalStatus("C")).toBe(true);
	});

	it("rejects live and scheduled codes", () =>
	{
		expect(isFinalStatus("I")).toBe(false);
		expect(isFinalStatus("S")).toBe(false);
	});
});

describe("normalizeStatusCode", () =>
{
	it("returns 'U' for unknown codes", () =>
	{
		expect(normalizeStatusCode("X")).toBe("U");
		expect(normalizeStatusCode("live")).toBe("U");
	});

	it("returns 'U' for missing values", () =>
	{
		expect(normalizeStatusCode(undefined)).toBe("U");
		expect(normalizeStatusCode(null)).toBe("U");
		expect(normalizeStatusCode("")).toBe("U");
	});

	it("uppercases and passes through known codes", () =>
	{
		expect(normalizeStatusCode("i")).toBe("I");
		expect(normalizeStatusCode("F")).toBe("F");
		expect(normalizeStatusCode("s")).toBe("S");
	});
});

describe("isGameInActiveWindow", () =>
{
	it("keeps live games in the window regardless of clock", () =>
	{
		const farFromStart = new Date("2024-07-10T09:00:00.000Z");
		expect(
			isGameInActiveWindow(game("I", "2024-07-04T23:05:00.000Z"), farFromStart),
		).toBe(true);
	});

	it("keeps polling a delayed game past the trail, though it is not live", () =>
	{
		const farFromStart = new Date("2024-07-10T09:00:00.000Z");
		expect(
			isGameInActiveWindow(game("D", "2024-07-04T23:05:00.000Z"), farFromStart),
		).toBe(true);
	});

	it("keeps a final game in the window while inside the trail", () =>
	{
		// No gameDateTime -> assumed start 17:00Z, assumed end 21:00Z, trail 3h -> 00:00Z.
		const insideTrail = new Date("2024-07-04T23:00:00.000Z");
		expect(isGameInActiveWindow(game("F"), insideTrail)).toBe(true);
	});

	it("drops a final game once the trail has elapsed", () =>
	{
		const afterTrail = new Date("2024-07-05T02:00:00.000Z");
		expect(isGameInActiveWindow(game("F"), afterTrail)).toBe(false);
	});

	it("keeps a scheduled game in the window inside the lead hours", () =>
	{
		// Start 23:05Z, lead 2h -> window opens 21:05Z.
		const insideLead = new Date("2024-07-04T22:00:00.000Z");
		expect(isGameInActiveWindow(game("S", "2024-07-04T23:05:00.000Z"), insideLead)).toBe(
			true,
		);
	});

	it("drops a scheduled game far before the lead window", () =>
	{
		const longBefore = new Date("2024-07-04T12:00:00.000Z");
		expect(isGameInActiveWindow(game("S", "2024-07-04T23:05:00.000Z"), longBefore)).toBe(
			false,
		);
	});

	it("drops a scheduled game far after the trail window", () =>
	{
		const longAfter = new Date("2024-07-05T09:00:00.000Z");
		expect(isGameInActiveWindow(game("S", "2024-07-04T23:05:00.000Z"), longAfter)).toBe(
			false,
		);
	});

	it("honors custom cadence leadHours and trailHours", () =>
	{
		const start = "2024-07-04T23:05:00.000Z";

		// leadHours: 18:00Z is outside default 2h lead, inside 8h lead.
		const beforeStart = new Date("2024-07-04T18:00:00.000Z");
		expect(isGameInActiveWindow(game("S", start), beforeStart, DEFAULT_CADENCE)).toBe(
			false,
		);
		expect(
			isGameInActiveWindow(game("S", start), beforeStart, {
				...DEFAULT_CADENCE,
				leadHours: 8,
				trailHours: 3,
			}),
		).toBe(true);

		// trailHours (scheduled path): start+trail. Default trail ends 02:05Z;
		// trailHours:1 ends 00:05Z — 01:00Z distinguishes them.
		const afterStart = new Date("2024-07-05T01:00:00.000Z");
		expect(
			isGameInActiveWindow(game("S", start), afterStart, {
				...DEFAULT_CADENCE,
				leadHours: 2,
				trailHours: 3,
			}),
		).toBe(true);
		expect(
			isGameInActiveWindow(game("S", start), afterStart, {
				...DEFAULT_CADENCE,
				leadHours: 2,
				trailHours: 1,
			}),
		).toBe(false);

		// trailHours (final path): assumedEnd = start+4h = 03:05Z; +trailHours.
		// Default trail still active at 05:00Z; trailHours:1 is not.
		const afterFinalAssumedEnd = new Date("2024-07-05T05:00:00.000Z");
		expect(
			isGameInActiveWindow(game("F", start), afterFinalAssumedEnd, {
				...DEFAULT_CADENCE,
				leadHours: 2,
				trailHours: 3,
			}),
		).toBe(true);
		expect(
			isGameInActiveWindow(game("F", start), afterFinalAssumedEnd, {
				...DEFAULT_CADENCE,
				leadHours: 2,
				trailHours: 1,
			}),
		).toBe(false);
	});

	it("falls back to the official date when no start time is known", () =>
	{
		// Assumed start 17:00Z, lead 2h -> window opens 15:00Z.
		expect(
			isGameInActiveWindow(game("S", null), new Date("2024-07-04T16:00:00.000Z")),
		).toBe(true);
		expect(isGameInActiveWindow(game("S"), new Date("2024-07-04T10:00:00.000Z"))).toBe(
			false,
		);
	});

	it("returns false when the start time cannot be parsed", () =>
	{
		expect(
			isGameInActiveWindow(game("S", "not-a-date"), new Date("2024-07-04T22:00:00.000Z")),
		).toBe(false);
	});

	it("treats an unknown status code as scheduled for windowing", () =>
	{
		const start = "2024-07-04T23:05:00.000Z";
		// Far outside lead/trail: live would still be true; scheduled/unknown must be false.
		const farAway = new Date("2024-07-10T09:00:00.000Z");
		expect(isGameInActiveWindow(game("I", start), farAway)).toBe(true);
		expect(isGameInActiveWindow(game("XX", start), farAway)).toBe(false);
		// Inside lead still active (same as scheduled).
		const insideLead = new Date("2024-07-04T22:00:00.000Z");
		expect(isGameInActiveWindow(game("XX", start), insideLead)).toBe(true);
	});
});

describe("isGameInActiveWindow reads the schedule's own start time", () =>
{
	// Regression: the helper used to read only `gameDateTime`, which no
	// production type carries — every real ScheduleGameSummary fell back to the
	// 17:00Z assumption, so a late game left the window before it ended.
	const lateGame = {
		officialDate: "2024-07-04",
		gameDate: "2024-07-04T22:30:00.000Z",
		status: {
			codedGameState: "S",
		} as ScheduleGameSummary["status"],
	};

	it("keeps a late start in the window when the 17:00Z fallback would not", () =>
	{
		const during = new Date("2024-07-04T23:00:00.000Z");
		expect(isGameInActiveWindow(lateGame, during)).toBe(true);
		// Same instant, without a start time: the fallback has already trailed off.
		const { gameDate: _drop, ...noStart } = lateGame;
		expect(isGameInActiveWindow(noStart, during)).toBe(false);
	});
});

describe("scheduleWindowMode (S122)", () =>
{
	it("a day is active while any game is in its window, cache otherwise; params pass through", () =>
	{
		const now = new Date("2024-07-04T18:00:00Z");
		expect(scheduleWindowMode([], now)).toBe("cache");
		expect(scheduleWindowMode([game("F", "2024-07-01T17:00:00Z"), game("I", "2024-07-04T17:00:00Z")], now)).toBe("active");
		expect(scheduleWindowMode([game("F", "2024-07-01T17:00:00Z")], now)).toBe("cache");
		const later = game("S", "2024-07-04T23:00:00Z");
		expect(scheduleWindowMode([later], now, {
			...DEFAULT_CADENCE,
			leadHours: 1,
		})).toBe("cache");
		expect(scheduleWindowMode([later], now, {
			...DEFAULT_CADENCE,
			leadHours: 6,
		})).toBe("active");
	});
});
