import type {
	StandingsPick, StandingsResponse, StandingsSnapshot,
} from "@bt/domain";
import {
	mlbToday, previousStandingsPhase, standingsPhase,
} from "@bt/domain";
import type { IngestDeps } from "./ingest.js";
import { calendarsAround } from "./scoreboard-date.js";

/** One picked table from MLB, labelled with what it is: its phase, season and the day it stands as of. */
async function fetchPick(mlb: IngestDeps["mlb"], pick: StandingsPick): Promise<StandingsSnapshot>
{
	const table = pick.phase === "final"
		? await mlb.fetchFinalStandings(pick.season)
		: pick.phase === "spring"
			? await mlb.fetchSpringStandings(pick.season, pick.date)
			: await mlb.fetchStandings(pick.date);
	return {
		...table,
		phase: pick.phase,
		season: pick.season,
		date: pick.date,
	};
}

/** True when MLB answered a table with no team in it (no game of the phase is final yet). */
function isEmpty(table: StandingsSnapshot): boolean
{
	return table.divisions.every((division) => division.teams.length === 0);
}

/**
 * The standings for `day`, or MLB's today when absent (S128): `standingsPhase` picks the table
 * from the day's year's and the year before's calendars (so a past date gets its own season's),
 * and when that table is empty — the morning of the first spring day or of opening day — the
 * previous phase's table is returned instead, labelled as what it is; any other day's empty
 * table is returned as it is, labelled with its own phase. MLB requests: two
 * calendars (four requests), one table, and one more only for that fallback. An MLB error on a
 * table is thrown, never turned into an empty one; a calendar MLB can't give is left out, so
 * with none it is the day's regular-season table.
 */
export async function getStandings(deps: Pick<IngestDeps, "mlb" | "now">, day?: string): Promise<StandingsResponse>
{
	const date = day ?? mlbToday(deps.now?.() ?? new Date());
	const seasons = await calendarsAround(deps.mlb, date);
	const pick = standingsPhase(date, seasons);
	const table = await fetchPick(deps.mlb, pick);
	if (!isEmpty(table)) return table;
	const previous = previousStandingsPhase(pick, seasons);
	return previous ? await fetchPick(deps.mlb, previous) : table;
}
