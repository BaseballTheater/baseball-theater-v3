/**
 * The deploy's bootstrapping (S114; owner, 2026-11-05: "It should be idempotent so it can happen
 * with every deployment. All the bootstrapping should be like that."). Before every preview,
 * staging or production deploy, `pnpm deploy:bootstrap <env>` (`src/scripts/deploy-bootstrap.ts`)
 * finds, or creates when missing, what that env's Worker runs on: its Neon branch, its connection
 * string, its Hyperdrive config by name, the Worker config with that config's id, and the Worker
 * secrets from GitHub. Each step reads what exists first and creates only what is missing, so the
 * same deploy run again changes nothing and fails nothing; a preview's re-run resets its branch from
 * staging and rewrites its Hyperdrive config, ending as the first run did. The workflow then runs `pnpm db:migrate`
 * and `pnpm db:reapply-deletions` on the branch and deploys.
 *
 * Previews (issue #42; owner, 2026-11-13, asked "may I change deploy.yml so each PR's preview gets
 * its own Neon branch, deleted when the PR closes?": "Yes, do that."): each pull request's preview
 * runs on its own branch, `preview-pr-<N>`, a copy of staging's branch that every deploy resets
 * from staging (owner, asked whether to: "yes"), behind its own Hyperdrive config,
 * `bt-preview-pr-<N>`. So a pull request's migrations never reach staging's database, which only
 * ever runs `stage`'s. {@link teardownPreview} deletes both when the pull request closes, and
 * {@link cleanupPreviews} sweeps any a closed pull request left behind (weekly, or by hand).
 *
 * The APIs are reached through an injected `fetch` (tests pass stand-ins; nothing here ever runs
 * against a hosted service outside GitHub Actions). Staging never holds a fan's data: its branch
 * is created schema-only from production, never as a plain branch (S114 AC 9), and nothing here
 * copies rows from production (production's baseball data is S117's manual copy). A preview's
 * branch copies staging's, so it holds no fan's data either.
 */
import { sql } from "drizzle-orm";
import { databaseTarget } from "../adapters/postgres/local.js";
import type { PostgresDb } from "../adapters/postgres/repos.js";

/** A deployed environment, as `wrangler.jsonc` names it under `env`. */
export type DeployEnv = "preview" | "staging" | "production";

export const DEPLOY_ENVS: readonly DeployEnv[] = ["preview", "staging", "production"];

/**
 * Staging's and production's Hyperdrive configs, by their constant names. A preview has its own,
 * named for its pull request ({@link previewHyperdriveName}; issue #42), no longer staging's.
 */
export const HYPERDRIVE_CONFIG: Record<Exclude<DeployEnv, "preview">, string> = {
	staging: "bt-staging",
	production: "bt-production",
};

/** The long-lived Neon branch staging runs on, and every preview's branch is made from; production is the project's default branch. */
export const STAGING_BRANCH = "staging";

/**
 * A pull request's number from the command line (`--pr <N>`): a positive whole number, written
 * plainly. Anything else (empty, `07`, `1e3`, `1.5`) is refused, so no step ever builds a name
 * like `preview-pr-NaN` or `preview-pr-` and deletes or creates the wrong thing.
 */
export function parsePullRequest(arg: string | undefined): number
{
	if (arg === undefined || !/^[1-9]\d*$/.test(arg)) throw new Error(`a pull request is a positive whole number (--pr <number>), not ${JSON.stringify(arg ?? "")}`);
	return Number(arg);
}

function assertPullRequest(pullRequest: number): void
{
	if (!Number.isSafeInteger(pullRequest) || pullRequest < 1) throw new Error(`a pull request is a positive whole number, not ${pullRequest}`);
}

/** A preview's own Neon branch (issue #42), made from {@link STAGING_BRANCH}. */
export function previewBranchName(pullRequest: number): string
{
	return `preview-pr-${pullRequest}`;
}

/** A preview's own Hyperdrive config (issue #42), over {@link previewBranchName}'s branch. */
export function previewHyperdriveName(pullRequest: number): string
{
	return `bt-preview-pr-${pullRequest}`;
}

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
	const result = await cloudflareOrMissing<T>(api, path, init, false);
	return result as T;
}

