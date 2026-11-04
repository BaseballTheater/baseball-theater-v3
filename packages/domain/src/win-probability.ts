import type { AtBat } from "./plays.js";
import type { GamePlayMetrics } from "./types.js";

/** One at-bat on the win-probability line: the home team's chance (percent, 0–100) after it, and its inning. */
export type WinProbabilityPoint = {
	atBatIndex: number;
	inning: number;
	home: number;
};

/** The home team's chance of winning over a game, at-bat by at-bat, and where it stands now. */
export type WinProbabilitySeries = {
	points: WinProbabilityPoint[];
	/** The latest point's value; null when there are no points. */
	current: number | null;
	/** `current` rounded to a whole percent, as the chart's label shows it. */
	currentPercent: number | null;
};

/**
 * The home team's win probability after each at-bat MLB measured (S106; S93's play metrics, the
 * same values Baseball Savant shows), in game order, each with the inning it was in. The one
 * implementation the Live room's chart and the scoreboard's Win Probability slot (S108) read
 * (ADR-025). An at-bat with no measured value is skipped rather than drawn at 0; an at-bat the
 * live feed doesn't have yet takes the inning of the at-bat before it. A game with no play
 * metrics (an older recording, or the feed down) has no points.
 */
export function winProbabilitySeries(game: { plays: readonly AtBat[];
	playMetrics?: GamePlayMetrics; }): WinProbabilitySeries
{
	const innings = new Map(game.plays.map((atBat) => [atBat.about.atBatIndex, atBat.about.inning]));
	const points: WinProbabilityPoint[] = [];
	for (const m of [...(game.playMetrics?.atBats ?? [])].sort((a, b) => a.atBatIndex - b.atBatIndex))
	{
		if (m.homeWinProbability == null) continue;
		const inning = innings.get(m.atBatIndex) ?? points.at(-1)?.inning ?? 1;
		points.push({
			atBatIndex: m.atBatIndex,
			inning,
			home: m.homeWinProbability,
		});
	}
	const current = points.at(-1)?.home ?? null;
	return {
		points,
		current,
		currentPercent: current == null ? null : Math.round(current),
	};
}
