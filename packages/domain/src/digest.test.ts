import {
	describe, expect, it,
} from "vitest";
import { DIGEST_SIZE, dayDigest } from "./digest.js";
import type { DigestGame } from "./digest.js";
import type { MediaHighlight } from "./types.js";

function clip(id: string, title: string): MediaHighlight
{
	return {
		id,
		playId: null,
		title,
		blurb: null,
		duration: "00:00:30",
		imageUrl: null,
		playbackUrl: null,
	};
}

function game(gamePk: number, away: string, home: string, highlights: MediaHighlight[]): DigestGame
{
	return {
		gamePk,
		officialDate: "2026-09-21",
		teams: {
			away: {
				id: 1,
				abbreviation: away,
				name: away,
				teamName: away,
			},
			home: {
				id: 2,
				abbreviation: home,
				name: home,
				teamName: home,
			},
		},
		highlights,
	};
}

const DAY = [
	game(1, "NYY", "BOS", [clip("a", "Batter steps in"), clip("b", "Judge go-ahead home run")]),
	game(2, "LAD", "SD", [clip("c", "Walk-off grand slam, a home run to win it"), clip("d", "Pitching change")]),
	game(3, "CHC", "MIL", []),
];

describe("dayDigest (S71)", () =>
{
	it("dayDigest: ranks every game's clips together by the impact rule, numbered from 1, each with its game", () =>
	{
		const items = dayDigest(DAY);
		expect(items.map((i) => i.highlight.id)).toEqual(["c", "b", "a", "d"]);
		expect(items.map((i) => i.rank)).toEqual([1, 2, 3, 4]);
		expect(items[0]!.game).toEqual({
			gamePk: 2,
			officialDate: "2026-09-21",
			away: "LAD",
			home: "SD",
		});
		expect(items[1]!.game.gamePk).toBe(1);
	});

	it("watch first: only the top clip is flagged", () =>
	{
		expect(dayDigest(DAY).map((i) => i.watchFirst)).toEqual([true, false, false, false]);
	});

	it("keeps the top `limit` (DIGEST_SIZE by default); a day with no clips has none", () =>
	{
		expect(dayDigest(DAY, 2).map((i) => i.highlight.id)).toEqual(["c", "b"]);
		const many = [game(9, "A", "B", Array.from({
			length: DIGEST_SIZE + 3,
		}, (_, n) => clip(`x${n}`, `Clip ${n}`)))];
		expect(dayDigest(many)).toHaveLength(DIGEST_SIZE);
		expect(dayDigest([game(3, "CHC", "MIL", [])])).toEqual([]);
	});

	it("a clip two games list is kept once, with the first game", () =>
	{
		const shared = clip("s", "Home run derby");
		const items = dayDigest([game(1, "NYY", "BOS", [shared]), game(2, "LAD", "SD", [shared])]);
		expect(items).toHaveLength(1);
		expect(items[0]!.game.gamePk).toBe(1);
	});
});
