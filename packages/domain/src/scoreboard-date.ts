/**
 * Which day the scoreboard opens on (S111). During a season it is today; from the last
 * postseason game until the next season's first spring training game it stays on that
 * final, so the off-season opens on the World Series instead of an empty day (owner,
 * 2026-11-02: "Show the final day of the season by default, rather than \"today\" if today
 * is between the final day of the season and the next spring training first game"; the
 * final day is the "Last postseason game").
 *
 * Dates are `YYYY-MM-DD` calendar days, which compare correctly as strings.
 */

/** The zone MLB's day turns over in: a game's `officialDate` is its Eastern date. */
const MLB_TIME_ZONE = "America/New_York";

/** The days that bound one season, as BT needs them. */
export interface SeasonCalendar {
	season: number;
	/** The first spring training game's day (MLB's `springStartDate`). */
	springStartDate: string;
	/**
	 * The last postseason game's day: the World Series final once it has been played,
	 * MLB's scheduled postseason end before then.
	 */
	lastGameDate: string;
}

/**
 * MLB's today for an instant: the calendar date in `America/New_York`. 03:00 UTC on
 * 2026-09-06 is still 2026-09-05 for MLB, so a late West Coast game stays on its day.
 * The only place BT turns an instant into MLB's day; views call it, never their own zone.
 */
export function mlbToday(instant: Date): string
{
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: MLB_TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(instant);
	const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
	return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The scoreboard's default day for `today` given the seasons MLB has published (any order).
 * Inside a season (first spring game through the final) it is `today`. After a final it is
 * that final until the next season's spring starts; with no next season published yet it
 * stays on the final. Before every known season it is `today`.
 */
export function defaultScoreboardDate(today: string, seasons: readonly SeasonCalendar[]): string
{
	const ordered = [...seasons].sort((a, b) => a.springStartDate.localeCompare(b.springStartDate));
	let lastFinal: string | undefined;
	for (const season of ordered)
	{
		if (today < season.springStartDate) break;
		if (today <= season.lastGameDate) return today;
		lastFinal = season.lastGameDate;
	}
	return lastFinal ?? today;
}
