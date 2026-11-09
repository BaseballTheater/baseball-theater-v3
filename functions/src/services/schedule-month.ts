/**
 * Games per day for a month (S124), for S125's calendar date picker: one read of BT's stored
 * schedule days (ADR-002: clients read BT only), counted by `monthGameCounts`.
 *
 * Days of the current season or the future that BT doesn't hold yet are filled from MLB with
 * one schedule request for their range, stored through ingest's version-guarded write
 * (`storeSchedule`, ADR-022) without hydrating any game: game snapshots stay with the
 * scoreboard's own refresh and the backfill (S122), so one month read is one MLB request, not
 * hundreds. Past seasons are never asked for here; what the backfill stored is what they show.
 *
 * Stored days of the current season or the future are asked for again once the month's ADR-021
 * lifetime has run out (`needsRefresh`, the ladder single days use), so a future month stored
 * empty before MLB published its schedule gains its games later.
 */
import type { ScheduleDayCount, ScheduleDayTally } from "@bt/domain";
import {
	daysOfMonth, mlbToday, monthGameCounts, monthLastChangedAt, scheduleWindowMode,
} from "@bt/domain";
import type { IngestDeps } from "./ingest.js";
import {
	needsRefresh, runRefresh, storeSchedule,
} from "./ingest.js";

/** A month's counts and when its data last changed, which sets its cache lifetime (ADR-021). */
export interface ScheduleMonth
{
	/** The month, `YYYY-MM`. */
	month: string;
	/** Every day of the month, first to last. */
	days: ScheduleDayCount[];
	/**
	 * When the month's stored data last changed: the latest change among its days, or `now`
	 * while any day is unknown (`count: null`), so an incomplete month is checked again soon.
	 */
	lastChangedAt: string;
}

/**
 * The span of `fillable` days to ask MLB for, or null when none needs asking: all of them when
 * the month's stored data has outlived its lifetime, else from the first to the last day BT
 * doesn't hold. One range either way, so a month is never more than one request.
 */
function rangeToAsk(deps: IngestDeps, key: string, fillable: string[], stored: ScheduleDayTally[], now: Date): [string, string] | null
{
	if (fillable.length === 0) return null;
	const held = stored.filter((day) => day.date >= fillable[0]!);
	const missing = fillable.filter((date) => !held.some((day) => day.date === date));
	// The month's last check is its oldest fetch; its last change, its newest (ADR-021's ladder over the month).
	const month = held.length === 0 ? null : {
		fetchedAt: held.reduce((oldest, day) => Date.parse(day.fetchedAt) < Date.parse(oldest) ? day.fetchedAt : oldest, held[0]!.fetchedAt),
		lastChangedAt: monthLastChangedAt(held),
		windowMode: "cache" as const,
	};
	if (month && needsRefresh(deps, key, month, now, false)) return [fillable[0]!, fillable.at(-1)!];
	return missing.length === 0 ? null : [missing[0]!, missing.at(-1)!];
}

/**
 * The number of games on each day of `month` (`YYYY-MM`, already checked by `isCalendarMonth`),
 * from BT's stored schedule days, filling or refreshing the current season's and the future's
 * days first as the module doc says. A failed MLB request leaves those days as they were.
 */
export async function getScheduleMonth(deps: IngestDeps, month: string): Promise<ScheduleMonth>
{
	const now = deps.now?.() ?? new Date();
	const dates = daysOfMonth(month);
	const first = dates[0]!;
	const last = dates.at(-1)!;
	let stored = await deps.schedules.listGameCounts(first, last);

	// The current season is MLB's calendar year: its days, and every later one, can still change.
	const seasonStart = `${mlbToday(now).slice(0, 4)}-01-01`;
	const key = `schedule-month:${month}`;
	const range = rangeToAsk(deps, key, dates.filter((date) => date >= seasonStart), stored, now);
	if (range)
	{
		const filled = await runRefresh(deps, key, async () =>
		{
			try
			{
				const fetchedAt = now.toISOString();
				for (const day of await deps.mlb.fetchScheduleRange(range[0], range[1]))
				{
					await storeSchedule(deps, {
						...day,
						fetchedAt,
						windowMode: scheduleWindowMode(day.games, now),
					});
				}
				return true;
			}
			catch
			{
				// MLB unreachable: the days stay as stored, and unknown ones say so (`count: null`).
				return false;
			}
		});
		if (filled) stored = await deps.schedules.listGameCounts(first, last);
	}

	const days = monthGameCounts(dates, stored);
	const complete = days.every((day) => day.count !== null);
	return {
		month,
		days,
		lastChangedAt: (complete ? monthLastChangedAt(stored) : undefined) ?? now.toISOString(),
	};
}
