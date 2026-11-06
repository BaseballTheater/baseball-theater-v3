/**
 * The API under Node (`pnpm --filter @bt/functions start`, `pnpm lighthouse:serve`): the
 * same Fetch-standard handler the Worker runs, served through Node's http. It composes
 * through `createWorkerApp` (ADR-025: one composition), so its MLB client, repositories,
 * auth, settings and account data are the Worker's, built from the same `BT_*` variables
 * (fixtures by default, `BT_USE_LIVE_MLB=1` for live statsapi.mlb.com). Its Postgres is
 * PGlite in the process (S51), migrated and seeded from the fixtures at start, so it needs
 * no Docker: Lighthouse CI serves through it. `pnpm dev` is the Worker on compose.yaml's
 * Postgres.
 */
import { createServer } from "node:http";
import { DEFAULT_CADENCE } from "@bt/domain";
import {
	FIXTURES_ROOT, FixtureMlbStatsClient, nodeFixtureFiles,
} from "./adapters/fixtures/mlb.js";
import { toNodeListener } from "./adapters/node/http.js";
import { setNodeDatabase } from "./adapters/postgres/connect.js";
import { migratedPglite } from "./adapters/postgres/migrate.js";
import { handleApiRequest } from "./handlers/api.js";
import { tickIngest } from "./services/ingest.js";
import { seedFromFixtures } from "./services/seed.js";
import { createWorkerApp } from "./worker-app.js";

const PORT = Number(process.env.BT_API_PORT ?? 8787);
const DEFAULT_DATE = "2024-07-04";

async function main(): Promise<void>
{
	if (process.env.BT_USE_LIVE_MLB === "1") console.log("[bt-api] BT_USE_LIVE_MLB=1 — using live statsapi.mlb.com");
	// Without BT_SESSION_KEY the key is random per process, so issued sessions stop verifying after a restart.
	const { db } = await migratedPglite();
	setNodeDatabase(db);
	// Local dev, so `dev:` sign-in is wired (S114 AC 7), as under `pnpm dev`.
	const app = createWorkerApp({
		BT_LOCAL: "1",
		BT_USE_LIVE_MLB: process.env.BT_USE_LIVE_MLB,
		BT_SESSION_KEY: process.env.BT_SESSION_KEY,
		BT_APP_ORIGIN: process.env.BT_APP_ORIGIN,
	}, db);
	const days = await seedFromFixtures({
		...app.ingest,
		// The seed is the committed fixtures, whichever client serves requests.
		mlb: new FixtureMlbStatsClient(),
	}, nodeFixtureFiles(FIXTURES_ROOT));
	console.log(`[bt-api] Seeded PGlite from fixtures: ${days.join(", ")}`);

	const server = createServer(toNodeListener((request) => handleApiRequest(request, app.context)));

	// ADR-002 cadence loop. Off by default, so local work never spins an unattended poll.
	// Node has no Durable Objects, so it keeps the whole-day tick the Worker's per-game
	// ingest objects replaced (S48).
	if (process.env.BT_INGEST_TICK === "1")
	{
		console.log(
			`[bt-api] BT_INGEST_TICK=1 — ticking active-window ingest every ${DEFAULT_CADENCE.intervalMs}ms`,
		);
		setInterval(() =>
		{
			void tickIngest(app.ingest).then(
				(r) =>
				{
					if (r.ingested.length > 0)
					{
						console.log(`[bt-api] tick ingested ${r.ingested.join(", ")}`);
					}
				},
				(err: unknown) => console.error("[bt-api] tick failed", err),
			);
		}, DEFAULT_CADENCE.intervalMs);
	}

	server.listen(PORT, () =>
	{
		console.log(`[bt-api] Listening on http://localhost:${PORT}`);
		console.log(`[bt-api] GET /api/v1/schedule?date=${DEFAULT_DATE}`);
		console.log("[bt-api] GET /api/v1/games/744834");
		console.log("[bt-api] GET /api/v1/me  (Authorization: Bearer dev:<uid>)");
	});
}

void main();
