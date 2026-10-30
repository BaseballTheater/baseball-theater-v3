/**
 * A team's season record as the scoreboard module prints it (S66; shell-scoreboard
 * `Rich Scoreboard Module`, R7). One label for every module row (ADR-025): views
 * render it and never divide wins by games themselves.
 */
import type { GamePhase } from "./game-phase.js";
import type { TeamRecord } from "./types.js";

/**
 * `.520` — wins over games played, to three places with no leading zero, as box
 * scores print it; `1.000` for an unbeaten team and `.000` before any game.
 */
export function winningPercentage(record: TeamRecord): string
{
	const games = record.wins + record.losses;
	const pct = games === 0 ? 0 : record.wins / games;
	return pct.toFixed(3).replace(/^0\./, ".");
}

/**
 * The line under a team's name. Rows with scores (live, final) carry the
 * abbreviation and record, `NYY (94-58)` (R7); a scheduled row, which has no score
 * yet, carries the record with its percentage, `79 - 73 (.520)`. With no record from
 * MLB, a scored row keeps the abbreviation alone and a scheduled row has no line (`null`).
 */
export function teamRecordLabel(team: { abbreviation: string;
	record?: TeamRecord | null; }, phase: GamePhase): string | null
{
	const { record } = team;
	if (phase === "pregame")
	{
		return record ? `${record.wins} - ${record.losses} (${winningPercentage(record)})` : null;
	}
	return record ? `${team.abbreviation} (${record.wins}-${record.losses})` : team.abbreviation;
}
