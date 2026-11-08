/**
 * The deploy's bootstrapping (S114; owner, 2026-11-05: "It should be idempotent so it can happen
 * with every deployment. All the bootstrapping should be like that."). Before every preview,
 * staging or production deploy, `pnpm deploy:bootstrap <env>` (`src/scripts/deploy-bootstrap.ts`)
 * finds, or creates when missing, what that env's Worker runs on: its Neon branch, its connection
 * string, its Hyperdrive config by name, the Worker config with that config's id, and the Worker
 * secrets from GitHub. Each step reads what exists first and creates only what is missing, so the
 * same deploy run again changes nothing and fails nothing. The workflow then runs `pnpm db:migrate`
 * and `pnpm db:reapply-deletions` on the branch and deploys.
 *
 * The APIs are reached through an injected `fetch` (tests pass stand-ins; nothing here ever runs
 * against a hosted service outside GitHub Actions). Staging never holds a fan's data: its branch
 * is created schema-only from production, never as a plain branch (S114 AC 9), and nothing here
 * copies rows (production's baseball data is S117's manual copy).
 */
import { sql } from "drizzle-orm";
import type { PostgresDb } from "../adapters/postgres/repos.js";

/** A deployed environment, as `wrangler.jsonc` names it under `env`. */
export type DeployEnv = "preview" | "staging" | "production";

export const DEPLOY_ENVS: readonly DeployEnv[] = ["preview", "staging", "production"];

/**
 * Each env's Hyperdrive config, by its constant name. Previews share staging's database (owner,
 * 2026-11-05: "Previews share staging db"), so they share its config.
 */
export const HYPERDRIVE_CONFIG: Record<DeployEnv, string> = {
	preview: "bt-staging",
	staging: "bt-staging",
	production: "bt-production",
};

/** The long-lived Neon branch previews and staging run on; production is the project's default branch. */
export const STAGING_BRANCH = "staging";

/**
 * Every env's Worker secrets, pushed from GitHub secrets on every deploy (S114 AC 8), so GitHub is
 * their one source and none is set once by hand.
 */
export const WORKER_SECRETS = ["BT_SESSION_KEY"] as const;

/**
 * Production's alone (S116 AC 5): its one Logto machine-to-machine app, which deletes fans' Logto
 * accounts (the Worker, `worker-app.ts`) and registers production's sign-in addresses (the
 * deploy, `src/deploy/logto.ts`). Only the `production` job maps them, from the GitHub secrets of
 * the same names (owner, 2026-11-07: "LOGTO_S2S_APP_ID and LOGTO_S2S_SECRET, go ahead"); staging
 * and previews have no machine-to-machine app.
 */
export const PRODUCTION_WORKER_SECRETS = ["LOGTO_S2S_APP_ID", "LOGTO_S2S_SECRET"] as const;

/** The Worker secrets `env`'s deploy pushes. */
export function workerSecretNames(env: DeployEnv): readonly string[]
{
	return env === "production" ? [...WORKER_SECRETS, ...PRODUCTION_WORKER_SECRETS] : WORKER_SECRETS;
}

