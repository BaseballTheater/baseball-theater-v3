/**
 * `pnpm mlb:backfill`'s arguments (S122), parsed apart from the command so they can be tested
 * without running it: `--from` and `--to` (`YYYY-MM-DD`, `--to` defaulting to MLB's today and
 * `--from` to a year before it; both must be real calendar dates, and `--to` no later than MLB's
 * today, since a later day has no final games to store), `--gap-ms` / `--old-gap-ms` overriding the pacer's gaps, and
 * `--allow-production`. Both `--flag value` and `--flag=value` are read.
 */
import {
	BACKFILL_EARLIEST_DATE, defaultBackfillRange, isCalendarDate,
} from "@bt/domain";
import { OLD_GAP_MS, RECENT_GAP_MS } from "../services/polite-fetch.js";

/** What the command runs with: the range (already clamped to 1901-04-18), the pacer's gaps, and the production override. */
export type BackfillArgs = {
	from: string;
	to: string;
	recentGapMs: number;
	oldGapMs: number;
	allowProduction: boolean;
};

/** Printed with every argument error, so a mistyped command shows what it takes. */
export const BACKFILL_USAGE = "usage: pnpm mlb:backfill [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--gap-ms N] [--old-gap-ms N] [--allow-production]";

const VALUE_FLAGS = new Set(["--from", "--to", "--gap-ms", "--old-gap-ms"]);

/** Parses `argv` (without node and the script); throws with {@link BACKFILL_USAGE} on anything it can't read. */
export function parseBackfillArgs(argv: string[], today: string): BackfillArgs
{
	const values = new Map<string, string>();
	let allowProduction = false;
	for (let i = 0; i < argv.length; i++)
	{
		const arg = argv[i]!;
		if (arg === "--allow-production")
		{
			allowProduction = true;
			continue;
		}
		const [flag = "", inline] = arg.split(/=(.*)/s, 2);
		if (!VALUE_FLAGS.has(flag)) throw new Error(`unknown argument ${arg}\n${BACKFILL_USAGE}`);
		const value = inline ?? argv[++i];
		if (value === undefined) throw new Error(`${flag} needs a value\n${BACKFILL_USAGE}`);
		values.set(flag, value);
	}
	for (const flag of ["--from", "--to"])
	{
		const value = values.get(flag);
		// A real day, not just its shape: `2026-02-30` would otherwise walk on into March.
		if (value !== undefined && !isCalendarDate(value)) throw new Error(`${flag} must be a real date, YYYY-MM-DD\n${BACKFILL_USAGE}`);
	}
	const to = values.get("--to");
	if (to !== undefined && to > today) throw new Error(`--to ${to} is after MLB's today, ${today}\n${BACKFILL_USAGE}`);
	// Before the range is worked out: a year before such a --to is outside what the calendar helpers handle, and nothing that early is ever asked for.
	if (to !== undefined && to < BACKFILL_EARLIEST_DATE) throw new Error(`--to ${to} is before ${BACKFILL_EARLIEST_DATE}, the first day the backfill asks for\n${BACKFILL_USAGE}`);
	const gap = (flag: string, fallback: number) =>
	{
		const value = values.get(flag);
		if (value === undefined) return fallback;
		const ms = Number(value);
		if (!Number.isInteger(ms) || ms < 0) throw new Error(`${flag} must be a whole number of milliseconds\n${BACKFILL_USAGE}`);
		return ms;
	};
	const range = defaultBackfillRange(today, values.get("--from"), values.get("--to"));
	if (range.from > range.to) throw new Error(`--from ${range.from} is after --to ${range.to}\n${BACKFILL_USAGE}`);
	return {
		from: range.from < BACKFILL_EARLIEST_DATE ? BACKFILL_EARLIEST_DATE : range.from,
		to: range.to,
		recentGapMs: gap("--gap-ms", RECENT_GAP_MS),
		oldGapMs: gap("--old-gap-ms", OLD_GAP_MS),
		allowProduction,
	};
}
