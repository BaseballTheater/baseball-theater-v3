/**
 * `pnpm db:seed` (S51): migrates the local Postgres (compose.yaml) and ingests every committed
 * fixture day into it. It connects where the Worker's Hyperdrive binding does locally — the
 * `localConnectionString` in wrangler.jsonc — unless `BT_DATABASE_URL` says otherwise. Safe to
 * run on every `pnpm dev`: migrations already applied are skipped and seeding again changes
 * nothing. It refuses a non-local host, so it can't seed a hosted database by mistake.
 */
import { readFileSync } from "node:fs";
import {
	FIXTURES_ROOT, FixtureMlbStatsClient, nodeFixtureFiles,
} from "../adapters/fixtures/mlb.js";
import { openPostgres } from "../adapters/postgres/connect.js";
import { migratePostgres } from "../adapters/postgres/migrate.js";
import {
	PostgresGameProjectionRepository, PostgresGameRepository, PostgresScheduleRepository,
} from "../adapters/postgres/repos.js";
import { seedFromFixtures } from "../services/seed.js";

/** wrangler.jsonc's local Hyperdrive connection string (comments stripped; the file is JSONC). */
function localConnectionString(): string
{
	const text = readFileSync(new URL("../../../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
	const config = JSON.parse(text) as { hyperdrive?: { binding: string;
		localConnectionString?: string; }[]; };
	const local = config.hyperdrive?.find((h) => h.binding === "HYPERDRIVE")?.localConnectionString;
	if (!local) throw new Error("wrangler.jsonc has no HYPERDRIVE localConnectionString");
	return local;
}

const url = process.env.BT_DATABASE_URL ?? localConnectionString();
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host))
{
	console.error(`[db:seed] refusing to seed ${host}: db:seed is for the local database only`);
	process.exit(2);
}

const { db, close } = await openPostgres(url);
try
{
	await migratePostgres(db);
	const days = await seedFromFixtures({
		mlb: new FixtureMlbStatsClient(),
		schedules: new PostgresScheduleRepository(db),
		games: new PostgresGameRepository(db),
		projections: new PostgresGameProjectionRepository(db),
	}, nodeFixtureFiles(FIXTURES_ROOT));
	console.log(`[db:seed] ${host}: migrated; seeded ${days.join(", ")}`);
}
finally
{
	await close();
}
