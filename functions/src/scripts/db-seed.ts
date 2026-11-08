/**
 * `pnpm db:seed` (S51): migrates the local Postgres (compose.yaml) and ingests every committed
 * fixture day into it. It connects where the Worker's Hyperdrive binding does locally — the
 * `localConnectionString` in wrangler.jsonc — unless `BT_DATABASE_URL` says otherwise. Safe to
 * run on every `pnpm dev`: migrations already applied are skipped and seeding again changes
 * nothing. It refuses a non-local host, so it can't seed a hosted database by mistake. Then it
 * loads the dev seed file (S112) when there is one, or says which command makes it.
 */
import {
	FIXTURES_ROOT, FixtureMlbStatsClient, nodeFixtureFiles,
} from "../adapters/fixtures/mlb.js";
import { openPostgres } from "../adapters/postgres/connect.js";
import { isLocalDbHost, localConnectionString } from "../adapters/postgres/local.js";
import { migratePostgres } from "../adapters/postgres/migrate.js";
import {
	PostgresGameProjectionRepository, PostgresGameRepository, PostgresScheduleRepository,
} from "../adapters/postgres/repos.js";
import {
	DEFAULT_SEED_PATH, loadDevSeed, readDevSeed,
} from "../services/dev-seed.js";
import { seedFromFixtures } from "../services/seed.js";

const url = process.env.BT_DATABASE_URL ?? localConnectionString();
const host = new URL(url).hostname;
if (!isLocalDbHost(host))
{
	console.error(`[db:seed] refusing to seed ${host}: db:seed is for the local database only`);
	process.exit(2);
}

const { db, close } = await openPostgres(url);
try
{
	await migratePostgres(db);
	const deps = {
		mlb: new FixtureMlbStatsClient(),
		schedules: new PostgresScheduleRepository(db),
		games: new PostgresGameRepository(db),
		projections: new PostgresGameProjectionRepository(db),
	};
	const days = await seedFromFixtures(deps, nodeFixtureFiles(FIXTURES_ROOT));
	console.log(`[db:seed] ${host}: migrated; seeded ${days.join(", ")}`);

	const seedFile = process.env.BT_DEV_SEED ?? DEFAULT_SEED_PATH;
	const seed = await readDevSeed(seedFile);
	if (seed)
	{
		console.log(`[db:seed] loading the dev seed (${seed.start} through ${seed.end}, ${seed.games.length} games, recorded ${seed.recordedAt})…`);
		const loaded = await loadDevSeed(deps, seed);
		console.log(`[db:seed] dev seed loaded: ${loaded} days`);
	}
	else
	{
		console.log(`[db:seed] no dev seed at ${seedFile}; for the end of last season and the postseason, run: pnpm seed:refresh`);
	}
}
finally
{
	await close();
}