/**
 * A Cloudflare API call. With `missingIsFine`, a 404 answers `undefined` instead of failing (a
 * Worker that is already gone); every other refusal throws with Cloudflare's errors.
 */
async function cloudflareOrMissing<T>(api: CloudflareApi, path: string, init: RequestInit, missingIsFine: boolean): Promise<T | undefined>
{
	const response = await api.fetch(`https://api.cloudflare.com/client/v4/accounts/${api.accountId}${path}`, {
		...init,
		headers: {
			"Authorization": `Bearer ${api.token}`,
			"Content-Type": "application/json",
		},
	});
	if (missingIsFine && response.status === 404) return undefined;
	const body = await response.json() as { success?: boolean;
		result?: T;
		errors?: unknown; };
	if (!response.ok || !body.success) throw new Error(`Cloudflare ${init.method ?? "GET"} ${path.split("?")[0]}: ${response.status} ${JSON.stringify(body.errors ?? body)}`);
	return body.result as T;
}

/**
 * How long a Neon write waits before each retry while Neon answers 423 Locked (another operation
 * still holds the branch or project, e.g. the previous deploy's reset): doubling from a second,
 * capped at eight, about a minute in all.
 */
const NEON_LOCKED_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 8_000, 8_000, 8_000, 8_000, 8_000];

