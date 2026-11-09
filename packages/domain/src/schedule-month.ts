/**
 * Games per day for a month (S124), the counts S125's calendar date picker shows. Counted from
 * the stored schedule days' game summaries, which list every game on the day (scheduled,
 * postponed, final, in or out of the live window), never from the games table, which holds only
 * the games ingest hydrated.
 */

/** One stored schedule day as the month view needs it: its game count and its ADR-021/022 stamps. */
export interface ScheduleDayTally
{
	/** The day, `YYYY-MM-DD`. */
	date: string;
	/** How many games the stored schedule day lists. */
	gameCount: number;
	/** When the day was last fetched (`ScheduleDay.fetchedAt`). */
	fetchedAt: string;
	/** When the day's content last changed (`ScheduleDay.lastChangedAt`, ADR-022). */
	lastChangedAt: string;
}

/** A day of the month view: its date and its number of games. */
export interface ScheduleDayCount
{
	/** The day, `YYYY-MM-DD`. */
	date: string;
	/**
	 * How many games the day has; `0` for a stored day with none. `null` when BT holds no
	 * schedule for the day (a past day nothing has stored, or one MLB couldn't be asked for),
	 * so a client can tell "no games" from "not known".
	 */
	count: number | null;
}

/**
 * One count per date of `dates`, in order, from the stored days' tallies (ADR-025: the one
 * implementation of a day's game count for the month view): a date with no stored day is `null`.
 */
export function monthGameCounts(dates: readonly string[], stored: readonly Pick<ScheduleDayTally, "date" | "gameCount">[]): ScheduleDayCount[]
{
	const byDate = new Map(stored.map((day) => [day.date, day.gameCount]));
	return dates.map((date) => ({
		date,
		count: byDate.get(date) ?? null,
	}));
}

/**
 * When a month's stored data last changed (ADR-021's input for its cache lifetime): the latest
 * `lastChangedAt` among its stored days, or undefined when it holds none. A day a backfill fills
 * or MLB corrects moves it, so a past month that changes drops back to the ladder's floor.
 */
export function monthLastChangedAt(stored: readonly Pick<ScheduleDayTally, "lastChangedAt">[]): string | undefined
{
	let latest: string | undefined;
	for (const day of stored)
	{
		if (latest === undefined || Date.parse(day.lastChangedAt) > Date.parse(latest)) latest = day.lastChangedAt;
	}
	return latest;
}
