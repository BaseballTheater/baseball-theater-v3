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
 * One stretch of days a source was counted over with nothing unknown between them, `newest` to
 * `oldest` (both counted days). `streak` is the run of failed days at the `oldest` end, which a
 * stretch just below carries on; `newestStreak` the run at the `newest` end, which a stretch just
 * above adds to; `allFailed` says every counted day failed (both runs are then its whole length).
 * `givenUp` is set once any {@link GIVE_UP_AFTER_DAYS} failed days in a row lie in it, and a
 * given-up stretch is skipped from its `oldest` back: every day above that is already counted,
 * so that skips just the days the walk would have skipped after the 14th failure in a row.
 */
export type SourceStretch = {
	newest: string;
	oldest: string;
	streak: number;
	newestStreak: number;
	allFailed: boolean;
	givenUp: boolean;
};

/**
 * One extra source's give-up state, kept with the resume state: every stretch it was counted
 * over, newest first, none overlapping. A run over dates that don't touch an earlier run's counts
 * a stretch of its own, so a streak never carries across days nobody walked (the review of
 * PR #20: a newer range was never counted once anything had been, and an older range continued
 * an unrelated streak).
 */
export type SourceStreak = {
	stretches: SourceStretch[];
};

/** Whether the walk visits any day strictly between `from` and `to` (`from` the earlier): it never visits the off-season. */
function walkedDayBetween(from: string, to: string): boolean
{
	for (let day = addDays(from, 1); day < to; day = addDays(day, 1))
	{
		if (!isOffSeasonDay(day)) return true;
	}
	return false;
}

/**
 * `upper` and `lower` as one stretch, `upper` directly above with nothing unknown between. The
 * failures at `upper`'s oldest end run on into those at `lower`'s newest end, so the joined
 * stretch is given up when those two together reach {@link GIVE_UP_AFTER_DAYS}; the oldest-end
 * run reaches past `lower` only when all of `lower` failed, and the newest-end run past `upper`
 * only when all of `upper` did.
 */
function joinStretches(upper: SourceStretch, lower: SourceStretch): SourceStretch
{
	return {
		newest: upper.newest,
		oldest: lower.oldest,
		streak: lower.allFailed ? lower.streak + upper.streak : lower.streak,
		newestStreak: upper.allFailed ? upper.newestStreak + lower.newestStreak : upper.newestStreak,
		allFailed: upper.allFailed && lower.allFailed,
		givenUp: upper.givenUp || lower.givenUp || upper.streak + lower.newestStreak >= GIVE_UP_AFTER_DAYS,
	};
}

/**
 * Counts one day of games for a source (S122 AC 7): a failed day adds to the streak, a day
 * with any success resets it, and the {@link GIVE_UP_AFTER_DAYS}th failed day in a row gives
 * the source up. `walkFrom` is the run's `to`, the day its walk (newest to oldest) started at.
 *
 * - A day the source is given up for, or inside a counted stretch (a resumed run walking a day
 *   again), changes nothing, so no day is counted twice.
 * - The day joins each stretch above it that the walk reached it from: no day it would visit
 *   lies between them, other than days this run walked without counting (`walkFrom` at or
 *   above the stretch, or a resume from just below a stop, or across the off-season). So a run
 *   carries a streak down through an older stretch, and folds in what it counted above that.
 * - The day joins the stretch directly below it (no day the walk would visit between), unless
 *   the day's own stretch is already given up (it keeps its own, newer give-up): so catch-up
 *   runs, each ending the day above the last one's newest day, count failures in a row across
 *   them, whatever the older days below them hold.
 * - Anything else starts a stretch of its own, counting from zero.
 *
 * Days with no games aren't recorded, so a stretch never joins across one this run didn't walk
 * (an All-Star break between two runs, say): the count starts again there. That can only ask a
 * source a few more days; it never gives one up before 14 failed days of games in a row, except
 * after resuming from a file saved before stretches were kept: in one narrow case, and when the
 * old code had already counted a streak or give-up across ranges that didn't touch, which is
 * taken as it was (see `readOldStreak` in `functions/src/services/backfill-state.ts`).
 */
export function recordSourceDay(state: SourceStreak, day: string, failed: boolean, walkFrom: string): SourceStreak
{
	if (isSourceGivenUp(state, day)) return state;
	if (state.stretches.some((stretch) => stretch.oldest <= day && day <= stretch.newest)) return state;
	let rest = state.stretches;
	let top: SourceStretch = {
		newest: day,
		oldest: day,
		streak: failed ? 1 : 0,
		newestStreak: failed ? 1 : 0,
		allFailed: failed,
		givenUp: false,
	};
	for (;;)
	{
		const newest = top.newest;
		const above = rest.filter((stretch) => stretch.oldest > newest).reduce<SourceStretch | undefined>((nearest, stretch) =>
			nearest === undefined || stretch.oldest < nearest.oldest ? stretch : nearest, undefined);
		if (above === undefined || walkedDayBetween(walkFrom > newest ? walkFrom : newest, above.oldest)) break;
		top = joinStretches(above, top);
		rest = rest.filter((stretch) => stretch !== above);
	}
	const below = rest.filter((stretch) => stretch.newest < day).reduce<SourceStretch | undefined>((nearest, stretch) =>
		nearest === undefined || stretch.newest > nearest.newest ? stretch : nearest, undefined);
	if (below !== undefined && !top.givenUp && !walkedDayBetween(below.newest, day))
	{
		top = joinStretches(top, below);
		rest = rest.filter((stretch) => stretch !== below);
	}
	return {
		stretches: [...rest, top].sort((a, b) => (a.oldest < b.oldest ? 1 : -1)),
	};
}

/**
 * The newest day a source was given up at, if it was: it is skipped on that day and every
 * older one, whichever run gave it up. The command reports it as "from <day> back".
 */
export function sourceGivenUpAt(state: SourceStreak | undefined): string | undefined
{
	let newest: string | undefined;
	for (const stretch of state?.stretches ?? [])
	{
		if (stretch.givenUp && (newest === undefined || stretch.oldest > newest)) newest = stretch.oldest;
	}
	return newest;
}

/** Whether a source given up is skipped on `day`: every day at or before the newest day it was given up at (AC 7). */
export function isSourceGivenUp(state: SourceStreak | undefined, day: string): boolean
{
	const givenUpAt = sourceGivenUpAt(state);
	return givenUpAt !== undefined && day <= givenUpAt;
}