function sleeper(api: NeonApi): (ms: number) => Promise<void>
{
	return api.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

/** A Neon refusal, with its status, so callers can tell a lock from a limit. */
export class NeonError extends Error
{
	constructor(message: string, readonly status: number)
	{
		super(message);
	}
}

async function neon<T>(api: NeonApi, path: string, init: RequestInit = {}): Promise<T>
{
	const method = init.method ?? "GET";
	for (let attempt = 0; ; attempt++)
	{
		const response = await api.fetch(`https://console.neon.tech/api/v2/projects/${api.projectId}${path}`, {
			...init,
			headers: {
				"Authorization": `Bearer ${api.apiKey}`,
				"Accept": "application/json",
				"Content-Type": "application/json",
			},
		});
		if (response.ok) return await response.json() as T;
		const text = await response.text();
		const wait = NEON_LOCKED_BACKOFF_MS[attempt];
		if (response.status === 423 && method !== "GET" && wait !== undefined)
		{
			await sleeper(api)(wait);
			continue;
		}
		const locked = response.status === 423 ? ` (still locked by another Neon operation after ${attempt + 1} tries; re-run the job once it finishes)` : "";
		throw new NeonError(`Neon ${method} ${path}: ${response.status} ${text}${locked}`, response.status);
	}
}

/** A Neon operation, as a write answers it and `GET /operations/<id>` reports it. */
type NeonOperation = { id: string;
	status: string;
	action?: string; };

const OPERATION_DONE = new Set(["finished", "skipped"]);
const OPERATION_FAILED = new Set(["failed", "error", "cancelled"]);

/**
 * Waits (up to about two minutes) for each operation a Neon write started to finish, so nothing
 * connects to a branch still being created, reset or deleted. A failed, errored or cancelled one
 * fails the deploy, naming it.
 */
async function untilOperationsDone(api: NeonApi, operations: NeonOperation[] | undefined): Promise<void>
{
	for (const started of operations ?? [])
	{
		let current = started;
		for (let attempt = 0; !OPERATION_DONE.has(current.status); attempt++)
		{
			if (OPERATION_FAILED.has(current.status)) throw new Error(`Neon: operation ${started.id} (${started.action ?? "unknown"}) ended ${current.status}`);
			if (attempt >= 60) throw new Error(`Neon: operation ${started.id} (${started.action ?? "unknown"}) is still ${current.status}`);
			await sleeper(api)(2_000);
			current = {
				...started,
				...(await neon<{ operation: NeonOperation }>(api, `/operations/${started.id}`)).operation,
			};
		}
	}
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
	const existing = (await hyperdriveConfigs(api)).find((config) => config.name === name);
	if (existing) return {
		value: existing.id,
		created: false,
	};
	const created = await cloudflare<{ id: string }>(api, "/hyperdrive/configs", {
		method: "POST",
		body: JSON.stringify({
			name,
			origin: hyperdriveOrigin(connectionString),
		}),
	});
	return {
		value: created.id,
		created: true,
	};
}

/** The origin a Hyperdrive config connects to, from a connection string (password included). */
function hyperdriveOrigin(connectionString: string): Record<string, string | number>
{
	const url = new URL(connectionString);
	return {
		scheme: "postgres",
		host: url.hostname,
		port: Number(url.port || 5432),
		database: decodeURIComponent(url.pathname.slice(1)),
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
	};
}

/** Cloudflare's largest page of Hyperdrive configs. */
const HYPERDRIVE_PAGE = 100;

/**
 * Every Hyperdrive config in the account. Cloudflare pages the list (20 by default), so it is read
 * a full page at a time until a page comes back short: a config past the first page is still found.
 */
async function hyperdriveConfigs(api: CloudflareApi): Promise<{ id: string;
	name: string; }[]>
{
	const all: { id: string;
		name: string; }[] = [];
	for (let page = 1; ; page++)
	{
		const batch = await cloudflare<{ id: string;
			name: string; }[]>(api, `/hyperdrive/configs?page=${page}&per_page=${HYPERDRIVE_PAGE}`);
		all.push(...batch);
		if (batch.length < HYPERDRIVE_PAGE) return all;
	}
}

/** The configs named `name`; more than one is refused, since a deploy can't tell which is its own. */
async function hyperdriveNamed(api: CloudflareApi, name: string): Promise<{ id: string } | undefined>
{
	const matches = (await hyperdriveConfigs(api)).filter((config) => config.name === name);
	if (matches.length > 1) throw new Error(`Cloudflare: ${matches.length} Hyperdrive configs named ${name}; delete the extra ones by hand`);
	return matches[0];
}

/**
 * A preview's Hyperdrive config (issue #42), its whole origin written on every deploy: Cloudflare
 * never returns a config's password, so a stale one (a recreated branch, a reset role) could not
 * be seen to compare, and writing it each time is the only way to be sure. Query caching is off:
 * after a reset from staging a cached read could show the database as it was, and a preview's
 * traffic is too light for the cache to help.
 */
async function writePreviewHyperdrive(api: CloudflareApi, name: string, connectionString: string): Promise<Found<string>>
{
	const body = JSON.stringify({
		name,
		origin: hyperdriveOrigin(connectionString),
		caching: {
			disabled: true,
		},
	});
	const existing = await hyperdriveNamed(api, name);
	if (existing)
	{
		await cloudflare(api, `/hyperdrive/configs/${existing.id}`, {
			method: "PUT",
			body,
		});
		return {
			value: existing.id,
			created: false,
		};
	}
	try
	{
		return {
			value: (await cloudflare<{ id: string }>(api, "/hyperdrive/configs", {
				method: "POST",
				body,
			})).id,
			created: true,
		};
	}
	catch (error)
	{
		// The hint only when Cloudflare's refusal reads as a limit; anything else is passed on as it is.
		if (!/limit|maximum|too many/i.test((error as Error).message)) throw error;
		throw new Error(`${(error as Error).message}. Cloudflare refused ${name}: the account is at its Hyperdrive config limit (25 on Workers Paid, 10 on Free); close stale pull requests (closing deletes their previews) or run the Preview cleanup workflow`);
	}
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
	parent_id?: string;
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
 * The project's default (production) branch and the existing branch `env` deploys on, if any,
 * with the refusals both {@link findOrCreateBranch} and {@link findBranch} rely on: no default
 * branch, or a staging branch that is production's or began as a copy of production's data.
 * It only reads; creating a missing branch is `findOrCreateBranch`'s job alone.
 */
async function lookUpBranch(api: NeonApi, env: DeployEnv): Promise<{ production: NeonBranch;
	branch: NeonBranch | undefined; }>
{
	const { branches } = await neon<{ branches: NeonBranch[] }>(api, "/branches");
	const production = branches.find((branch) => branch.default);
	if (!production) throw new Error("Neon: the project has no default (production) branch");
	if (env === "production") return {
		production,
		branch: production,
	};
	const staging = branches.find((branch) => branch.name === STAGING_BRANCH);
	if (staging && (staging.id === production.id || (staging.init_source !== undefined && !SCHEMA_ONLY_SOURCES.has(staging.init_source))))
	{
		throw new Error(`Neon: the ${STAGING_BRANCH} branch began as a copy of production's data (init_source ${staging.init_source ?? "default"}); staging never holds a fan's data, so delete it and deploy again to recreate it schema-only (Neon won't delete a branch that has children: close or tear down open previews' branches first)`);
	}
	return {
		production,
		branch: staging,
	};
}

/**
 * The branch `env` deploys on when it already exists, never creating one (S117's copy: writing
 * into a branch the copy had just made would skip the deploy that sets it up). Undefined when
 * `env`'s branch doesn't exist yet; refused like {@link findOrCreateBranch} otherwise.
 */
export async function findBranch(api: NeonApi, env: DeployEnv): Promise<NeonBranch | undefined>
{
	return (await lookUpBranch(api, env)).branch;
}

/**
 * The branch `env` deploys on. Production's is the project's default branch (README: the owner kept
 * it as the production branch). Staging's is {@link STAGING_BRANCH}, created when
 * missing as a **schema-only** branch of production: production's tables with none of its rows,
 * so no fan's account, settings or deletion-log entry ever reaches it (S114 AC 9). A branch of
 * that name that began as a copy of production's data is refused rather than deployed on. A
 * preview's own branch is {@link findOrCreatePreviewBranch}'s (issue #42), made from this one.
 */
export async function findOrCreateBranch(api: NeonApi, env: DeployEnv): Promise<Found<NeonBranch>>
{
	const { production, branch: existing } = await lookUpBranch(api, env);
	if (existing) return {
		value: existing,
		created: false,
	};
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

/**
 * Waits (up to about a minute) for a branch to be ready before anything connects or writes to it.
 * With `archivedIsFine`, an archived branch is taken as it is: Neon archives an idle child branch
 * (over two weeks old, a day without use), it stays archived until something writes to it, and the
 * reset that follows is such a write. Without it, archived is waited on like any other state.
 */
async function untilReady(api: NeonApi, branch: NeonBranch, archivedIsFine = false): Promise<NeonBranch>
{
	const sleep = sleeper(api);
	let current = branch;
	for (let attempt = 0; current.current_state !== "ready" && !(archivedIsFine && current.current_state === "archived"); attempt++)
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

/** A Neon host without its pooler suffix: `ep-x-1-pooler.region.aws.neon.tech` → `ep-x-1.region.aws.neon.tech`. */
export function endpointHost(host: string): string
{
	const [first = "", ...rest] = host.split(".");
	return [first.replace(/-pooler$/, ""), ...rest].join(".");
}

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

/** The branches named `name`; more than one is refused, since a deploy can't tell which is its own. */
async function branchNamed(api: NeonApi, name: string): Promise<{ branches: NeonBranch[];
	branch: NeonBranch | undefined; }>
{
	const { branches } = await neon<{ branches: NeonBranch[] }>(api, "/branches");
	const matches = branches.filter((branch) => branch.name === name);
	if (matches.length > 1) throw new Error(`Neon: ${matches.length} Neon branches named ${name}; delete the extra ones by hand`);
	return {
		branches,
		branch: matches[0],
	};
}

/**
 * Refuses a `preview-pr-<N>` branch that wasn't made from staging (a hand-made one, or one from
 * production): a preview deploy writes it and a teardown deletes it, so it must be a preview's.
 */
function assertPreviewOfStaging(branch: NeonBranch, staging: NeonBranch | undefined): void
{
	if (branch.default || !staging || branch.parent_id !== staging.id)
	{
		throw new Error(`Neon: ${branch.name} (${branch.id}) is not a branch of ${STAGING_BRANCH}; a preview only ever uses a branch made from staging, so delete it and deploy again`);
	}
}

/**
 * A pull request's own branch (issue #42): `preview-pr-<N>`, a copy-on-write child of staging's
 * branch (never production's; staging itself is refused if it began as a copy of production's
 * data, S114 AC 9). Made when missing; when it exists, reset from staging, so a preview is always
 * staging as it is now plus this pull request's migrations: a migration the pull request rewrote,
 * or one that reached `stage` with an older timestamp, can't be silently skipped (owner, asked
 * whether to reset on every push: "yes"). The reset discards what the preview wrote, which is only
 * MLB data staging has too (previews have no sign-in). Each write's Neon operations are waited for.
 */
async function findOrCreatePreviewBranch(api: NeonApi, pullRequest: number): Promise<{ branch: NeonBranch;
	created: string[]; }>
{
	const created: string[] = [];
	const staging = await findOrCreateBranch(api, "staging");
	if (staging.created) created.push(`Neon branch ${STAGING_BRANCH} (schema-only)`);
	const name = previewBranchName(pullRequest);
	const { branch: existing } = await branchNamed(api, name);
	if (existing)
	{
		assertPreviewOfStaging(existing, staging.value);
		await untilReady(api, existing, true);
		const reset = await neon<{ operations?: NeonOperation[] }>(api, `/branches/${existing.id}/restore`, {
			method: "POST",
			body: JSON.stringify({
				source_branch_id: staging.value.id,
			}),
		});
		await untilOperationsDone(api, reset.operations);
		created.push(`reset ${name} from ${STAGING_BRANCH}`);
		// Read again: the listed state is from before the reset, so it says nothing about now.
		return {
			branch: await untilReady(api, {
				...existing,
				current_state: undefined,
			}),
			created,
		};
	}
	let made: { branch: NeonBranch;
		operations?: NeonOperation[]; };
	try
	{
		made = await neon(api, "/branches", {
			method: "POST",
			body: JSON.stringify({
				branch: {
					name,
					parent_id: staging.value.id,
				},
				endpoints: [{
					type: "read_write",
				}],
			}),
		});
	}
	catch (error)
	{
		if (error instanceof NeonError && [403, 422].includes(error.status) && /limit/i.test(error.message))
		{
			throw new Error(`Neon refused a branch for ${name} (${error.message}). The project may be at its plan's branch limit: close stale pull requests (closing deletes their previews) or run the Preview cleanup workflow, or raise the limit`);
		}
		throw error;
	}
	await untilOperationsDone(api, made.operations);
	created.push(`Neon branch ${name} (from ${STAGING_BRANCH})`);
	return {
		branch: await untilReady(api, made.branch),
		created,
	};
}

/** The connection-string parameters Neon's API answers with, which can't change where it connects. */
const SAFE_CONNECTION_PARAMETERS = new Set(["sslmode", "channel_binding"]);

/**
 * Fails closed unless `connectionString` reaches `branch`'s own compute: both the host a URL
 * parser reads (what Hyperdrive is given) and the host pg connects to (what `pnpm db:migrate`
 * uses) must be an endpoint of that branch. So a wrong answer from Neon can never point a
 * preview's migrations at staging or production.
 */
async function assertBranchHost(api: NeonApi, connectionString: string, branch: NeonBranch): Promise<void>
{
	const target = databaseTarget(connectionString);
	const url = new URL(connectionString);
	const hosts = [url.hostname, target.host];
	// Only the parameters Neon itself puts there: any other (`host`, `hostaddr`, Neon's own
	// `options=endpoint=<id>` routing, …) could send pg or Neon's proxy somewhere else.
	const extra = [...url.searchParams.keys()].filter((key) => !SAFE_CONNECTION_PARAMETERS.has(key));
	const ours = new Set((await projectEndpoints(api)).filter((endpoint) => endpoint.branch_id === branch.id).map((endpoint) => endpointHost(endpoint.host)));
	if (extra.length || target.hostaddr !== undefined || hosts.some((host) => !ours.has(endpointHost(host))))
	{
		throw new Error(`Neon: the preview's connection string is not the preview branch's (${branch.name}); refusing to use it`);
	}
}

/** Deletes a preview's Worker; one that is already gone is fine. */
async function deleteWorker(api: CloudflareApi, name: string): Promise<boolean>
{
	const deleted = await cloudflareOrMissing(api, `/workers/scripts/${encodeURIComponent(name)}?force=true`, {
		method: "DELETE",
	}, true);
	return deleted !== undefined;
}

/** What a teardown or cleanup reaches: the two APIs, nothing else. */
export type TeardownDeps = Pick<BootstrapDeps, "cloudflare" | "neon">;

/** A Neon delete that another run (a teardown racing the cleanup) already made answers 404: that is fine. */
async function deleteBranch(api: NeonApi, branch: NeonBranch): Promise<void>
{
	try
	{
		const deleted = await neon<{ operations?: NeonOperation[] }>(api, `/branches/${branch.id}`, {
			method: "DELETE",
		});
		await untilOperationsDone(api, deleted.operations);
	}
	catch (error)
	{
		if (!(error instanceof NeonError && error.status === 404)) throw error;
	}
}

/**
 * Deletes a closed pull request's preview (issue #42): its Worker first (it binds the config),
 * then its Hyperdrive config, then its Neon branch, waiting for the delete's operations. Whatever
 * is already gone is skipped, so a second teardown does nothing. It deletes only things named for
 * this pull request, refuses a branch not made from staging or a name held twice, and throws on
 * any other refusal, so the job fails rather than leaving things behind quietly. A delete that a
 * racing run (the cleanup, in another concurrency group) already made counts as done. `beforeDeleting`
 * runs after the lookups and before the first delete; the cleanup re-reads the pull request's state
 * there and throws if it reopened. Returns what it deleted.
 */
export async function teardownPreview(deps: TeardownDeps, pullRequest: number, beforeDeleting?: () => Promise<void>): Promise<string[]>
{
	assertPullRequest(pullRequest);
	const removed: string[] = [];
	const worker = previewWorkerName(pullRequest);
	const config = previewHyperdriveName(pullRequest);
	const name = previewBranchName(pullRequest);
	const { branches, branch } = await branchNamed(deps.neon, name);
	if (branch) assertPreviewOfStaging(branch, branches.find((b) => b.name === STAGING_BRANCH));
	const hyperdrive = await hyperdriveNamed(deps.cloudflare, config);
	await beforeDeleting?.();
	if (await deleteWorker(deps.cloudflare, worker)) removed.push(`Worker ${worker}`);
	if (hyperdrive)
	{
		await cloudflareOrMissing(deps.cloudflare, `/hyperdrive/configs/${hyperdrive.id}`, {
			method: "DELETE",
		}, true);
		removed.push(`Hyperdrive config ${config}`);
	}
	if (branch)
	{
		await deleteBranch(deps.neon, branch);
		removed.push(`Neon branch ${name}`);
	}
	return removed;
}

/** Thrown by the cleanup's last check when a pull request was reopened before its first delete: kept, not failed. */
class ReopenedError extends Error
{
	constructor()
	{
		super("the pull request was reopened; left alone");
	}
}

/** A pull request's state as GitHub reports it (`open` or `closed`). */
export type PullRequestState = (pullRequest: number) => Promise<string>;

/** What a cleanup did: the pull requests torn down, kept (still open) and not checked. */
export type CleanupResult = {
	tornDown: number[];
	kept: number[];
	failed: { pullRequest: number;
		error: string; }[];
};

/**
 * The preview sweep (issue #42; owner, 2026-11-13: "Yes, I like the cleanup option better. Need
 * to be able to manually run it though, as well."), run weekly and by hand by
 * `.github/workflows/preview-cleanup.yml`. It finds every `preview-pr-<N>` branch,
 * `bt-preview-pr-<N>` config and `baseball-theater-pr-<N>` Worker (exact names only), asks GitHub
 * for each pull request's state, and tears down ({@link teardownPreview}) only those whose pull
 * request is closed; an open one is never touched, however old. It asks again right before the
 * first delete, so a pull request reopened meanwhile is left alone and counted as `kept` (it is
 * open, which is no failure); one reopened in the seconds after that is rebuilt by its own preview
 * run, which recreates whatever was deleted. One whose state can't be read, isn't open or closed,
 * or whose teardown fails, is skipped and listed in `failed`, and the caller fails the run once the
 * rest are done.
 */
export async function cleanupPreviews(deps: TeardownDeps, stateOf: PullRequestState): Promise<CleanupResult>
{
	const { branches } = await neon<{ branches: NeonBranch[] }>(deps.neon, "/branches");
	const configs = await hyperdriveConfigs(deps.cloudflare);
	const workers = await cloudflare<{ id: string }[]>(deps.cloudflare, "/workers/scripts");
	const numbers = new Set<number>();
	for (const [names, pattern] of [
		[branches.map((b) => b.name), /^preview-pr-([1-9]\d*)$/],
		[configs.map((c) => c.name), /^bt-preview-pr-([1-9]\d*)$/],
		[workers.map((w) => w.id), /^baseball-theater-pr-([1-9]\d*)$/],
	] as const)
	{
		for (const name of names)
		{
			const match = pattern.exec(name);
			if (match) numbers.add(Number(match[1]));
		}
	}
	const result: CleanupResult = {
		tornDown: [],
		kept: [],
		failed: [],
	};
	for (const pullRequest of [...numbers].sort((a, b) => a - b))
	{
		try
		{
			const state = await stateOf(pullRequest);
			if (state === "open")
			{
				result.kept.push(pullRequest);
				continue;
			}
			if (state !== "closed") throw new Error(`GitHub says the pull request is ${JSON.stringify(state)}`);
			await teardownPreview(deps, pullRequest, async () =>
			{
				const now = await stateOf(pullRequest);
				if (now === "open") throw new ReopenedError();
				if (now !== "closed") throw new Error(`GitHub says the pull request is ${JSON.stringify(now)}`);
			});
			result.tornDown.push(pullRequest);
		}
		catch (error)
		{
			if (error instanceof ReopenedError)
			{
				result.kept.push(pullRequest);
				continue;
			}
			result.failed.push({
				pullRequest,
				error: (error as Error).message,
			});
		}
	}
	return result;
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
 * the schema-only copy readied (staging's or the preview's own database; never production's),
 * Hyperdrive config, Worker config and secrets. Idempotent: a second run finds everything the
 * first created and creates nothing; a preview's second run resets its branch from staging and
 * rewrites its config's origin, ending as the first did.
 */
export async function bootstrapDeploy(deps: BootstrapDeps, env: DeployEnv, pullRequest?: number): Promise<DeployPlan>
{
	if (env === "preview")
	{
		if (pullRequest === undefined) throw new Error("a preview deploy names its pull request (--pr <number>)");
		assertPullRequest(pullRequest);
	}
	const secrets = workerSecrets(deps.secrets, env);
	const created: string[] = [];
	let databaseUrl: string;
	let hyperdrive: Found<string>;
	if (env === "preview")
	{
		const preview = await findOrCreatePreviewBranch(deps.neon, pullRequest!);
		created.push(...preview.created);
		databaseUrl = await branchConnectionString(deps.neon, preview.branch.id);
		await assertBranchHost(deps.neon, databaseUrl, preview.branch);
		if (await deps.prepareCopy(databaseUrl)) created.push(`empty schemas on ${preview.branch.name}, ready to migrate`);
		hyperdrive = await writePreviewHyperdrive(deps.cloudflare, previewHyperdriveName(pullRequest!), databaseUrl);
		if (hyperdrive.created) created.push(`Hyperdrive config ${previewHyperdriveName(pullRequest!)}`);
	}
	else
	{
		const branch = await findOrCreateBranch(deps.neon, env);
		if (branch.created) created.push(`Neon branch ${branch.value.name} (schema-only)`);
		databaseUrl = await branchConnectionString(deps.neon, branch.value.id);
		if (env !== "production" && await deps.prepareCopy(databaseUrl)) created.push(`empty schemas on ${branch.value.name}, ready to migrate`);
		hyperdrive = await findOrCreateHyperdrive(deps.cloudflare, HYPERDRIVE_CONFIG[env], databaseUrl);
		if (hyperdrive.created) created.push(`Hyperdrive config ${HYPERDRIVE_CONFIG[env]}`);
	}
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