/** A preview's Worker, one per pull request, on workers.dev. */
export function previewWorkerName(pullRequest: number): string
{
	return `baseball-theater-pr-${pullRequest}`;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The Cloudflare account the Workers and Hyperdrive configs live in. */
export type CloudflareApi = {
	accountId: string;
	token: string;
	fetch: Fetch;
};

/** The Neon project production and staging branch from. `sleep` paces the wait for a new branch. */
export type NeonApi = {
	projectId: string;
	apiKey: string;
	fetch: Fetch;
	sleep?: (ms: number) => Promise<void>;
};

async function cloudflare<T>(api: CloudflareApi, path: string, init: RequestInit = {}): Promise<T>
{
	const response = await api.fetch(`https://api.cloudflare.com/client/v4/accounts/${api.accountId}${path}`, {
		...init,
		headers: {
			"Authorization": `Bearer ${api.token}`,
			"Content-Type": "application/json",
		},
	});
	const body = await response.json() as { success?: boolean;
		result?: T;
		errors?: unknown; };
	if (!response.ok || !body.success) throw new Error(`Cloudflare ${init.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body.errors ?? body)}`);
	return body.result as T;
}

async function neon<T>(api: NeonApi, path: string, init: RequestInit = {}): Promise<T>
{
	const response = await api.fetch(`https://console.neon.tech/api/v2/projects/${api.projectId}${path}`, {
		...init,
		headers: {
			"Authorization": `Bearer ${api.apiKey}`,
			"Accept": "application/json",
			"Content-Type": "application/json",
		},
	});
	if (!response.ok) throw new Error(`Neon ${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`);
	return await response.json() as T;
}

/** What a step found: the thing, and whether this run had to create it. */
export type Found<T> = { value: T;
	created: boolean; };

/**
 * The id of the Hyperdrive config named `name`, created on `connectionString` only when no config
 * has that name. An existing config is left as it is: it already points at its branch, whose
 * connection string doesn't change between deploys.
 */
export async function findOrCreateHyperdrive(api: CloudflareApi, name: string, connectionString: string): Promise<Found<string>>
{
	const configs = await cloudflare<{ id: string;
		name: string; }[]>(api, "/hyperdrive/configs");
	const existing = configs.find((config) => config.name === name);
	if (existing) return {
		value: existing.id,
		created: false,
	};
	const url = new URL(connectionString);
	const created = await cloudflare<{ id: string }>(api, "/hyperdrive/configs", {
		method: "POST",
		body: JSON.stringify({
			name,
			origin: {
				scheme: "postgres",
				host: url.hostname,
				port: Number(url.port || 5432),
				database: decodeURIComponent(url.pathname.slice(1)),
				user: decodeURIComponent(url.username),
				password: decodeURIComponent(url.password),
			},
		}),
	});
	return {
		value: created.id,
		created: true,
	};
}

/** The account's workers.dev subdomain, where previews are served. */
export async function workersDevSubdomain(api: CloudflareApi): Promise<string>
{
	return (await cloudflare<{ subdomain: string }>(api, "/workers/subdomain")).subdomain;
}

/** A Neon branch, as its API lists it. `init_source` says how a branch began. */
export type NeonBranch = {
	id: string;
	name: string;
	default?: boolean;
	init_source?: string;
	current_state?: string;
};

/**
 * The `init_source` values that mean a branch began with production's tables and none of its rows.
 * Neon takes `schema-only` when a branch is created but lists that same branch back as
 * `parent-schema` (seen on the first real staging deploy, 2026-11-06), so both count: refusing
 * `parent-schema` made every staging deploy after the first fail on the branch it had made itself.
 */
const SCHEMA_ONLY_SOURCES = new Set(["schema-only", "parent-schema"]);

/**
 * The branch `env` deploys on. Production's is the project's default branch (README: the owner kept
 * it as the production branch). Previews' and staging's is {@link STAGING_BRANCH}, created when
 * missing as a **schema-only** branch of production: production's tables with none of its rows,
 * so no fan's account, settings or deletion-log entry ever reaches it (S114 AC 9). A branch of
 * that name that began as a copy of production's data is refused rather than deployed on.
 */
export async function findOrCreateBranch(api: NeonApi, env: DeployEnv): Promise<Found<NeonBranch>>
{
	const { branches } = await neon<{ branches: NeonBranch[] }>(api, "/branches");
	const production = branches.find((branch) => branch.default);
	if (!production) throw new Error("Neon: the project has no default (production) branch");
	if (env === "production") return {
		value: production,
		created: false,
	};
	const staging = branches.find((branch) => branch.name === STAGING_BRANCH);
	if (staging)
	{
		if (staging.id === production.id || (staging.init_source !== undefined && !SCHEMA_ONLY_SOURCES.has(staging.init_source)))
		{
			throw new Error(`Neon: the ${STAGING_BRANCH} branch began as a copy of production's data (init_source ${staging.init_source ?? "default"}); staging never holds a fan's data, so delete it and deploy again to recreate it schema-only`);
		}
		return {
			value: staging,
			created: false,
		};
	}
	const { branch } = await neon<{ branch: NeonBranch }>(api, "/branches", {
		method: "POST",
		body: JSON.stringify({
			branch: {
				name: STAGING_BRANCH,
				parent_id: production.id,
				init_source: "schema-only",
			},
			endpoints: [{
				type: "read_write",
			}],
		}),
	});
	return {
		value: await untilReady(api, branch),
		created: true,
	};
}

/** Waits (up to about a minute) for a new branch's creation to finish before anything connects. */
async function untilReady(api: NeonApi, branch: NeonBranch): Promise<NeonBranch>
{
	const sleep = api.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	let current = branch;
	for (let attempt = 0; current.current_state !== "ready"; attempt++)
	{
		if (attempt >= 30) throw new Error(`Neon: branch ${branch.name} is still ${current.current_state ?? "unknown"}`);
		await sleep(2_000);
		current = (await neon<{ branch: NeonBranch }>(api, `/branches/${branch.id}`)).branch;
	}
	return current;
}

/** One compute endpoint of the project: the host a connection string names, and its branch. */
export type NeonEndpoint = {
	host: string;
	branch_id: string;
};

/** Every compute endpoint of the project (S122 tells production's apart from other branches' by them). */
export async function projectEndpoints(api: NeonApi): Promise<NeonEndpoint[]>
{
	return (await neon<{ endpoints: NeonEndpoint[] }>(api, "/endpoints")).endpoints;
}

/**
 * The branch's direct (unpooled) connection string, for its first database and that database's
 * owner: what `pnpm db:migrate` and Hyperdrive connect with. It carries a password, so the caller
 * masks it and never writes it to the repo.
 */
export async function branchConnectionString(api: NeonApi, branchId: string): Promise<string>
{
	const { databases } = await neon<{ databases: { name: string;
		owner_name: string; }[]; }>(api, `/branches/${branchId}/databases`);
	const database = databases[0];
	if (!database) throw new Error(`Neon: branch ${branchId} has no database`);
	const query = new URLSearchParams({
		branch_id: branchId,
		database_name: database.name,
		role_name: database.owner_name,
		pooled: "false",
	});
	return (await neon<{ uri: string }>(api, `/connection_uri?${query}`)).uri;
}

/**
 * Readies a schema-only copy for `pnpm db:migrate` (staging only; never production). A schema-only
 * branch holds production's tables, Drizzle's record of applied migrations among them, with no
 * rows, so the migrator would try to create tables that exist. A database with tables but no
 * record of any migration can only be such a fresh copy: its empty schemas are dropped so the
 * migrations build every table, as on any new database. One that has migrated is left alone, so
 * the step runs on every deploy and changes nothing after the first. Returns whether it reset.
 */
export async function prepareSchemaOnlyCopy(db: PostgresDb): Promise<boolean>
{
	const rows = async (query: ReturnType<typeof sql>) => (await db.execute(query) as unknown as { rows: Record<string, unknown>[] }).rows;
	const [ledger] = await rows(sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`);
	if (ledger?.present)
	{
		const [applied] = await rows(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
		if (Number(applied?.n) > 0) return false;
	}
	const [tables] = await rows(sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`);
	if (Number(tables?.n) === 0) return false;
	await db.execute(sql`DROP SCHEMA public CASCADE`);
	await db.execute(sql`CREATE SCHEMA public`);
	await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
	return true;
}

/** The parts of a Wrangler config the deploy reads and writes. */
export type WranglerConfig = Record<string, unknown> & {
	main?: string;
	assets?: Record<string, unknown> & { directory?: string };
	env?: Record<string, Record<string, unknown> & {
		name?: string;
		hyperdrive?: { binding: string;
			id: string; }[];
		vars?: Record<string, string>;
	}>;
};

/** `wrangler.jsonc` as data: its whole-line `//` comments dropped (the file has no other kind). */
export function parseWranglerConfig(text: string): WranglerConfig
{
	return JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as WranglerConfig;
}

/** What one deploy writes into its env's block. `workerName` and `appOrigin` are a preview's own. */
export type DeployTarget = {
	hyperdriveId: string;
	workerName?: string;
	appOrigin?: string;
};

/**
 * The config one deploy uses: `wrangler.jsonc` with `env`'s Hyperdrive binding set to the id found
 * by name (the file holds only placeholders), and, for a preview, its own Worker name and address.
 * The paths are rebased (`rebase`), since the generated file sits apart from `wrangler.jsonc`.
 */
export function deployConfig(base: WranglerConfig, env: DeployEnv, target: DeployTarget, rebase: (path: string) => string): WranglerConfig
{
	const block = base.env?.[env];
	if (!block) throw new Error(`wrangler.jsonc has no env.${env}`);
	const { $schema: _schema, ...config } = structuredClone(base);
	const out = config as WranglerConfig;
	const envBlock = out.env![env]!;
	envBlock.hyperdrive = (block.hyperdrive ?? []).map((binding) => binding.binding === "HYPERDRIVE" ? {
		...binding,
		id: target.hyperdriveId,
	} : binding);
	if (!envBlock.hyperdrive.some((binding) => binding.binding === "HYPERDRIVE")) throw new Error(`wrangler.jsonc env.${env} has no HYPERDRIVE binding`);
	if (target.workerName) envBlock.name = target.workerName;
	if (target.appOrigin) envBlock.vars = {
		...envBlock.vars,
		BT_APP_ORIGIN: target.appOrigin,
	};
	if (out.main) out.main = rebase(out.main);
	if (out.assets?.directory) out.assets.directory = rebase(out.assets.directory);
	return out;
}

/**
 * Every one of `env`'s Worker secrets ({@link workerSecretNames}) from `source` (the job's env,
 * mapped from GitHub secrets); a missing one fails the deploy. Only those names are taken, so a
 * secret another env's job happens to carry never reaches this env's Worker.
 */
export function workerSecrets(source: Record<string, string | undefined>, env: DeployEnv): Record<string, string>
{
	const names = workerSecretNames(env);
	const missing = names.filter((name) => !source[name]);
	if (missing.length) throw new Error(`missing Worker secrets (set them as GitHub secrets): ${missing.join(", ")}`);
	return Object.fromEntries(names.map((name) => [name, source[name]!]));
}

/** Everything one env's deploy needs, found or created. */
export type DeployPlan = {
	env: DeployEnv;
	databaseUrl: string;
	hyperdriveId: string;
	workerName?: string;
	appOrigin?: string;
	config: WranglerConfig;
	secrets: Record<string, string>;
	/** What this run created; empty when everything already existed. */
	created: string[];
};

export type BootstrapDeps = {
	cloudflare: CloudflareApi;
	neon: NeonApi;
	/** `wrangler.jsonc`, parsed. */
	wrangler: WranglerConfig;
	rebase: (path: string) => string;
	/** The job's env: the Worker secrets, mapped from GitHub secrets. */
	secrets: Record<string, string | undefined>;
	/** {@link prepareSchemaOnlyCopy} on the branch's database; never called for production. */
	prepareCopy: (databaseUrl: string) => Promise<boolean>;
};

/**
 * The bootstrap for one deploy of `env` (`pullRequest` for a preview): branch, connection string,
 * the schema-only copy readied (staging's database only), Hyperdrive config, Worker config and
 * secrets. Idempotent: a second run finds everything the first created and creates nothing.
 */
export async function bootstrapDeploy(deps: BootstrapDeps, env: DeployEnv, pullRequest?: number): Promise<DeployPlan>
{
	if (env === "preview" && !pullRequest) throw new Error("a preview deploy names its pull request (--pr <number>)");
	const secrets = workerSecrets(deps.secrets, env);
	const created: string[] = [];
	const branch = await findOrCreateBranch(deps.neon, env);
	if (branch.created) created.push(`Neon branch ${branch.value.name} (schema-only)`);
	const databaseUrl = await branchConnectionString(deps.neon, branch.value.id);
	if (env !== "production" && await deps.prepareCopy(databaseUrl)) created.push(`empty schemas on ${branch.value.name}, ready to migrate`);
	const hyperdrive = await findOrCreateHyperdrive(deps.cloudflare, HYPERDRIVE_CONFIG[env], databaseUrl);
	if (hyperdrive.created) created.push(`Hyperdrive config ${HYPERDRIVE_CONFIG[env]}`);
	const workerName = env === "preview" ? previewWorkerName(pullRequest!) : undefined;
	const appOrigin = workerName ? `https://${workerName}.${await workersDevSubdomain(deps.cloudflare)}.workers.dev` : undefined;
	return {
		env,
		databaseUrl,
		hyperdriveId: hyperdrive.value,
		...workerName && {
			workerName,
		},
		...appOrigin && {
			appOrigin,
		},
		config: deployConfig(deps.wrangler, env, {
			hyperdriveId: hyperdrive.value,
			...workerName && {
				workerName,
			},
			...appOrigin && {
				appOrigin,
			},
		}, deps.rebase),
		secrets,
		created,
	};
}
