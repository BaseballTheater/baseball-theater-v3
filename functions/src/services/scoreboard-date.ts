import type { ScoreboardDefaultDateResponse, SeasonCalendar } from "@bt/domain";
import { defaultScoreboardDate, mlbToday } from "@bt/domain";
import type { IngestDeps } from "./ingest.js";

/**
 * The calendars a day is judged against (S111, S128): the day's year's and the year before's,
 * the one whose final the off-season stays on. Two `fetchSeasonCalendar` calls; a calendar MLB
 * can't give is left out. Shared by the scoreboard's default day and the standings.
 */
export async function calendarsAround(mlb: IngestDeps["mlb"], day: string): Promise<SeasonCalendar[]>
{
	const year = Number(day.slice(0, 4));
	const seasons = await Promise.all([year - 1, year].map((season) => mlb.fetchSeasonCalendar(season)));
	return seasons.filter((season) => season !== null);
}

/**
 * The scoreboard's default day (S111): MLB's today from the ingest clock, judged against
 * last year's and this year's calendars. Last year's is the one whose final the off-season
 * stays on until this year's spring; next year's is never needed, since its spring starts
 * after this year's final. A calendar MLB can't give is left out, so with none the answer
 * is today.
 */
export async function getDefaultScoreboardDate(deps: IngestDeps): Promise<ScoreboardDefaultDateResponse>
{
	const today = mlbToday(deps.now?.() ?? new Date());
	return {
		date: defaultScoreboardDate(today, await calendarsAround(deps.mlb, today)),
	};
}
