/**
 * The rules of the game backfill (S122): which days it walks, which games are settled, and
 * when it stops asking a source that has stopped answering. Pure, so the command, its tests
 * and any later production run share one decision for each (ADR-025).
 */
import { addDays, yearsBefore } from "./calendar-date.js";
import type { GameSnapshot, ScheduleDay } from "./types.js";
import { isFinalStatus, normalizeStatusCode } from "./window.js";

/** The first day the backfill ever asks for: the 1901 American League's opening day (owner, 2026-11-07). */
export const BACKFILL_EARLIEST_DATE = "1901-04-18";

/** A source is given up after this many consecutive failed days of games (owner, 2026-11-07: "14 days should be plenty"). */
export const GIVE_UP_AFTER_DAYS = 14;

/**
 * Whether `date` (`YYYY-MM-DD`) falls in the off-season the backfill never asks about:
 * November 15 through February 15, both included (owner, 2026-11-07: "It should always skip
 * days between Nov 15 and Feb 15"). The World Series has never reached November 15, and spring
 * training has never started before February 15, so nothing a fan would look for is skipped.
 */
export function isOffSeasonDay(date: string): boolean
{
	const monthDay = date.slice(5);
	return monthDay >= "11-15" || monthDay <= "02-15";
}

/**
 * Every day the backfill visits, newest first (so recent games land first and the give-up
 * rule sees a source's newest days before its oldest): `to` back to `from`, both included,
 * with `from` clamped to {@link BACKFILL_EARLIEST_DATE} and off-season days left out. Empty
 * when `from` is after `to`.
 */
export function backfillDays(from: string, to: string): string[]
{
	const start = from < BACKFILL_EARLIEST_DATE ? BACKFILL_EARLIEST_DATE : from;
	const days: string[] = [];
	for (let day = to; day >= start; day = addDays(day, -1))
	{
		if (!isOffSeasonDay(day)) days.push(day);
	}
	return days;
}

/** The default range: one year before `today` through `today` (owner, 2026-11-07). */
export function defaultBackfillRange(today: string, from?: string, to?: string): { from: string;
	to: string; }
{
	const end = to ?? today;
	return {
		// One year back by the calendar; 02-29 steps to 02-28 in a year without one.
		from: from ?? yearsBefore(end, 1),
		to: end,
	};
}

/**
 * Whether a game is settled — final (final, game over, completed early), postponed or
 * cancelled — so its day needn't be asked about again. Anything else (scheduled, live,
 * delayed, suspended) can still change, so a day holding one is checked on the next run.
 */
export function isSettledGame(status: Pick<GameSnapshot["status"], "codedGameState" | "detailedState">): boolean
{
	if (isFinalStatus(normalizeStatusCode(status.codedGameState))) return true;
	return /^(postponed|cancell?ed)\b/i.test(status.detailedState);
}

/**
 * Whether a stored schedule day needs no more asking (S122 AC 4): every game in it is settled
 * ({@link isSettledGame}) and, when it lists no games at all, the day is before MLB's `today`
 * (`mlbToday` of the run's clock). So an empty day is asked about again only while it is MLB's
 * today (or still ahead); any run on a later day accepts a stored empty day without asking,
 * whenever that empty answer was fetched. The run's clock decides rather than the stored
 * `fetchedAt` because `storeSchedule` keeps the old row, and its old `fetchedAt`, when a
 * re-fetch is unchanged (ADR-022): judging by `fetchedAt` would re-fetch such a day forever.
 */
export function isScheduleDaySettled(day: Pick<ScheduleDay, "date" | "games">, today: string): boolean
{
	if (!day.games.every((game) => isSettledGame(game.status))) return false;
	return day.games.length > 0 || day.date < today;
}

/**
 * One extra source's give-up state, kept with the resume state: its current run of failed
 * days, the last (oldest) day counted toward it, and the day it was given up at, if it was.
 */
export type SourceStreak = {
	streak: number;
	lastCountedDay?: string;
	givenUpAt?: string;
};

/**
 * Counts one day of games for a source (S122 AC 7): a failed day adds to the streak, a day
 * with any success resets it, and the {@link GIVE_UP_AFTER_DAYS}th failed day in a row gives
 * the source up at that day. The walk goes newest to oldest, so only a day older than the last
 * counted one is counted: a resumed run that revisits a newer, unfinished day (today's, say)
 * can't count it twice. A given-up source stays given up.
 */
export function recordSourceDay(state: SourceStreak, day: string, failed: boolean): SourceStreak
{
	if (state.givenUpAt !== undefined) return state;
	if (state.lastCountedDay !== undefined && day >= state.lastCountedDay) return state;
	const streak = failed ? state.streak + 1 : 0;
	return {
		streak,
		lastCountedDay: day,
		...streak >= GIVE_UP_AFTER_DAYS && {
			givenUpAt: day,
		},
	};
}

/** Whether a source given up is skipped on `day`: every day at or before the day it was given up at. */
export function isSourceGivenUp(state: SourceStreak | undefined, day: string): boolean
{
	return state?.givenUpAt !== undefined && day <= state.givenUpAt;
}
