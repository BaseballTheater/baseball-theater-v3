/**
 * Games per day for a month (S124), for S125's calendar date picker, from BT's stored schedule
 * days (ADR-002: clients read BT only), counted by `monthGameCounts`. A month BT needn't ask MLB
 * about is one count read; a fill adds one MLB range request, a version-guarded write per day it
 * returns (`storeSchedule`, which reads the stored day first) and a second count read.
 *
 * Days inside `scheduleFillWindow` (the current season through December of next year; later
 * months are refused at the route, owner 2026-11-09: "Reject past next year") that BT doesn't
 * hold yet are filled from MLB with one schedule request for their range, stored through
 * ingest's version-guarded write (ADR-022) without hydrating any game: game snapshots stay with
 * the scoreboard's own refresh and the backfill (S122), so one month read is one MLB request,
 * not hundreds. Past seasons are never asked for here; what the backfill stored is what they show.
 *
 * Stored days inside the window are asked for again once the month's ADR-021 lifetime has run
 * out (`needsRefresh`, the ladder single days use), so a future month stored empty before MLB
 * published its schedule gains its games later.
 */
import type {
	ScheduleDay, ScheduleDayCount, ScheduleDayTally, Unversioned,
} from "@bt/domain";
import {
	daysOfMonth, mlbToday, monthGameCounts, monthLastChangedAt, scheduleFillWindow, scheduleWindowMode,
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
	const wanted = new Set(fillable);
	const held = stored.filter((day) => wanted.has(day.date));
	const heldDates = new Set(held.map((day) => day.date));
	const missing = fillable.filter((date) => !heldDates.has(date));
	// The month was last checked no later than its oldest fetch: every held day has been fetched
	// since then, but nothing says the oldest one was fetched again after (an unchanged refresh
	// writes nothing, ADR-022), so this is the safe lower bound; a stamp that doesn't parse means
	// "never checked". Its last change is the newest among its days (ADR-021's ladder over the month).
	const fetchedTimes = held.map((day) => Date.parse(day.fetchedAt));
	const oldestFetch = fetchedTimes.some(Number.isNaN) ? undefined : Math.min(...fetchedTimes);
	const month = held.length === 0 ? null : {
		fetchedAt: oldestFetch === undefined ? undefined : new Date(oldestFetch).toISOString(),
		lastChangedAt: monthLastChangedAt(held),
		windowMode: "cache" as const,
	};
	if (month && needsRefresh(deps, key, month, now, false)) return [fillable[0]!, fillable.at(-1)!];
	return missing.length === 0 ? null : [missing[0]!, missing.at(-1)!];
}

/**
 * The number of games on each day of `month` (`YYYY-MM`, already checked by `isCalendarMonth`
 * and `latestScheduleMonth` at the route), from BT's stored schedule days, filling or refreshing
 * the days inside `scheduleFillWindow` first as the module doc says. A failed MLB request leaves
 * those days as they were; a failed store write is BT's own failure and rejects.
 */
export async function getScheduleMonth(deps: IngestDeps, month: string): Promise<ScheduleMonth>
{
	const now = deps.now?.() ?? new Date();
	const dates = daysOfMonth(month);
	const first = dates[0]!;
	const last = dates.at(-1)!;
	let stored = await deps.schedules.listGameCounts(first, last);

	// MLB's today, not UTC's: 03:00 UTC on January 1 is still December 31 for MLB.
	const window = scheduleFillWindow(mlbToday(now));
	const key = `schedule-month:${month}`;
	const range = rangeToAsk(deps, key, dates.filter((date) => date >= window.first && date <= window.last), stored, now);
	if (range)
	{
		const filled = await runRefresh(deps, key, async () =>
		{
			const fetchedAt = now.toISOString();
			let days: Unversioned<ScheduleDay>[];
			try
			{
				days = await deps.mlb.fetchScheduleRange(range[0], range[1]);
			}
			catch
			{
				// MLB unreachable, or an answer that doesn't parse: the days stay as stored, and
				// unknown ones say so (`count: null`). Not a check of the month, so it is asked
				// again once the cooldown allows rather than after a lifetime it never earned.
				return false;
			}
			// A store write that fails is BT's (the database), not MLB's: it rejects, and the read fails.
			for (const day of days)
			{
				await storeSchedule(deps, {
					...day,
					fetchedAt,
					windowMode: scheduleWindowMode(day.games, now),
				});
			}
			return true;
		}, (ok) => ok);
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
