import type { AtBat } from "./plays.js";
import type {
	AtBatMetrics, GamePlayMetrics, MediaHighlight,
} from "./types.js";
import { atBatIndexByPitch } from "./video-play-links.js";

/**
 * What the rank needs to measure a clip by its play (S98): the game's at-bats, to find the
 * at-bat a clip's pitch belongs to, and S93's play metrics for them. Without metrics (an older
 * recording, or the feed down) every clip falls back to its keyword score.
 */
export type ImpactPlayContext = {
	plays: readonly AtBat[];
	playMetrics?: GamePlayMetrics;
};

const HIGH_IMPACT = [
	"walk-off",
	"walk off",
	"grand slam",
	"home run",
	"homers",
	"go-ahead",
	"ties it",
	"steal home",
];

/** A clip's title + blurb keyword score: the fallback order for clips with no measured play. */
function keywordScore(h: MediaHighlight): number
{
	const text = `${h.title} ${h.blurb ?? ""}`.toLowerCase();
	return HIGH_IMPACT.filter((kw) => text.includes(kw)).length * 10;
}

/**
 * How far an at-bat moved the game, in percentage points either way: the larger of the home and
 * away win probability it added, by absolute value. Null when MLB measured neither.
 */
function winProbabilitySwing(m: AtBatMetrics): number | null
{
	const added = [m.homeWinProbabilityAdded, m.awayWinProbabilityAdded].filter((v): v is number => v != null);
	return added.length ? Math.max(...added.map(Math.abs)) : null;
}

/**
 * The Videos room's impact order (S98; owner, 2026-10-30, "Yes" to ranking by win probability).
 * A clip whose play MLB measured ranks by how much that play swung the chance of winning, larger
 * first; among equal swings key moments, then lead changes, come first. Every other clip (no
 * play, or a play with no metrics) follows, ordered by its title/blurb keywords. The id breaks
 * any remaining tie, so the order is stable. With no `context` this is the keyword order alone.
 */
export function rankHighlightsByImpact(highlights: MediaHighlight[], context?: ImpactPlayContext): MediaHighlight[]
{
	const atBatOfPitch = context ? atBatIndexByPitch(context.plays) : new Map<string, number>();
	const metricsByAtBat = new Map((context?.playMetrics?.atBats ?? []).map((m) => [m.atBatIndex, m]));

	const scored = highlights.map((h) =>
	{
		const atBat = h.playId == null ? undefined : atBatOfPitch.get(h.playId);
		const metrics = atBat == null ? undefined : metricsByAtBat.get(atBat);
		const swing = metrics ? winProbabilitySwing(metrics) : null;
		return {
			h,
			swing,
			keyMoment: swing != null && metrics!.keyMoment ? 1 : 0,
			leadChange: swing != null && metrics!.leadChange ? 1 : 0,
			keywords: keywordScore(h),
		};
	});

	scored.sort((a, b) =>
	{
		if ((a.swing == null) !== (b.swing == null)) return a.swing == null ? 1 : -1;
		if (a.swing != null && b.swing != null && a.swing !== b.swing) return b.swing - a.swing;
		if (b.keyMoment !== a.keyMoment) return b.keyMoment - a.keyMoment;
		if (b.leadChange !== a.leadChange) return b.leadChange - a.leadChange;
		if (b.keywords !== a.keywords) return b.keywords - a.keywords;
		return a.h.id.localeCompare(b.h.id);
	});

	return scored.map((s) => s.h);
}
