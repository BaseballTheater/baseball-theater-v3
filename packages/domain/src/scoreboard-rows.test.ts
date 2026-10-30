import {
	describe, expect, it,
} from "vitest";
import { collapsedBarState, scoreboardRows } from "./scoreboard-rows.js";
import type { ScheduleGameSummary } from "./types.js";

/** Only the team ids matter to the layout; the rest of a game is left out. */
const game = (pk: number, away: number, home: number) => ({
	gamePk: pk,
	teams: {
		away: {
			id: away,
		},
		home: {
			id: home,
		},
	},
}) as unknown as ScheduleGameSummary;

const DAY = [game(1, 137, 121), game(2, 112, 146), game(3, 147, 111)];

describe("scoreboardRows (S68)", () =>
{
	it("collapses every game without a favorite team and puts favorites first", () =>
	{
		const rows = scoreboardRows(DAY, [146], true);
		expect(rows.map((r) => [r.game.gamePk, r.collapsed])).toEqual([[2, false], [1, true], [3, true]]);
	});

	it("with no favorites nothing collapses and the order is kept", () =>
	{
		expect(scoreboardRows(DAY, [], true).map((r) => [r.game.gamePk, r.collapsed])).toEqual([[1, false], [2, false], [3, false]]);
	});

	it("with Collapse Non-Favorites off nothing collapses, favorites or not", () =>
	{
		expect(scoreboardRows(DAY, [146], false).every((r) => !r.collapsed)).toBe(true);
		expect(scoreboardRows(DAY, [146], false).map((r) => r.game.gamePk)).toEqual([1, 2, 3]);
	});
});

const status = (codedGameState: string) => ({
	abstractGameState: "",
	codedGameState,
	detailedState: "",
});
const line = (away: number | null, home: number | null, inning = 7, inningState = "Bottom") => ({
	currentInning: inning,
	inningState,
	isTopInning: false,
	outs: 1,
	balls: 0,
	strikes: 0,
	teams: {
		away: {
			runs: away,
			hits: 0,
			errors: 0,
		},
		home: {
			runs: home,
			hits: 0,
			errors: 0,
		},
	},
}) as never;

describe("collapsedBarState (S68)", () =>
{
	it("score and inning while live, score and Final after (A2)", () =>
	{
		expect(collapsedBarState({
			status: status("I"),
			linescore: line(2, 1),
		}, false)).toBe("2–1 · Bot 7th");
		expect(collapsedBarState({
			status: status("F"),
			linescore: line(5, 3),
		}, false)).toBe("5–3 · Final");
	});

	it("with scores hidden, the state only (A3)", () =>
	{
		expect(collapsedBarState({
			status: status("I"),
			linescore: line(2, 1),
		}, true)).toBe("Bot 7th");
		expect(collapsedBarState({
			status: status("F"),
			linescore: line(5, 3),
		}, true)).toBe("Final");
	});

	it("no score yet reads the state alone; before first pitch there is none", () =>
	{
		expect(collapsedBarState({
			status: status("I"),
			linescore: null,
		}, false)).toBe("Live");
		expect(collapsedBarState({
			status: status("S"),
			linescore: null,
		}, false)).toBeNull();
	});
});
