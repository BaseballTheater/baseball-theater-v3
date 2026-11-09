/**
 * `pnpm seed:refresh [--start=YYYY-MM-DD --end=YYYY-MM-DD] [--out=<file>]` (S112): records the
 * dev seed from live MLB through `HttpMlbStatsClient` — every day in the range and each of its
 * games, hydrated — into one gzipped file (`.dev-seed/seed.json.gz` by default, git-ignored).
 * With no dates it takes the most recent finished season's last month of the regular season
 * through its last postseason game. Like `record-fixtures`, it is a network-touching command
 * that CI and `pnpm verify` never run. The next `pnpm dev` loads the file.
 */
import { isCalendarDate, mlbToday } from "@bt/domain";
import { HttpMlbStatsClient } from "../adapters/http/mlb.js";
import {
	DEFAULT_SEED_PATH, defaultSeedRange, recordDevSeed, writeDevSeed,
} from "../services/dev-seed.js";

function arg(name: string): string | undefined
{
	return process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

// Each date must be a real one (`isCalendarDate`), not only the shape: `seedDays` walks from
// `start`, and a start like 2026-02-30 would step to 03-03 and skip the days between.
const start = arg("start");
const end = arg("end");
if ((start === undefined) !== (end === undefined) || [start, end].some((d) => d !== undefined && !isCalendarDate(d)) || (start && end && start > end))
{
	console.error("usage: pnpm seed:refresh [--start=YYYY-MM-DD --end=YYYY-MM-DD] [--out=<file>]  (both dates or neither, real calendar dates, start ≤ end)");
	process.exit(2);
}

const mlb = new HttpMlbStatsClient();
const range = start && end ? {
	start,
	end,
} : await defaultSeedRange(mlb, mlbToday(new Date()));
const out = arg("out") ?? DEFAULT_SEED_PATH;
console.log(`[seed:refresh] recording ${range.start} through ${range.end}`);
const { seed, skipped } = await recordDevSeed(mlb, range, {
	log: (line) => console.log(`[seed:refresh] ${line}`),
});
await writeDevSeed(out, seed);
if (skipped.length > 0) console.log(`[seed:refresh] MLB served no feed for ${skipped.length} game(s), left out: ${skipped.join(", ")}`);
console.log(`[seed:refresh] wrote ${out}: ${seed.days.length} days, ${seed.games.length} games. The next pnpm dev loads it.`);
