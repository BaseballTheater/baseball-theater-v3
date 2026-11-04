import {
	describe, expect, it,
} from "vitest";
import { rankHighlightsByImpact } from "./impact.js";
import { isGameInActiveWindow, isLiveStatus } from "./window.js";
import type { AtBat } from "./plays.js";
import type { AtBatMetrics, MediaHighlight } from "./types.js";

describe("rankHighlightsByImpact", () =>
{
	it("ranks walk-offs and HRs above filler", () =>
	{
		const highlights: MediaHighlight[] = [
			{
				id: "1",
				playId: null,
				title: "Batter steps in",
				blurb: null,
				duration: null,
				imageUrl: null,
				playbackUrl: null,
			},
			{
				id: "2",
				playId: "p2",
				title: "Walk-off home run!",
				blurb: "Go-ahead blast",
				duration: null,
				imageUrl: null,
				playbackUrl: null,
			},
		];
		const ranked = rankHighlightsByImpact(highlights);
		expect(ranked[0]?.id).toBe("2");
	});
});

/** A clip on pitch `playId` (or none), titled `title`. */
const clip = (id: string, playId: string | null, title = `Clip ${id}`): MediaHighlight => ({
	id,
	playId,
	title,
	blurb: null,
	duration: null,
	imageUrl: null,
	playbackUrl: null,
});
/** An at-bat whose one pitch is `pitchId`; only what the rank reads. */
const atBat = (atBatIndex: number, pitchId: string) => ({
	about: {
		atBatIndex,
	},
	pitches: [{
		playId: pitchId,
	}],
}) as unknown as AtBat;
/** S93 metrics for an at-bat: `added` points to the home side (the away side the opposite). */
const metric = (atBatIndex: number, added: number | null, flags: Partial<AtBatMetrics> = {}): AtBatMetrics => ({
	atBatIndex,
	homeWinProbability: null,
	awayWinProbability: null,
	homeWinProbabilityAdded: added,
	awayWinProbabilityAdded: added == null ? null : -added,
	keyMoment: false,
	leadChange: false,
	scoring: false,
	homeRun: false,
	hardHit: false,
	strikeout: false,
	highLeverage: false,
	absChallenge: false,
	hitData: {
		launchSpeed: null,
		launchAngle: null,
		totalDistance: null,
	},
	...flags,
});

describe("rankHighlightsByImpact with play metrics (S98)", () =>
{
	const plays = [atBat(1, "p1"), atBat(2, "p2"), atBat(3, "p3"), atBat(4, "p4"), atBat(5, "p5")];

	it("S98 AC 1: a clip with a play ranks by the absolute win probability its play added, whichever team it helped", () =>
	{
		const ranked = rankHighlightsByImpact([clip("a", "p1", "Solo home run"), clip("b", "p2", "Diving catch"), clip("c", "p3", "Grand slam")], {
			plays,
			playMetrics: {
				atBats: [metric(1, 4), metric(2, -21.5), metric(3, 12)],
			},
		});
		expect(ranked.map((h) => h.id)).toEqual(["b", "c", "a"]);
	});

	it("S98 AC 1: among equal swings key moments come first, then lead changes, then keywords", () =>
	{
		const ranked = rankHighlightsByImpact([clip("a", "p1", "Walk-off home run"), clip("b", "p2"), clip("c", "p3"), clip("d", "p4")], {
			plays,
			playMetrics: {
				atBats: [metric(1, 10), metric(2, 10, {
					leadChange: true,
				}), metric(3, 10, {
					keyMoment: true,
				}), metric(4, 10, {
					keyMoment: true,
					leadChange: true,
				})],
			},
		});
		expect(ranked.map((h) => h.id)).toEqual(["d", "c", "b", "a"]);
	});

	it("S98 AC 1: clips without a measured play follow, in keyword order", () =>
	{
		const ranked = rankHighlightsByImpact([
			clip("graphic", null, "Animated look at the home run"),
			clip("recap", null, "Recap"),
			clip("unmeasured", "p5", "Go-ahead home run"),
			clip("small", "p1", "Strikeout"),
		], {
			plays,
			playMetrics: {
				atBats: [metric(1, 0.5), metric(5, null)],
			},
		});
		expect(ranked.map((h) => h.id)).toEqual(["small", "unmeasured", "graphic", "recap"]);
	});

	it("S98 AC 3: with no play metrics the order is the keyword order alone", () =>
	{
		const clips = [clip("a", "p1", "Strikeout"), clip("b", "p2", "Solo home run"), clip("c", null, "Recap")];
		expect(rankHighlightsByImpact(clips, {
			plays,
		}).map((h) => h.id)).toEqual(rankHighlightsByImpact(clips).map((h) => h.id));
		expect(rankHighlightsByImpact(clips).map((h) => h.id)).toEqual(["b", "a", "c"]);
	});
});

describe("window", () =>
{
	it("treats live games as in window", () =>
	{
		expect(isLiveStatus("I")).toBe(true);
		const now = new Date("2024-07-04T20:00:00.000Z");
		expect(
			isGameInActiveWindow(
				{
					officialDate: "2024-07-04",
					status: {
						abstractGameState: "Live",
						codedGameState: "I",
						detailedState: "In Progress",
					},
				},
				now,
			),
		).toBe(true);
	});
});
