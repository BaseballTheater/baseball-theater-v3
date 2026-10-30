/**
 * How the app writes a moment the server sends (ISO 8601), in the reader's own
 * time zone. Formatting only — every date BT shows is computed server-side or in
 * `packages/domain` (ADR-025); nothing here adds or compares times. Shared by
 * every screen that shows a date (S79 first; the game top bar and the scoreboard's
 * date control since S66, which merged the game top bar's own formatter into it).
 */

const DATE = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
});

/** A calendar date names a day, not a moment: it is written in UTC so no zone moves it. */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

const CALENDAR = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
	timeZone: "UTC",
});

const TIME = new Intl.DateTimeFormat("en-US", {
	hour: "numeric",
	minute: "2-digit",
});

/**
 * "Nov 11, 2026" (standings-search-settings A4; the game top bar and the scoreboard's
 * date control). An instant is written in the reader's zone; a calendar date
 * (`2026-09-05`, a game's `officialDate` or the scoreboard URL's day) is written as
 * that same day wherever the reader is. Anything that is not a date comes back as it is.
 */
export function formatDate(value: string): string
{
	const calendar = CALENDAR_DATE.test(value);
	const date = new Date(calendar ? `${value}T00:00:00Z` : value);
	if (Number.isNaN(date.getTime()) || (calendar && date.toISOString().slice(0, 10) !== value)) return value;
	return (calendar ? CALENDAR : DATE).format(date);
}

/** "3:15 PM" (A4's download refusal). */
export function formatTime(iso: string): string
{
	return TIME.format(new Date(iso));
}

/**
 * The reader's own IANA time zone (`America/New_York`), for formatters that take one,
 * like a game's start time (`formatGameTime`; owner, 2026-10-19: start times in the
 * viewer's zone, labeled).
 */
export function viewerTimeZone(): string
{
	return TIME.resolvedOptions().timeZone;
}
