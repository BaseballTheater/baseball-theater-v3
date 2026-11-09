/**
 * Calendar dates as BT's URLs carry them, `YYYY-MM-DD` (the scoreboard's
 * `/games/:date`). A calendar date is not an instant: stepping one is done in UTC,
 * so no time zone or daylight-saving change can skip or repeat a day.
 */

/** `2026-09-05` + 1 → `2026-09-06`; crosses months and years (`2026-12-31` + 1 → `2027-01-01`). */
export function addDays(date: string, days: number): string
{
	const [year, month, day] = date.split("-").map(Number);
	const stepped = new Date(Date.UTC(year!, month! - 1, day! + days));
	return stepped.toISOString().slice(0, 10);
}

/**
 * Whether `text` is a real calendar date in `YYYY-MM-DD` form (S122): the shape, and a day the
 * calendar has, so `2026-02-30` or `2026-13-01` is not one. Month and day are checked by hand
 * (Gregorian leap years) rather than through `Date.UTC`, which reads years 0–99 as 1900–1999,
 * so a well-formed early date like `0001-01-01` is real and a caller can clamp it.
 */
export function isCalendarDate(text: string): boolean
{
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (!match) return false;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
	return days !== undefined && day >= 1 && day <= days;
}

/**
 * The same month and day `years` years before `date` (S122): the backfill's default range
 * (one year) and the pacer's line for old games (ten years) both count years this way
 * (ADR-025: one implementation). February 29 steps to February 28 in a year without one,
 * so the result is never later than the true anniversary.
 */
export function yearsBefore(date: string, years: number): string
{
	const stepped = `${String(Number(date.slice(0, 4)) - years).padStart(4, "0")}${date.slice(4)}`;
	return isCalendarDate(stepped) ? stepped : addDays(`${stepped.slice(0, 4)}-03-01`, -1);
}

/** Every date from `from` to `to`, both included, in order (S124); empty when `to` is before `from`. */
export function datesBetween(from: string, to: string): string[]
{
	const dates: string[] = [];
	for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
	return dates;
}

/**
 * The earliest month BT serves a calendar for (S124): the month of the first MLB game BT keeps,
 * `BACKFILL_EARLIEST_DATE` (1901-04-18, `backfill.ts`, which imports this module, so the month
 * is written out here rather than derived; `calendar-date.test.ts` holds the two together).
 */
export const EARLIEST_CALENDAR_MONTH = "1901-04";

/**
 * Whether `text` is a month BT can answer for, `YYYY-MM` (S124's `/api/v1/schedule/month/:month`):
 * the shape, a month the calendar has (`01`–`12`, so `2026-13`, `2026-00` and `1901-4` are not
 * ones), and no earlier than {@link EARLIEST_CALENDAR_MONTH}. The one check of a month parameter,
 * beside {@link isCalendarDate}, so no handler keeps a pattern of its own.
 */
export function isCalendarMonth(text: string): boolean
{
	const match = /^(\d{4})-(\d{2})$/.exec(text);
	if (!match) return false;
	const month = Number(match[2]);
	return month >= 1 && month <= 12 && text >= EARLIEST_CALENDAR_MONTH;
}

/** Every date of a `YYYY-MM` month, first to last (S124): `2028-02` has 29, `2026-02` 28. */
export function daysOfMonth(month: string): string[]
{
	const first = `${month}-01`;
	const nextMonth = addDays(`${month}-28`, 4).slice(0, 7);
	return datesBetween(first, addDays(`${nextMonth}-01`, -1));
}
