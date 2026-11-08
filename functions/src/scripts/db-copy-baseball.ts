/**
 * `pnpm db:copy-baseball` (S117): copies production's baseball data — the tables the data
 * classification manifest labels `none` — into another database, with no fan's data. Run by hand
 * only (owner, 2026-11-05: "it should be a manual step (to allow for local iteration not getting
 * stomped)"): no deploy, pull request or push runs it; the `Copy baseball data` workflow
 * (`.github/workflows/copy-baseball-data.yml`, `workflow_dispatch` only) is its one automation.
 *
 * Two ways to name the databases:
 * - `pnpm db:copy-baseball --neon staging`: both from Neon's API, as deploys find them
 *   (production's default branch to read, the existing `staging` branch to write; with no
 *   staging branch yet it refuses, saying to deploy staging first, and never creates one), with
 *   `NEON_API_KEY` and `NEON_PROJECT_ID` in the environment. What the workflow runs.
 * - `BT_SOURCE_DATABASE_URL=<production> BT_DATABASE_URL=<target> pnpm db:copy-baseball`: any
 *   two connection strings. A hosted target is written only when `NEON_API_KEY` and
 *   `NEON_PROJECT_ID` show it isn't production's branch; a local one always may be.
 *
 * Production is refused as a target by name (`production`, `bt-production`), by Neon branch and by
 * host (`checkCopyTarget`). The target is migrated first (`migratePostgres`); production is never
 * migrated, and every read of it runs in its own read-only transaction. Connection strings are
 * masked in GitHub's log and never printed; lines name hosts, tables and counts only. The body is
 * `runCopy` (`copy-baseball-run.ts`), tested end to end; this file only hands it the real world.
 */
import { openPostgres } from "../adapters/postgres/connect.js";
import { migratePostgres } from "../adapters/postgres/migrate.js";
import { runCopy } from "./copy-baseball-run.js";

process.exitCode = await runCopy(process.env, process.argv.slice(2), {
	open: openPostgres,
	migrate: migratePostgres,
	fetch: (input, init) => fetch(input, init),
	out: (line) => console.log(line),
	err: (line) => console.error(line),
});
