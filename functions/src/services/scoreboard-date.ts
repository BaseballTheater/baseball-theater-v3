import type { ScoreboardDefaultDateResponse } from "@bt/domain";
import { defaultScoreboardDate, mlbToday } from "@bt/domain";
import type { IngestDeps } from "./ingest.js";

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
	const year = Number(today.slice(0, 4));
	const seasons = await Promise.all([year - 1, year].map((season) => deps.mlb.fetchSeasonCalendar(season)));
	return {
		date: defaultScoreboardDate(today, seasons.filter((season) => season !== null)),
	};
}
