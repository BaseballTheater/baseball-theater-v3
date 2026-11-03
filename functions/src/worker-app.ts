/**
 * The API's composition on the Workers runtime (S45; ADR-017): which MLB client, repos
 * and accounts the Worker serves with — the same wiring as `local-server.ts`, built
 * once per isolate. Every repository is Postgres (ADR-018; S51): the Worker's are built
 * on `scopedDatabase`, the connection of the request (or cron tick, or Durable Object call)
 * in progress, which `inDatabaseScope` opens through the `HYPERDRIVE` binding — compose.yaml's
 * Postgres in local dev, Neon deployed. Node callers (tests, `local-server.ts`) hand
 * `createWorkerApp` a database directly. Downloads and the mailer stay in-process until their
 * R2 and Email adapters (the launch checklist). Recording replays is a Node-only tool
 * (`src/scripts/`) and has no place in the Worker.
 */
import type { MlbStatsClient } from "@bt/ports";
import {
	createDevAccountData, createDevAuth, StaticSecretsProvider,
} from "./adapters/fixtures/auth.js";
import { createBundledFixtureClient } from "./adapters/fixtures/bundled.js";
import { HttpMlbStatsClient } from "./adapters/http/mlb.js";
import { scopedDatabase } from "./adapters/postgres/connect.js";
import type { HyperdriveBinding } from "./adapters/postgres/connect.js";
import type { PostgresDb } from "./adapters/postgres/repos.js";
import {
	PostgresDeletionLog,
	PostgresGameProjectionRepository,
	PostgresGameRepository,
	PostgresScheduleRepository,
	PostgresSettingsRepository,
	PostgresUserRepository,
} from "./adapters/postgres/repos.js";
import type { GameIngestNamespace } from "./game-ingest-object.js";
import type { ApiContext } from "./handlers/api.js";
import { APP_ORIGIN_SECRET } from "./services/data-downloads.js";
import { logApiUsage } from "./services/api-usage.js";
import type { IngestDeps } from "./services/ingest.js";
import { RefreshCoordinator } from "./services/refresh.js";
import { SESSION_KEY_SECRET } from "./services/session.js";

/** The Worker's environment: plain `BT_*` vars (wrangler `--var` / `.dev.vars`), no secrets committed. */
export type WorkerEnv = {
	/** `"1"` serves live statsapi.mlb.com; anything else, the bundled fixtures (the default). */
	BT_USE_LIVE_MLB?: string;
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
	/** Postgres through Hyperdrive (S51; `wrangler.jsonc` `hyperdrive`); absent under Node. */
	HYPERDRIVE?: HyperdriveBinding;
};

/** Everything a request or a cron tick needs: the handler's context plus the ingest loop's deps. */
export type WorkerApp = {
	context: ApiContext;
	ingest: IngestDeps;
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

/**
 * Wires the API for `env` on `db`. Exported for tests and the Node server; the Worker calls
 * `workerApp`, which builds it once on `scopedDatabase`. Nothing is seeded here: `pnpm db:seed`
 * fills the database, and a day or game that isn't stored is read through from MLB anyway.
 */
export function createWorkerApp(env: WorkerEnv, db: PostgresDb): WorkerApp
{
	const ingest: IngestDeps = {
		mlb: createMlbClient(env),
		schedules: new PostgresScheduleRepository(db),
		games: new PostgresGameRepository(db),
		projections: new PostgresGameProjectionRepository(db),
		// One coordinator per isolate: stale out-of-window reads refresh single-flighted.
		refresh: new RefreshCoordinator(),
	};
	const secrets = new StaticSecretsProvider({
		[SESSION_KEY_SECRET]: env.BT_SESSION_KEY ?? crypto.randomUUID(),
		...env.BT_APP_ORIGIN && {
			[APP_ORIGIN_SECRET]: env.BT_APP_ORIGIN,
		},
	});
	const auth = createDevAuth(secrets, new PostgresUserRepository(db));
	const settings = new PostgresSettingsRepository(db);
	const account = createDevAccountData({
		users: auth.users,
		settings,
	}, secrets, new PostgresDeletionLog(db));
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
 * The isolate's one app, on `scopedDatabase`: what lives as long as the isolate (the refresh
 * single-flight, the session key, the fixture client's caches) is shared, while each unit
 * of work brings its own connection (`inDatabaseScope`). Built on first use, from that first
 * call's `env`.
 */
export function workerApp(env: WorkerEnv): WorkerApp
{
	app ??= createWorkerApp(env, scopedDatabase);
	return app;
}

/** Whether a cron tick may ingest: always deployed; in local dev only with `BT_INGEST_TICK=1`. */
export function tickAllowed(env: WorkerEnv): boolean
{
	return env.BT_LOCAL !== "1" || env.BT_INGEST_TICK === "1";
}
