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
