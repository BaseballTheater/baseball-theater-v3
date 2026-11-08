/**
 * Pure upstream → BT mapper for one season's calendar (S111): the first spring game's day
 * from MLB's season calendar, and the last postseason game's day from that season's World
 * Series schedule. MLB's `postSeasonEndDate` is the scheduled end of the window and is
 * corrected to the real final only later (2026 read 10-31 after a 10-28 final), so the
 * World Series' last game wins once one is listed; before the Series is scheduled the
 * calendar's date stands in. An unpublished season (`seasons: []`) maps to null. The regular
 * season's first and last days (S128) are carried when MLB lists them; standings need both.
 */
import type { SeasonCalendar } from "@bt/domain";
import type { ScheduleResponse, SeasonsResponse } from "@bt/mlb-api";

/** The last day the World Series lists a game that is still on (not cancelled), if any. */
function worldSeriesFinal(worldSeries: ScheduleResponse): string | undefined
{
	const days = worldSeries.dates
		.filter((day) => day.games.some((game) => game.status.detailedState !== "Cancelled"))
		.map((day) => day.date)
		.sort();
	return days.at(-1);
}

export function mapSeasonCalendar(seasons: SeasonsResponse, worldSeries: ScheduleResponse): SeasonCalendar | null
{
	const season = seasons.seasons[0];
	const lastGameDate = worldSeriesFinal(worldSeries) ?? season?.postSeasonEndDate ?? season?.seasonEndDate;
	if (!season?.springStartDate || !lastGameDate) return null;
	return {
		season: Number(season.seasonId),
		springStartDate: season.springStartDate,
		lastGameDate,
		...(season.regularSeasonStartDate ? {
			regularSeasonStartDate: season.regularSeasonStartDate,
		} : {}),
		...(season.regularSeasonEndDate ? {
			regularSeasonEndDate: season.regularSeasonEndDate,
		} : {}),
	};
}
