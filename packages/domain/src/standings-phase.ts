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
 * The table to show instead when `pick` comes back empty (S128 AC 3) — the morning of the first
 * spring day or of opening day, before any game is final: spring falls back to the previous
 * season's final table, the regular season to its spring's table as of the last spring day.
 * Null when there is nothing before it (a final table, or no calendar to say what came before).
 */
export function previousStandingsPhase(pick: StandingsPick, seasons: readonly SeasonCalendar[]): StandingsPick | null
{
	const known = knownSeasons(seasons);
	if (pick.phase === "spring")
	{
		const previous = known.filter((s) => s.season < pick.season).at(-1);
		return previous ? finalOf(previous) : null;
	}
	if (pick.phase === "regularSeason")
	{
		const season = known.find((s) => s.season === pick.season);
		if (!season || pick.date < season.regularSeasonStartDate) return null;
		const lastSpringDay = addDays(season.regularSeasonStartDate, -1);
		return {
			phase: "spring",
			season: season.season,
			date: pick.date < lastSpringDay ? pick.date : lastSpringDay,
		};
	}
	return null;
}
