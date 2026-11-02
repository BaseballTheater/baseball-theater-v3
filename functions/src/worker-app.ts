/**
 * The API's composition on the Workers runtime (S45; ADR-017): which MLB client, repos
 * and accounts the Worker serves with — the same wiring as `local-server.ts`, built
 * once per isolate. Local dev (`pnpm dev`, wrangler on workerd) and the Workers tests
 * use it; no Cloudflare account or binding is needed (in-memory repos, ADR-018's
 * Postgres arrives in S50). Recording replays is a Node-only tool (`src/scripts/`) and
 * has no place in the Worker.
 */
import type { MlbStatsClient } from "@bt/ports";
import {
	createDevAccountData, createDevAuth, StaticSecretsProvider,
} from "./adapters/fixtures/auth.js";
import { createBundledFixtureClient } from "./adapters/fixtures/bundled.js";
import { HttpMlbStatsClient } from "./adapters/http/mlb.js";
import {
	InMemoryGameProjectionRepository,
	InMemoryGameRepository,
	InMemoryScheduleRepository,
	InMemorySettingsRepository,
} from "./adapters/memory/repos.js";
import type { GameIngestNamespace } from "./game-ingest-object.js";
import type { ApiContext } from "./handlers/api.js";
import { APP_ORIGIN_SECRET } from "./services/data-downloads.js";
import { ingestScheduleDay } from "./services/ingest.js";
import { logApiUsage } from "./services/api-usage.js";
import type { IngestDeps } from "./services/ingest.js";
import { RefreshCoordinator } from "./services/refresh.js";
import { SESSION_KEY_SECRET } from "./services/session.js";

/** The Worker's environment: plain `BT_*` vars (wrangler `--var` / `.dev.vars`), no secrets committed. */
export type WorkerEnv = {
	/** `"1"` serves live statsapi.mlb.com; anything else, the bundled fixtures (the default). */
	BT_USE_LIVE_MLB?: string;
	/** The day seeded at start-up (default 2024-07-04, as `local-server.ts`). */
	BT_SEED_DATE?: string;
	/** Signs sessions; without it a random key per isolate (sessions end on restart, as locally today). */
	BT_SESSION_KEY?: string;
	/** Where download emails link (default: the Vite dev server). */
	BT_APP_ORIGIN?: string;
	/** `"1"` marks local dev (`pnpm dev` sets it): the cron tick then runs only with `BT_INGEST_TICK=1`. */
	BT_LOCAL?: string;
	/** `"1"` lets the cron tick ingest in local dev (ADR-002 cadence; off by default, as `local-server.ts`). */
	BT_INGEST_TICK?: string;
	/** The per-game ingest objects (S48; `wrangler.jsonc` `durable_objects`); absent under Node. */
	GAME_INGEST?: GameIngestNamespace;
	/** The per-game live hubs (S18; `wrangler.jsonc` `durable_objects`); absent under Node. */
	GAME_HUB?: GameIngestNamespace;
};

/** Everything a request or a cron tick needs: the handler's context plus the ingest loop's deps. */
export type WorkerApp = {
	context: ApiContext;
	ingest: IngestDeps;
	/** Resolves once the seed day is ingested; requests wait on it. */
	ready: Promise<void>;
};

/** Fixtures are the default so local dev and tests never touch the network; `BT_USE_LIVE_MLB=1` opts in. */
export function createMlbClient(env: WorkerEnv): MlbStatsClient
{
	if (env.BT_USE_LIVE_MLB === "1")
	{
		return new HttpMlbStatsClient();
	}
	return createBundledFixtureClient();
}

/** Wires the API for `env`. Exported for tests; the Worker calls `workerApp`, which builds it once. */
export function createWorkerApp(env: WorkerEnv): WorkerApp
{
	const ingest: IngestDeps = {
		mlb: createMlbClient(env),
		schedules: new InMemoryScheduleRepository(),
		games: new InMemoryGameRepository(),
		projections: new InMemoryGameProjectionRepository(),
		// One coordinator per isolate: stale out-of-window reads refresh single-flighted.
		refresh: new RefreshCoordinator(),
	};
	const secrets = new StaticSecretsProvider({
		[SESSION_KEY_SECRET]: env.BT_SESSION_KEY ?? crypto.randomUUID(),
		...env.BT_APP_ORIGIN && {
			[APP_ORIGIN_SECRET]: env.BT_APP_ORIGIN,
		},
	});
	const auth = createDevAuth(secrets);
	const settings = new InMemorySettingsRepository();
	const account = createDevAccountData({
		users: auth.users,
		settings,
	}, secrets);
	return {
		context: {
			ingest,
			auth,
			settings,
			account,
			// One log line per versioned request, for retiring versions on evidence (S28).
			usage: logApiUsage,
			...env.GAME_HUB && {
				live: liveForwarder(env.GAME_HUB),
			},
		},
		ingest,
		ready: ingestScheduleDay(ingest, env.BT_SEED_DATE ?? "2024-07-04").then(() => undefined),
	};
}

/**
 * Hands a live upgrade to `game-hub:<gamePk>` (S18) as `/connect`, keeping the viewer's
 * `since` so a viewer behind gets the full state first.
 */
export function liveForwarder(namespace: GameIngestNamespace): (gamePk: number, request: Request) => Promise<Response>
{
	return (gamePk, request) =>
	{
		const since = new URL(request.url).searchParams.get("since");
		const target = `https://game-hub/connect?gamePk=${gamePk}${since === null ? "" : `&since=${encodeURIComponent(since)}`}`;
		return namespace.get(namespace.idFromName(`game-hub:${gamePk}`) as never).fetch(target, {
			headers: request.headers,
		});
	};
}

let app: WorkerApp | undefined;

/**
 * The isolate's one app: in-memory state lives as long as the isolate, like the Node
 * server's process. Built on first use, from that first call's `env`.
 */
export function workerApp(env: WorkerEnv): WorkerApp
{
	app ??= createWorkerApp(env);
	return app;
}

/** Whether a cron tick may ingest: always deployed; in local dev only with `BT_INGEST_TICK=1`. */
export function tickAllowed(env: WorkerEnv): boolean
{
	return env.BT_LOCAL !== "1" || env.BT_INGEST_TICK === "1";
}
