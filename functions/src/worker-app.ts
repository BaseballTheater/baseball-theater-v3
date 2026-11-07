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
import { LogtoIdentityAdmin, LogtoManagementApi } from "./adapters/logto/admin.js";
import { LogtoIdentityProvider } from "./adapters/logto/identity.js";
import { HttpMlbStatsClient } from "./adapters/http/mlb.js";
import type { MlbOverlaySource } from "./adapters/overlay-mlb.js";
import { overlayMlbClient, storeOverlay } from "./adapters/overlay-mlb.js";
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
import type { AuthDeps } from "./services/accounts.js";
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
	/**
	 * `"1"` marks local dev (`pnpm dev` and the Workers tests set it): the cron tick then runs only
	 * with `BT_INGEST_TICK=1`, and `dev:` sign-in is wired (S114 AC 7). No deployed env sets it.
	 */
	BT_LOCAL?: string;
	/**
	 * The Logto tenant's address and the single-page app's ID (S116): where both are set, the
	 * Worker offers Logto sign-in. Per-env `vars` in `wrangler.jsonc`; only production names them
	 * today (staging gets its own tenant's once it exists; previews never do).
	 */
	LOGTO_ENDPOINT?: string;
	LOGTO_APP_ID?: string;
	/** The tenant's own ID, for the Management API, which Logto Cloud serves only at `<id>.logto.app` (S116). */
	LOGTO_TENANT_ID?: string;
	/**
	 * Production's machine-to-machine app (Worker secrets, pushed from GitHub secrets on every
	 * production deploy, S116 AC 5): where the secret is set, account deletion also deletes the
	 * fan's Logto account. No other env has one.
	 */
	LOGTO_S2S_APP_ID?: string;
	LOGTO_S2S_SECRET?: string;
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

/**
 * Fixtures are the default so local dev and tests never touch the network; `BT_USE_LIVE_MLB=1`
 * opts in. On fixtures, what the store already holds (the committed fixtures and the dev seed,
 * S112) is answered from the store: a refresh-on-read of a seeded game stamps it unchanged
 * instead of asking MLB, and a seeded day isn't replaced by the fixtures' empty answer.
 */
export function createMlbClient(env: WorkerEnv, store?: MlbOverlaySource): MlbStatsClient
{
	if (env.BT_USE_LIVE_MLB === "1")
	{
		return new HttpMlbStatsClient();
	}
	const fixtures = createBundledFixtureClient();
	return store ? overlayMlbClient(fixtures, store) : fixtures;
}

/** What tests swap in the composition: the `fetch` the Logto adapters call (a stand-in tenant). */
export type WorkerAppOptions = {
	fetch?: (input: string, init?: RequestInit) => Promise<Response>;
};

/**
 * Wires the API for `env` on `db`. Exported for tests and the Node server; the Worker calls
 * `workerApp`, which builds it once on `scopedDatabase`. Nothing is seeded here: `pnpm db:seed`
 * fills the database, and a day or game that isn't stored is read through from MLB anyway.
 */
export function createWorkerApp(env: WorkerEnv, db: PostgresDb, options: WorkerAppOptions = {}): WorkerApp
{
	const schedules = new PostgresScheduleRepository(db);
	const games = new PostgresGameRepository(db);
	const ingest: IngestDeps = {
		mlb: createMlbClient(env, storeOverlay({
			schedules,
			games,
		})),
		schedules,
		games,
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
	const devAuth = createDevAuth(secrets, new PostgresUserRepository(db));
	const logto = logtoSignIn(env, options);
	const auth: AuthDeps = {
		...devSignInAllowed(env) ? devAuth : withoutDevSignIn(devAuth),
		...logto && {
			logto,
		},
	};
	const settings = new PostgresSettingsRepository(db);
	const devAccount = createDevAccountData({
		users: auth.users,
		settings,
	}, secrets, new PostgresDeletionLog(db));
	const admin = logtoAdmin(env, options);
	// Deletion reaches each provider through its admin; without Logto's (everywhere but production)
	// a deletion still removes every BT row and leaves the provider account alone (S116 AC 4).
	const account = {
		...devAccount,
		identityAdmins: admin ? [...devAccount.identityAdmins, admin] : devAccount.identityAdmins,
	};
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
 * Whether `Bearer dev:<uid>` signs in (S114 AC 7): only in local dev, where `pnpm dev` and the
 * Workers tests set `BT_LOCAL` to `"1"`. No deployed environment sets it (`wrangler.jsonc`), so
 * preview, staging and production refuse a `dev:` token; production signs in through Logto (S116).
 */
export function devSignInAllowed(env: WorkerEnv): boolean
{
	return env.BT_LOCAL === "1";
}

/** Logto sign-in where the env's vars name the tenant and the app (S116 AC 2); none elsewhere. */
export function logtoSignIn(env: WorkerEnv, options: WorkerAppOptions = {}): AuthDeps["logto"]
{
	if (!env.LOGTO_ENDPOINT || !env.LOGTO_APP_ID) return undefined;
	const config = {
		endpoint: env.LOGTO_ENDPOINT,
		appId: env.LOGTO_APP_ID,
	};
	return {
		provider: new LogtoIdentityProvider({
			...config,
			...options.fetch && {
				fetch: options.fetch,
			},
		}),
		config,
	};
}

/**
 * Logto's admin, only where production's machine-to-machine app is set: `LOGTO_S2S_SECRET` and
 * `LOGTO_S2S_APP_ID` (Worker secrets) and `LOGTO_TENANT_ID` (a var). Staging and previews have
 * none, so none is composed there (S116 AC 4).
 */
export function logtoAdmin(env: WorkerEnv, options: WorkerAppOptions = {}): LogtoIdentityAdmin | undefined
{
	if (!env.LOGTO_S2S_SECRET || !env.LOGTO_S2S_APP_ID || !env.LOGTO_TENANT_ID) return undefined;
	return new LogtoIdentityAdmin(new LogtoManagementApi({
		tenantId: env.LOGTO_TENANT_ID,
		appId: env.LOGTO_S2S_APP_ID,
		secret: env.LOGTO_S2S_SECRET,
		...options.fetch && {
			fetch: options.fetch,
		},
	}));
}

/** The same auth with the `dev:` provider left out, so a `dev:` token is just an unknown bearer. */
function withoutDevSignIn(auth: AuthDeps): AuthDeps
{
	const { dev: _dev, ...rest } = auth;
	return rest;
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
