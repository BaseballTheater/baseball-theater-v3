/**
 * How the scoreboard lays out a day (S68; shell-scoreboard `scoreboard-collapsed-*`):
 * with Collapse Non-Favorites on, games featuring a favorite team stay full modules and
 * come first; the rest fold into slim bars. One answer for the page (ADR-025).
 */
import { gamePhase } from "./game-phase.js";
import { inningLabel } from "./inning.js";
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

/**
 * The right side of a collapsed bar (S56 A2, S57 A3): `2–1 · Bot 7th` while live,
 * `5–3 · Final` after; with scores hidden, the state alone (`Bot 7th`, `Final`). Before
 * first pitch there is no score or inning, so `null` — the bar shows its start time.
 */
export function collapsedBarState(game: Pick<ScheduleGameSummary, "status" | "linescore">, scoresHidden: boolean): string | null
{
	const phase = gamePhase(game.status.codedGameState);
	if (phase === "pregame") return null;
	const state = phase === "final" ? "Final" : inningLabel(game.linescore) ?? "Live";
	const away = game.linescore?.teams.away.runs;
	const home = game.linescore?.teams.home.runs;
	if (scoresHidden || away == null || home == null) return state;
	return `${away}–${home} · ${state}`;
}
