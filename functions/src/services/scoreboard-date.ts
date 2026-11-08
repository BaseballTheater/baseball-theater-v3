import type { ScoreboardDefaultDateResponse, SeasonCalendar } from "@bt/domain";
import { defaultScoreboardDate, mlbToday } from "@bt/domain";
import type { IngestDeps } from "./ingest.js";

/**
 * The calendars a day is judged against (S111): the day's year's and the year before's, the
 * one whose final the off-season stays on. Two `fetchSeasonCalendar` calls; a calendar MLB
 * hasn't published or can't give is left out — for the scoreboard's default day both mean the
 * same thing (fall back toward today). The standings tell them apart (`standingsCalendars`).
 */
export async function calendarsAround(mlb: IngestDeps["mlb"], day: string): Promise<SeasonCalendar[]>
{
	const year = Number(day.slice(0, 4));
	const seasons = await Promise.all([year - 1, year].map((season) => mlb.fetchSeasonCalendar(season).catch(() => null)));
	return seasons.filter((season) => season !== null);
}

/**
 * The calendars the standings judge a day against (S128): the same two as `calendarsAround`,
 * but an unreachable calendar is not an unpublished one. An unpublished calendar is left out,
 * so the off-season stays on the last published season's final table. An unreachable calendar
 * for the day's own year means the day can't be placed, so no calendar is passed at all and
 * `standingsPhase` gives the day's regular-season table (AC 7) — leaving only last year's in
 * would show last season's final table on a mid-season day. An unreachable calendar for the
 * year before is left out: without it a January day has no earlier season to stay on, so it is
 * the day's own table too, never another season's final.
 */
export async function standingsCalendars(mlb: IngestDeps["mlb"], day: string): Promise<SeasonCalendar[]>
{
	const year = Number(day.slice(0, 4));
	const [previous, current] = await Promise.allSettled([year - 1, year].map((season) => mlb.fetchSeasonCalendar(season)));
	if (current?.status !== "fulfilled") return [];
	return [previous, current].flatMap((result) => result?.status === "fulfilled" && result.value ? [result.value] : []);
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
