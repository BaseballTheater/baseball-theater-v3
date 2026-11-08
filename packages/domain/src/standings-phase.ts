/**
 * Which standings the Standings page shows on a day (S128). MLB answers a dated standings
 * request only inside the regular season, so the table follows the season instead (owner,
 * 2026-11-07: "it should always show the last standings for the prior season until spring
 * training's first game", and spring training's own table from then until the regular season):
 *
 * - **regularSeason** — from MLB's `regularSeasonStartDate` (the first regular-season game,
 *   owner: "first regular season game") through `regularSeasonEndDate`: that day's table.
 * - **final** — from the day after `regularSeasonEndDate` (postseason included) until the day
 *   before the next season's `springStartDate`, or for as long as that next season is not
 *   published: the season's final regular-season table, dated its `regularSeasonEndDate`.
 * - **spring** — from `springStartDate` through the day before `regularSeasonStartDate`: that
 *   spring's training table as of the day.
 *
 * "Not published" means MLB answered with no such season; a calendar MLB couldn't be reached
 * for is not passed as unpublished — the caller passes none instead (S128 AC 7), since leaving
 * only last year's would keep its final table on a mid-season day.
 *
 * Before every known season, or with no calendar, it is the day's regular-season table. A
 * calendar missing either regular-season date is unknown here. Dates are `YYYY-MM-DD`, which
 * compare as strings. MLB's season id is the year a date falls in, so a January day's final
 * table is the previous season's, which only the calendars can say.
 */
import { addDays } from "./calendar-date.js";
import type { SeasonCalendar } from "./scoreboard-date.js";
import type { StandingsPhaseName } from "./types.js";

/** The table to ask MLB for: which kind, for which season, and the day it stands as of. */
export interface StandingsPick {
	phase: StandingsPhaseName;
	season: number;
	/** The day the table stands as of: the requested day, or `regularSeasonEndDate` for `final`. */
	date: string;
}

type KnownCalendar = SeasonCalendar & { regularSeasonStartDate: string;
	regularSeasonEndDate: string; };

/** The calendars that carry both regular-season dates, earliest spring first. */
function knownSeasons(seasons: readonly SeasonCalendar[]): KnownCalendar[]
{
	return seasons
		.filter((s): s is KnownCalendar => Boolean(s.regularSeasonStartDate && s.regularSeasonEndDate))
		.sort((a, b) => a.springStartDate.localeCompare(b.springStartDate));
}

function finalOf(season: KnownCalendar): StandingsPick
{
	return {
		phase: "final",
		season: season.season,
		date: season.regularSeasonEndDate,
	};
}

/** The standings to show on `day`, given the season calendars MLB has published (any order). */
export function standingsPhase(day: string, seasons: readonly SeasonCalendar[]): StandingsPick
{
	let pick: StandingsPick = {
		phase: "regularSeason",
		season: Number(day.slice(0, 4)),
		date: day,
	};
	for (const season of knownSeasons(seasons))
	{
		if (day < season.springStartDate) break;
		if (day < season.regularSeasonStartDate)
		{
			return {
				phase: "spring",
				season: season.season,
				date: day,
			};
		}
		if (day <= season.regularSeasonEndDate)
		{
			return {
				phase: "regularSeason",
				season: season.season,
				date: day,
			};
		}
		pick = finalOf(season);
	}
	return pick;
}

/**
 * The table to show instead when `pick` comes back empty (S128 AC 3). That happens on two
 * mornings only, before any game of the new phase is final: spring's first day
 * (`springStartDate`), which falls back to the previous season's final table, and opening day
 * (`regularSeasonStartDate`), which falls back to that spring's table as of the last spring day.
 * Any other day's table is the day's own answer, empty or not, so it is null there: a later
 * empty table is shown as it is, never replaced by an older phase's under a stale label. Also
 * null when there is nothing before it (a final table, the first known spring, no calendar).
 */
export function previousStandingsPhase(pick: StandingsPick, seasons: readonly SeasonCalendar[]): StandingsPick | null
{
	const known = knownSeasons(seasons);
	const season = known.find((s) => s.season === pick.season);
	if (!season) return null;
	if (pick.phase === "spring")
	{
		if (pick.date !== season.springStartDate) return null;
		const previous = known.filter((s) => s.season < pick.season).at(-1);
		return previous ? finalOf(previous) : null;
	}
	if (pick.phase === "regularSeason")
	{
		if (pick.date !== season.regularSeasonStartDate) return null;
		return {
			phase: "spring",
			season: season.season,
			date: addDays(season.regularSeasonStartDate, -1),
		};
	}
	return null;
}
