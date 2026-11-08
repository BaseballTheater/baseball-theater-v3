/**
 * `pnpm mlb:backfill [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--gap-ms N] [--old-gap-ms N]
 * [--allow-production]` (S122): hydrates every game between the two dates into the database
 * `BT_DATABASE_URL` names, else the local Docker Postgres (`localConnectionString`, as
 * `pnpm db:seed`), migrating it first. It asks live MLB through `HttpMlbStatsClient` paced by
 * `PoliteFetch` (2 requests in flight per host, a gap between starts, backoff on 429/5xx), so
 * like `seed:refresh` it is a network-touching command that CI and `pnpm verify` never run.
 * Ctrl-C stops it after the day in progress; run it again to resume. At the end it prints how
 * much room the game tables take.
 */
import { mlbToday } from "@bt/domain";
import { HttpMlbStatsClient } from "../adapters/http/mlb.js";
import { openPostgres } from "../adapters/postgres/connect.js";
import { localConnectionString } from "../adapters/postgres/local.js";
import { migratePostgres } from "../adapters/postgres/migrate.js";
import {
	PostgresGameProjectionRepository, PostgresGameRepository, PostgresScheduleRepository,
} from "../adapters/postgres/repos.js";
import { runBackfill } from "../services/backfill.js";
import { formatSizeReport, gameTableSizes } from "../services/backfill-report.js";
import { DEFAULT_STATE_DIR, fileResumeStore } from "../services/backfill-state.js";
import { checkBackfillTarget } from "../services/backfill-target.js";
import { PoliteFetch } from "../services/polite-fetch.js";
import { parseBackfillArgs } from "./backfill-args.js";

const say = (line: string) => console.log(`[mlb:backfill] ${line}`);
const today = mlbToday(new Date());

let args;
try
{
	args = parseBackfillArgs(process.argv.slice(2), today);
}
catch (error)
{
	console.error(`[mlb:backfill] ${error instanceof Error ? error.message : String(error)}`);
	process.exit(2);
}

const url = process.env.BT_DATABASE_URL ?? localConnectionString();
const neonKey = process.env.NEON_API_KEY;
const neonProject = process.env.NEON_PROJECT_ID;
const check = await checkBackfillTarget(url, {
	allowProduction: args.allowProduction,
	...neonKey && neonProject && {
		neon: {
			apiKey: neonKey,
			projectId: neonProject,
			fetch: (input: string, init?: RequestInit) => fetch(input, init),
		},
	},
});
const where = `${check.target.host}/${check.target.name}`;
if (!check.allowed)
{
	console.error(`[mlb:backfill] refusing ${where}: ${check.why}`);
	process.exit(2);
}

const polite = new PoliteFetch({
	today,
	recentGapMs: args.recentGapMs,
	oldGapMs: args.oldGapMs,
	log: (line) => say(line),
});
const controller = new AbortController();
process.on("SIGINT", () =>
{
	if (controller.signal.aborted) process.exit(130);
	say("stopping after the day in progress (Ctrl-C again to quit now; run again to resume)");
	controller.abort();
});

const { db, close } = await openPostgres(url);
try
{
	await migratePostgres(db);
	say(`${where} (${check.why}): ${args.from} back from ${args.to}, newest first; gaps ${args.recentGapMs} ms, ${args.oldGapMs} ms for games over 10 years old`);
	const result = await runBackfill({
		mlb: new HttpMlbStatsClient({
			fetchImpl: polite.fetch,
		}),
		schedules: new PostgresScheduleRepository(db),
		games: new PostgresGameRepository(db),
		projections: new PostgresGameProjectionRepository(db),
		state: fileResumeStore(DEFAULT_STATE_DIR, check.target),
		pace: (day) => polite.setDay(day),
		log: say,
		signal: controller.signal,
	}, args);
	say(`${result.stopped ? "stopped" : "done"}: ${result.days} days visited, ${result.alreadyComplete} already complete, ${result.gamesStored} games stored, ${result.repaired} repaired`);
	if (result.incomplete.length > 0) say(`${result.incomplete.length} days left incomplete, checked again next run: ${result.incomplete.slice(0, 10).join(", ")}${result.incomplete.length > 10 ? ", …" : ""}`);
	for (const [source, day] of Object.entries(result.givenUp)) say(`given up: ${source} (from ${day} back)`);
	for (const line of formatSizeReport(await gameTableSizes(db))) say(line);
}
finally
{
	await close();
}
