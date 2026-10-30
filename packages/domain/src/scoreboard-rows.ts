/**
 * How the scoreboard lays out a day (S68; shell-scoreboard `scoreboard-collapsed-*`):
 * with Collapse Non-Favorites on, games featuring a favorite team stay full modules and
 * come first; the rest fold into slim bars. One answer for the page (ADR-025).
 */
import { gamePhase } from "./game-phase.js";
import { inningLabel } from "./inning.js";
import { countShorthand } from "./slot-occupant.js";
import type { ScheduleGameSummary } from "./types.js";

export type ScoreboardRow = {
	game: ScheduleGameSummary;
	collapsed: boolean;
};

/**
 * The day's games as rows. With Collapse Non-Favorites off — or no favorites to keep
 * open — every game is a full module in the order given. On, favorites' games come
 * first (in their given order), then every other game collapsed.
 */
export function scoreboardRows(games: readonly ScheduleGameSummary[], favoriteTeamIds: readonly number[], collapseNonFavorites: boolean): ScoreboardRow[]
{
	if (!collapseNonFavorites || favoriteTeamIds.length === 0)
	{
		return games.map((game) => ({
			game,
			collapsed: false,
		}));
	}
	const favorite = (game: ScheduleGameSummary) => favoriteTeamIds.includes(game.teams.away.id) || favoriteTeamIds.includes(game.teams.home.id);
	return [
		...games.filter(favorite).map((game) => ({
			game,
			collapsed: false,
		})),
		...games.filter((game) => !favorite(game)).map((game) => ({
			game,
			collapsed: true,
		})),
	];
}

export type CollapsedBarState = {
	/** `5–2`, centered between the teams; `null` with scores hidden or no runs yet (the bar shows `@`). */
	score: string | null;
	/** The muted line under it: `Final`, or the inning and count while live (`Bot 7th · 2-2, 2 out`). */
	state: string;
};

/**
 * What a collapsed bar says (S56 A2, S57 A3; owner, 2026-10-30: "the collapsed ones should
 * show the score (when it's not hidden) by centering the score with the teams on either
 * side, like: NYY  5 - 2  BOS, with the BSO subtly under it"). Live: the score, then the
 * inning and the count (`countShorthand`) under it; final: the score over `Final`. With
 * scores hidden the score is left out and the state stays — the count too, as on the
 * module (A3). Before first pitch there is no score or inning, so `null`: the bar shows
 * its start time.
 */
export function collapsedBarState(game: Pick<ScheduleGameSummary, "status" | "linescore" | "live">, scoresHidden: boolean): CollapsedBarState | null
{
	const phase = gamePhase(game.status.codedGameState);
	if (phase === "pregame") return null;
	const count = phase === "live" && game.live ? countShorthand(game.live) : null;
	const inning = phase === "final" ? "Final" : inningLabel(game.linescore) ?? "Live";
	const away = game.linescore?.teams.away.runs;
	const home = game.linescore?.teams.home.runs;
	return {
		score: scoresHidden || away == null || home == null ? null : `${away}–${home}`,
		state: count ? `${inning} · ${count}` : inning,
	};
}
