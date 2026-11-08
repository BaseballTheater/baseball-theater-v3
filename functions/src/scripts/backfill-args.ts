/**
 * `pnpm mlb:backfill`'s arguments (S122), parsed apart from the command so they can be tested
 * without running it: `--from` and `--to` (`YYYY-MM-DD`, `--to` defaulting to MLB's today and
 * `--from` to a year before it), `--gap-ms` / `--old-gap-ms` overriding the pacer's gaps, and
 * `--allow-production`. Both `--flag value` and `--flag=value` are read.
 */
import { BACKFILL_EARLIEST_DATE, defaultBackfillRange } from "@bt/domain";
import { OLD_GAP_MS, RECENT_GAP_MS } from "../services/polite-fetch.js";

export type BackfillArgs = {
	from: string;
	to: string;
	recentGapMs: number;
	oldGapMs: number;
	allowProduction: boolean;
};

export const BACKFILL_USAGE = "usage: pnpm mlb:backfill [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--gap-ms N] [--old-gap-ms N] [--allow-production]";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
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
		if (value !== undefined && !DATE.test(value)) throw new Error(`${flag} must be YYYY-MM-DD\n${BACKFILL_USAGE}`);
	}
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
