/**
 * `pnpm db:copy-baseball` (S117): copies production's baseball data — the tables the data
 * classification manifest labels `none` — into another database, with no fan's data. Run by hand
 * only (owner, 2026-11-05: "it should be a manual step (to allow for local iteration not getting
 * stomped)"): no deploy, pull request or push runs it; the `Copy baseball data` workflow
 * (`.github/workflows/copy-baseball-data.yml`, `workflow_dispatch` only) is its one automation.
 *
 * Two ways to name the databases:
 * - `pnpm db:copy-baseball --neon staging`: both from Neon's API, as deploys find them
 *   (production's default branch to read, the `staging` branch to write), with `NEON_API_KEY`
 *   and `NEON_PROJECT_ID` in the environment. What the workflow runs.
 * - `BT_SOURCE_DATABASE_URL=<production> BT_DATABASE_URL=<target> pnpm db:copy-baseball`: any
 *   two connection strings. A hosted target is written only when `NEON_API_KEY` and
 *   `NEON_PROJECT_ID` show it isn't production's branch; a local one always may be.
 *
 * Production is refused as a target by name (`production`, `bt-production`), by Neon branch and by
 * host (`checkCopyTarget`). The target is migrated first (`migratePostgres`); production is never
 * migrated, and is read over a read-only session. Connection strings are masked in GitHub's log
 * and never printed; lines name hosts, tables and counts only.
 */
import { parse } from "pg-connection-string";
import { openPostgres } from "../adapters/postgres/connect.js";
import { databaseTarget } from "../adapters/postgres/local.js";
import { migratePostgres } from "../adapters/postgres/migrate.js";
import type { NeonApi } from "../deploy/bootstrap.js";
import { copyBaseballData } from "../services/baseball-copy.js";
import { checkCopyTarget, neonCopyDatabases } from "../services/baseball-copy-target.js";

const say = (line: string) => console.log(`[db:copy-baseball] ${line}`);
function fail(message: string): never
{
	console.error(`[db:copy-baseball] ${message}`);
	process.exit(2);
}

/** Hides a connection string and its password from GitHub's log before anything could print them. */
function mask(connectionString: string): void
{
	if (process.env.GITHUB_ACTIONS !== "true") return;
	console.log(`::add-mask::${connectionString}`);
	const { password } = parse(connectionString);
	if (password) console.log(`::add-mask::${password}`);
}

const args = process.argv.slice(2);
const neonFlag = args.indexOf("--neon");
const neonKey = process.env.NEON_API_KEY;
const neonProject = process.env.NEON_PROJECT_ID;
const neon: NeonApi | undefined = neonKey && neonProject
	? {
		apiKey: neonKey,
		projectId: neonProject,
		fetch: (input: string, init?: RequestInit) => fetch(input, init),
	}
	: undefined;

let source: string;
let target: string;
if (neonFlag >= 0)
{
	const name = args[neonFlag + 1];
	if (!name) fail("usage: db:copy-baseball --neon staging");
	if (!neon) fail("--neon needs NEON_API_KEY and NEON_PROJECT_ID");
	try
	{
		({ source, target } = await neonCopyDatabases(neon, name));
	}
	catch (error)
	{
		fail(`refusing: ${error instanceof Error ? error.message : String(error)}`);
	}
}
else
{
	if (args.length > 0) fail("usage: db:copy-baseball [--neon staging] (or set BT_SOURCE_DATABASE_URL and BT_DATABASE_URL)");
	const fromEnv = process.env.BT_SOURCE_DATABASE_URL;
	const toEnv = process.env.BT_DATABASE_URL;
	if (!fromEnv || !toEnv) fail("set BT_SOURCE_DATABASE_URL (production, read only) and BT_DATABASE_URL (the target), or pass --neon staging");
	source = fromEnv;
	target = toEnv;
}
mask(source);
mask(target);

const check = await checkCopyTarget(source, target, {
	...neon && {
		neon,
	},
});
const from = databaseTarget(source);
const to = `${check.target.host}/${check.target.name}`;
if (!check.allowed) fail(`refusing ${to}: ${check.why}`);

const reader = await openPostgres(source);
const writer = await openPostgres(target);
try
{
	say(`copying baseball tables from ${from.host}/${from.name} to ${to}, migrating ${to} first`);
	await copyBaseballData({
		source: reader.db,
		target: writer.db,
		migrateTarget: async () =>
		{
			say(`migrating ${to} (allowed: ${check.why})`);
			await migratePostgres(writer.db);
		},
		log: say,
	});
	say("done: nothing in the target was deleted, and no personal table or deletion log was read or written");
}
finally
{
	await reader.close();
	await writer.close();
}
