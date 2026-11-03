/**
 * MLB's season calendar (`GET /api/v1/seasons/{season}?sportId=1`; S111): the dates that
 * bound one season — spring training, the regular season, the postseason, the off-season.
 * Dates are `YYYY-MM-DD` calendar days. `postSeasonEndDate` is the scheduled end of the
 * postseason window, which MLB corrects to the real final only some time after it (2026's
 * still read 10-31 days after a 10-28 final), so BT takes the final from the World Series
 * schedule when one has been played.
 *
 * A season MLB has not published yet comes back as `{ seasons: [] }`.
 */

/** One season's calendar. Every date is optional because MLB omits what it hasn't set. */
export interface MlbSeason {
	seasonId: string;
	hasWildcard?: boolean;
	preSeasonStartDate?: string;
	preSeasonEndDate?: string;
	seasonStartDate?: string;
	springStartDate?: string;
	springEndDate?: string;
	regularSeasonStartDate?: string;
	lastDate1stHalf?: string;
	allStarDate?: string;
	firstDate2ndHalf?: string;
	regularSeasonEndDate?: string;
	postSeasonStartDate?: string;
	postSeasonEndDate?: string;
	seasonEndDate?: string;
	offseasonStartDate?: string;
	offSeasonEndDate?: string;
	/** Gameday data levels MLB serves for the season and its games (`"P"`). */
	seasonLevelGamedayType?: string;
	gameLevelGamedayType?: string;
	/** Qualifying thresholds for rate stats: plate appearances and outs per team game. */
	qualifierPlateAppearances?: number;
	qualifierOutsPitched?: number;
}

/** `GET /api/v1/seasons/{season}?sportId=1` */
export interface SeasonsResponse {
	copyright?: string;
	seasons: MlbSeason[];
}
