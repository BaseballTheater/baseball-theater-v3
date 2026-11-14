/**
 * S114: the deploy's bootstrapping against stand-ins for the Cloudflare and Neon APIs (an
 * in-memory account and project behind a `fetch`) and PGlite. Nothing here reaches a hosted
 * service. The point is idempotence (AC 5): a second deploy finds what the first created.
 * Issue #42: each pull request's preview on its own Neon branch, reset from staging on every
 * deploy and deleted when the pull request closes, so a preview never writes staging's database.
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import {
	describe, expect, it,
} from "vitest";
import { migratedPglite, MIGRATIONS_FOLDER } from "../adapters/postgres/migrate.js";
import type { PostgresDb } from "../adapters/postgres/repos.js";
import type { BootstrapDeps, NeonBranch } from "./bootstrap.js";
import {
	bootstrapDeploy, cleanupPreviews, deployConfig, findOrCreateBranch, HYPERDRIVE_CONFIG, parsePullRequest, parseWranglerConfig, prepareSchemaOnlyCopy, previewHyperdriveName,
	previewBranchName, previewWorkerName, teardownPreview, workerSecrets,
} from "./bootstrap.js";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";

const WRANGLER = parseWranglerConfig(readFileSync(new URL("../../../wrangler.jsonc", import.meta.url), "utf8"));
const STAGING_URL = "postgres://neondb_owner:s%40cret@ep-staging.neon.tech:5432/neondb?sslmode=require";
const PRODUCTION_URL = "postgres://neondb_owner:prod@ep-production.neon.tech/neondb?sslmode=require";

type Call = { method: string;
	url: string;
	body?: unknown; };

/** A canned failure: the next `times` calls matching `method` and `path` answer `status`. */
type Failure = { method: string;
	path: RegExp;
	status: number;
	times: number;
	body?: unknown; };

/** A Hyperdrive config as the stand-in keeps it (the list never returns the password; the stand-in keeps it to check writes). */
type StandInConfig = { id: string;
	name: string;
	origin?: Record<string, unknown>;
	caching?: unknown; };

/** Each branch's own compute host: production's and staging's from the URLs above, any other `ep-<id without br->`. */
function hostOf(branchId: string): string
{
	if (branchId === "br-production") return "ep-production.neon.tech";
	if (branchId === "br-staging") return "ep-staging.neon.tech";
	return `ep-${branchId.replace(/^br-/, "")}.neon.tech`;
}

function uriOf(branchId: string): string
{
	if (branchId === "br-production") return PRODUCTION_URL;
	return `postgres://neondb_owner:s%40cret@${hostOf(branchId)}:5432/neondb?sslmode=require`;
}

/** The id Neon would give a new branch: `br-staging`, `br-preview-<n>` for `preview-pr-<n>`, else `br-<name>`. */
function idFor(name: string): string
{
	const preview = /^preview-pr-(\d+)$/.exec(name);
	return preview ? `br-preview-${preview[1]}` : `br-${name}`;
}

/**
 * An in-memory Cloudflare account and Neon project behind one `fetch`, recording every call. It
 * dispatches on method and path as the real APIs do: Neon writes answer `operations`, polled
 * through `GET /operations/<id>` (each answers the next of `operationStatuses`, then `finished`);
 * `DELETE` removes; every branch has its own compute host and connection string.
 */
function standIns(initial: { branches?: NeonBranch[];
	hyperdrive?: StandInConfig[];
	workers?: string[];
	operationStatuses?: string[];
	failures?: Failure[];
	connectionUri?: (branchId: string) => string; } = {})
{
	const calls: Call[] = [];
	const branches: NeonBranch[] = initial.branches ?? [{
		id: "br-production",
		name: "production",
		default: true,
	}];
	const configs: StandInConfig[] = [...initial.hyperdrive ?? []];
	const workers = new Set(initial.workers ?? []);
	const operationStatuses = [...initial.operationStatuses ?? []];
	const failures = [...initial.failures ?? []];
	const sleeps: number[] = [];
	let operationCount = 0;
	let configCount = 0;
	const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
		status,
	});
	const operations = (action: string, branchId: string) => [{
		id: `op-${++operationCount}`,
		action,
		branch_id: branchId,
		status: "running",
	}];
	const fetch = async (url: string, init: RequestInit = {}) =>
	{
		const method = init.method ?? "GET";
		const body = init.body ? JSON.parse(String(init.body)) : undefined;
		calls.push({
			method,
			url,
			body,
		});
		const { pathname, searchParams } = new URL(url);
		const failure = failures.find((f) => f.times > 0 && f.method === method && f.path.test(pathname));
		if (failure)
		{
			failure.times--;
			return json(failure.body ?? {
				success: false,
				message: `stand-in ${failure.status}`,
			}, failure.status);
		}
		const script = /\/workers\/scripts\/([^/]+)$/.exec(pathname);
		if (script && method === "DELETE")
		{
			if (!workers.delete(decodeURIComponent(script[1]!))) return json({
				success: false,
				errors: [{
					code: 10007,
					message: "workers.api.error.script_not_found",
				}],
			}, 404);
			return json({
				success: true,
				result: null,
			});
		}
		const config = /\/hyperdrive\/configs\/([^/]+)$/.exec(pathname);
		if (config)
		{
			const index = configs.findIndex((c) => c.id === config[1]);
			if (index < 0) return json({
				success: false,
				errors: [{
					code: 2009,
					message: "not found",
				}],
			}, 404);
			if (method === "DELETE")
			{
				configs.splice(index, 1);
				return json({
					success: true,
					result: null,
				});
			}
			configs[index] = {
				id: configs[index]!.id,
				...body,
			};
			return json({
				success: true,
				result: configs[index],
			});
		}
		if (pathname.endsWith("/hyperdrive/configs"))
		{
			if (method === "GET")
			{
				// Paged as Cloudflare pages it (`page`, `per_page`, default 20).
				const perPage = Number(searchParams.get("per_page") ?? 20);
				const page = Number(searchParams.get("page") ?? 1);
				return json({
					success: true,
					result: configs.slice((page - 1) * perPage, page * perPage).map(({ origin, ...rest }) =>
					{
						const { password: _password, ...shown } = origin ?? {};
						return {
							...rest,
							...origin && {
								origin: shown,
							},
						};
					}),
					result_info: {
						page,
						per_page: perPage,
						count: Math.max(0, Math.min(perPage, configs.length - (page - 1) * perPage)),
						total_count: configs.length,
					},
				});
			}
			const created = {
				id: `hd-${++configCount}`,
				...body,
			};
			configs.push(created);
			return json({
				success: true,
				result: created,
			});
		}
		if (pathname.endsWith("/workers/scripts") && method === "GET") return json({
			success: true,
			result: [...workers].map((id) => ({
				id,
			})),
		});
		if (pathname.endsWith("/workers/subdomain")) return json({
			success: true,
			result: {
				subdomain: "bt-owner",
			},
		});
		const operation = /\/operations\/([^/]+)$/.exec(pathname);
		if (operation) return json({
			operation: {
				id: operation[1],
				status: operationStatuses.shift() ?? "finished",
			},
		});
		if (pathname.endsWith("/endpoints")) return json({
			endpoints: branches.map((b) => ({
				host: hostOf(b.id),
				branch_id: b.id,
			})),
		});
		if (pathname.endsWith("/branches") && method === "GET") return json({
			branches,
		});
		if (pathname.endsWith("/branches") && method === "POST")
		{
			const branch: NeonBranch = {
				id: idFor(body.branch.name),
				name: body.branch.name,
				...body.branch.parent_id && {
					parent_id: body.branch.parent_id,
				},
				// Neon takes `schema-only` on create but lists the branch back as `parent-schema`
				// (seen on the first real staging deploy, 2026-11-06), so the stand-in does too.
				init_source: body.branch.init_source === "schema-only" ? "parent-schema" : body.branch.init_source ?? "parent-data",
				current_state: "init",
			};
			branches.push(branch);
			return json({
				branch,
				operations: operations("create_branch", branch.id),
			}, 201);
		}
		const restore = /\/branches\/([^/]+)\/restore$/.exec(pathname);
		if (restore && method === "POST")
		{
			const found = branches.find((b) => b.id === restore[1])!;
			found.current_state = "init";
			return json({
				branch: found,
				operations: operations("restore_branch", found.id),
			});
		}
		const branch = /\/branches\/([^/]+)$/.exec(pathname);
		if (branch && method === "DELETE")
		{
			const index = branches.findIndex((b) => b.id === branch[1]);
			if (index < 0) return json({
				message: "branch not found",
			}, 404);
			const [removed] = branches.splice(index, 1);
			return json({
				branch: removed,
				operations: operations("delete_timeline", removed!.id),
			});
		}
		if (branch)
		{
			const found = branches.find((b) => b.id === branch[1])!;
			// Neon archives an idle child branch; only a write to it (a restore) wakes it.
			if (found.current_state !== "archived") found.current_state = "ready";
			return json({
				branch: found,
			});
		}
		if (pathname.endsWith("/databases")) return json({
			databases: [{
				name: "neondb",
				owner_name: "neondb_owner",
			}],
		});
		if (pathname.endsWith("/connection_uri"))
		{
			const id = searchParams.get("branch_id")!;
			return json({
				uri: (initial.connectionUri ?? uriOf)(id),
			});
		}
		return json({
			success: false,
		}, 404);
	};
	const prepared: string[] = [];
	const deps: BootstrapDeps = {
		cloudflare: {
			accountId: "acct",
			token: "cf-token",
			fetch,
		},
		neon: {
			projectId: "old-sun-72319473",
			apiKey: "neon-key",
			fetch,
			sleep: async (ms) =>
			{
				sleeps.push(ms);
			},
		},
		wrangler: WRANGLER,
		rebase: (path) => `../../${path}`,
		secrets: {
			BT_SESSION_KEY: "from-github",
			LOGTO_S2S_APP_ID: "m2m-from-github",
			LOGTO_S2S_SECRET: "gh-secret",
		},
		prepareCopy: async (url) =>
		{
			prepared.push(url);
			return false;
		},
	};
	const writes = () => calls.filter((call) => call.method !== "GET");
	return {
		deps,
		calls,
		writes,
		prepared,
		configs,
		branches,
		workers,
		sleeps,
	};
}

async function rowsOf(db: PostgresDb, query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]>
{
	return (await db.execute(query) as unknown as { rows: Record<string, unknown>[] }).rows;
}

describe("S114 AC 5: every bootstrapping step finds what exists before creating it", () =>
{
	it("S114 AC 5: the first staging deploy creates the branch and bt-staging; the same deploy again creates nothing", async () =>
	{
		const {
			deps, writes, configs,
		} = standIns();
		const first = await bootstrapDeploy(deps, "staging");
		expect(first.created).toEqual(["Neon branch staging (schema-only)", "Hyperdrive config bt-staging"]);
		const writesAfterFirst = writes().length;
		const second = await bootstrapDeploy(deps, "staging");
		expect(second.created).toEqual([]);
		expect(writes().length).toBe(writesAfterFirst);
		expect(second.hyperdriveId).toBe(first.hyperdriveId);
		expect(second.config).toEqual(first.config);
		expect(configs.map((config) => config.name)).toEqual(["bt-staging"]);
	});

	it("S114 AC 5: production finds bt-production by name (its id resolved at deploy time) and creates it from the default branch only when missing", async () =>
	{
		const owned = standIns({
			hyperdrive: [{
				id: "db27b03ce9734c3f928241ce8ee855f6",
				name: "bt-production",
			}],
		});
		const plan = await bootstrapDeploy(owned.deps, "production");
		expect(plan.hyperdriveId).toBe("db27b03ce9734c3f928241ce8ee855f6");
		expect(plan.config.env!.production!.hyperdrive![0]!.id).toBe("db27b03ce9734c3f928241ce8ee855f6");
		expect(plan.databaseUrl).toBe(PRODUCTION_URL);
		expect(owned.writes()).toEqual([]);
		expect(owned.prepared).toEqual([]);

		const fresh = standIns();
		const created = await bootstrapDeploy(fresh.deps, "production");
		expect(created.created).toEqual(["Hyperdrive config bt-production"]);
		expect(fresh.writes()).toHaveLength(1);
		expect(fresh.writes()[0]!.body).toEqual({
			name: "bt-production",
			origin: {
				scheme: "postgres",
				host: "ep-production.neon.tech",
				port: 5432,
				database: "neondb",
				user: "neondb_owner",
				password: "prod",
			},
		});
		await bootstrapDeploy(fresh.deps, "production");
		expect(fresh.writes()).toHaveLength(1);
	});

	it("S114 AC 5: the generated config keeps wrangler.jsonc's bindings, rebases its paths and drops $schema", () =>
	{
		const config = deployConfig(WRANGLER, "staging", {
			hyperdriveId: "hd-1",
		}, (path) => `../../${path}`);
		expect(config.main).toBe("../../functions/src/worker.ts");
		expect(config.assets?.directory).toBe("../../web/dist");
		expect("$schema" in config).toBe(false);
		expect(config.env!.staging!.hyperdrive![0]!.id).toBe("hd-1");
		// wrangler.jsonc itself is untouched: its ids stay placeholders.
		expect(WRANGLER.env!.staging!.hyperdrive![0]!.id).toMatch(/^0+$/);
		expect(() => deployConfig({}, "staging", {
			hyperdriveId: "x",
		}, (p) => p)).toThrow(/no env.staging/);
		expect(() => deployConfig({
			env: {
				staging: {},
			},
		}, "staging", {
			hyperdriveId: "x",
		}, (p) => p)).toThrow(/no HYPERDRIVE binding/);
	});

	it("S114 AC 5: readying a schema-only copy resets it once, then migrating twice changes nothing (PGlite)", async () =>
	{
		const { db } = await migratedPglite();
		// What a schema-only branch of a migrated production looks like: every table, no rows,
		// Drizzle's record of applied migrations included.
		await db.execute(sql`DELETE FROM drizzle.__drizzle_migrations`);
		expect(await prepareSchemaOnlyCopy(db)).toBe(true);
		const migrate = () => migratePglite(db as Parameters<typeof migratePglite>[0], {
			migrationsFolder: MIGRATIONS_FOLDER,
		});
		await migrate();
		const before = await rowsOf(db, sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
		expect(await prepareSchemaOnlyCopy(db)).toBe(false);
		await migrate();
		expect(await rowsOf(db, sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)).toEqual(before);
		// An empty database (a branch from an unmigrated production) needs nothing.
		const empty = await migratedPglite();
		await empty.db.execute(sql`DROP SCHEMA public CASCADE`);
		await empty.db.execute(sql`CREATE SCHEMA public`);
		await empty.db.execute(sql`DROP SCHEMA drizzle CASCADE`);
		expect(await prepareSchemaOnlyCopy(empty.db)).toBe(false);
	});

	it("S114 AC 5: an API refusal fails the deploy with what was refused", async () =>
	{
		const { deps } = standIns();
		const refusing = {
			...deps,
			cloudflare: {
				...deps.cloudflare,
				fetch: async () => new Response(JSON.stringify({
					success: false,
					errors: [{
						message: "Authentication error",
					}],
				}), {
					status: 403,
				}),
			},
		};
		await expect(bootstrapDeploy(refusing, "staging")).rejects.toThrow(/Cloudflare GET \/hyperdrive\/configs: 403/);
		const neonDown = {
			...deps,
			neon: {
				...deps.neon,
				fetch: async () => new Response("no", {
					status: 500,
				}),
			},
		};
		await expect(bootstrapDeploy(neonDown, "staging")).rejects.toThrow(/Neon GET \/branches: 500 no/);
	});
});

describe("S114 AC 8: Worker secrets from GitHub on every deploy", () =>
{
	it("S114 AC 8: every deploy carries every Worker secret, and a missing one fails it", async () =>
	{
		expect(workerSecrets({
			BT_SESSION_KEY: "k",
			OTHER: "ignored",
		}, "staging")).toEqual({
			BT_SESSION_KEY: "k",
		});
		expect(() => workerSecrets({}, "staging")).toThrow(/missing Worker secrets[^]*BT_SESSION_KEY/);
		const { deps, writes } = standIns();
		// Staging's Worker never gets production's machine-to-machine secret, even from a job that carried it (S116 AC 5).
		expect((await bootstrapDeploy(deps, "staging")).secrets).toEqual({
			BT_SESSION_KEY: "from-github",
		});
		expect((await bootstrapDeploy(deps, "production")).secrets).toEqual({
			BT_SESSION_KEY: "from-github",
			LOGTO_S2S_APP_ID: "m2m-from-github",
			LOGTO_S2S_SECRET: "gh-secret",
		});
		expect(() => workerSecrets({
			BT_SESSION_KEY: "k",
		}, "production")).toThrow(/missing Worker secrets[^]*LOGTO_S2S_APP_ID, LOGTO_S2S_SECRET/);
		const before = writes().length;
		await expect(bootstrapDeploy({
			...deps,
			secrets: {},
		}, "staging")).rejects.toThrow(/BT_SESSION_KEY/);
		expect(writes().length).toBe(before);
	});

	it("S114 AC 8: each deployed env's vars serve live MLB at its own address, with no session key or BT_LOCAL", () =>
	{
		for (const env of ["preview", "staging", "production"] as const)
		{
			const vars = WRANGLER.env![env]!.vars!;
			expect(vars.BT_USE_LIVE_MLB).toBe("1");
			expect(vars).not.toHaveProperty("BT_SESSION_KEY");
			expect(vars).not.toHaveProperty("BT_LOCAL");
		}
		expect(WRANGLER.env!.staging!.vars!.BT_APP_ORIGIN).toBe("https://stage.baseball.theater");
		// Production serves next.baseball.theater until the owner cuts baseball.theater over from Elastic Beanstalk (S119).
		expect(WRANGLER.env!.production!.vars!.BT_APP_ORIGIN).toBe("https://next.baseball.theater");
	});
});

describe("S114 AC 9: the staging branch never holds a fan's data", () =>
{
	it("S114 AC 9: staging is created schema-only from production's branch, never as a plain branch", async () =>
	{
		const { deps, writes } = standIns();
		const { value, created } = await findOrCreateBranch(deps.neon, "staging");
		expect(created).toBe(true);
		expect(value.current_state).toBe("ready");
		const create = writes().find((call) => call.url.endsWith("/branches"))!;
		expect(create.body).toEqual({
			branch: {
				name: "staging",
				parent_id: "br-production",
				init_source: "schema-only",
			},
			endpoints: [{
				type: "read_write",
			}],
		});
		expect(writes()).toHaveLength(1);
	});

	it("S114 AC 9: a staging branch that copied production's data is refused, and production is never readied as a copy", async () =>
	{
		const plain = standIns({
			branches: [{
				id: "br-production",
				name: "production",
				default: true,
			}, {
				id: "br-staging",
				name: "staging",
				init_source: "parent-data",
			}],
		});
		await expect(bootstrapDeploy(plain.deps, "staging")).rejects.toThrow(/copy of production's data/);
		expect(plain.writes()).toEqual([]);
		const isProduction = standIns({
			branches: [{
				id: "br-production",
				name: "staging",
				default: true,
			}],
		});
		await expect(findOrCreateBranch(isProduction.deps.neon, "staging")).rejects.toThrow(/copy of production's data/);
		await expect(findOrCreateBranch(standIns({
			branches: [],
		}).deps.neon, "staging")).rejects.toThrow(/no default \(production\) branch/);
		const production = standIns();
		await bootstrapDeploy(production.deps, "production");
		expect(production.prepared).toEqual([]);
	});

	it("S114 AC 9: a new branch still initialising is waited for, and one that never readies fails", async () =>
	{
		const { deps } = standIns();
		let polls = 0;
		const stuck = {
			...deps.neon,
			fetch: async (url: string, init?: RequestInit) =>
			{
				if (/\/branches\/br-staging$/.test(new URL(url).pathname))
				{
					polls++;
					return new Response(JSON.stringify({
						branch: {
							id: "br-staging",
							name: "staging",
							current_state: "init",
						},
					}));
				}
				return deps.neon.fetch(url, init);
			},
		};
		await expect(findOrCreateBranch(stuck, "staging")).rejects.toThrow(/still init/);
		expect(polls).toBe(30);
	});
});

/** Production plus the schema-only staging branch a staging deploy made (a root branch: no parent). */
function withStaging(extra: NeonBranch[] = []): NeonBranch[]
{
	return [{
		id: "br-production",
		name: "production",
		default: true,
	}, {
		id: "br-staging",
		name: "staging",
		init_source: "parent-schema",
		current_state: "ready",
	}, ...extra];
}

const PREVIEW_HOST = "ep-preview-42.neon.tech";

/** Whether a call writes to staging's or production's branch or names their Hyperdrive configs. */
function touchesSharedDatabase(call: Call): boolean
{
	const { pathname } = new URL(call.url);
	const sharedConfig = /bt-(staging|production)/;
	return /\/branches\/br-(staging|production)(\/|$)/.test(pathname) || sharedConfig.test(call.url) || sharedConfig.test(JSON.stringify(call.body ?? {}));
}

describe("issue #42: each preview on its own Neon branch", () =>
{
	it("issue #42: a preview creates preview-pr-<N> from staging and bt-preview-pr-<N> on it, and never writes staging or production", async () =>
	{
		const {
			deps, writes, prepared, configs, branches,
		} = standIns({
			branches: withStaging(),
		});
		const plan = await bootstrapDeploy(deps, "preview", 42);
		expect(previewBranchName(42)).toBe("preview-pr-42");
		expect(previewHyperdriveName(42)).toBe("bt-preview-pr-42");
		const create = writes().find((call) => call.method === "POST" && new URL(call.url).pathname.endsWith("/branches"))!;
		// A plain (copy-on-write) child of staging: no init_source, so not schema-only and never from production.
		expect(create.body).toEqual({
			branch: {
				name: "preview-pr-42",
				parent_id: "br-staging",
			},
			endpoints: [{
				type: "read_write",
			}],
		});
		expect(branches.find((b) => b.name === "preview-pr-42")?.parent_id).toBe("br-staging");
		expect(new URL(plan.databaseUrl).hostname).toBe(PREVIEW_HOST);
		expect(prepared.map((url) => new URL(url).hostname)).toEqual([PREVIEW_HOST]);
		expect(configs).toEqual([{
			id: plan.hyperdriveId,
			name: "bt-preview-pr-42",
			origin: {
				scheme: "postgres",
				host: PREVIEW_HOST,
				port: 5432,
				database: "neondb",
				user: "neondb_owner",
				password: "s@cret",
			},
			caching: {
				disabled: true,
			},
		}]);
		expect(plan.created).toEqual(["Neon branch preview-pr-42 (from staging)", "Hyperdrive config bt-preview-pr-42"]);
		expect(plan.workerName).toBe(previewWorkerName(42));
		expect(plan.appOrigin).toBe("https://baseball-theater-pr-42.bt-owner.workers.dev");
		const block = plan.config.env!.preview!;
		expect(block.name).toBe("baseball-theater-pr-42");
		expect(block.vars?.BT_APP_ORIGIN).toBe(plan.appOrigin);
		expect(block.hyperdrive).toEqual([{
			binding: "HYPERDRIVE",
			id: plan.hyperdriveId,
		}]);
		expect(writes().filter(touchesSharedDatabase)).toEqual([]);
		expect(HYPERDRIVE_CONFIG).toEqual({
			staging: "bt-staging",
			production: "bt-production",
		});
	});

	it("issue #42: the first preview of a project with no staging branch makes staging schema-only first, then its own branch", async () =>
	{
		const { deps, prepared } = standIns();
		const plan = await bootstrapDeploy(deps, "preview", 42);
		expect(plan.created).toEqual(["Neon branch staging (schema-only)", "Neon branch preview-pr-42 (from staging)", "Hyperdrive config bt-preview-pr-42"]);
		expect(prepared.map((url) => new URL(url).hostname)).toEqual([PREVIEW_HOST]);
	});

	it("issue #42: a second deploy makes nothing new, resets the branch from staging, and rewrites the config's whole origin", async () =>
	{
		const {
			deps, writes, configs, calls,
		} = standIns({
			branches: withStaging(),
		});
		const first = await bootstrapDeploy(deps, "preview", 42);
		const before = writes().length;
		const callsBefore = calls.length;
		const second = await bootstrapDeploy(deps, "preview", 42);
		const newWrites = writes().slice(before);
		expect(newWrites.map((call) => `${call.method} ${new URL(call.url).pathname.replace(/^.*\/(branches|hyperdrive)/, "/$1")}`)).toEqual([
			"POST /branches/br-preview-42/restore",
			`PUT /hyperdrive/configs/${first.hyperdriveId}`,
		]);
		expect(newWrites[0]!.body).toEqual({
			source_branch_id: "br-staging",
		});
		expect(newWrites[1]!.body).toMatchObject({
			name: "bt-preview-pr-42",
			origin: {
				host: PREVIEW_HOST,
				password: "s@cret",
			},
			caching: {
				disabled: true,
			},
		});
		// The restore's operation is waited for before anything connects.
		expect(calls.slice(callsBefore).some((call) => /\/operations\/op-\d+$/.test(call.url))).toBe(true);
		expect(second.created).toEqual(["reset preview-pr-42 from staging"]);
		expect(second.hyperdriveId).toBe(first.hyperdriveId);
		expect(second.config).toEqual(first.config);
		expect(configs.map((c) => c.name)).toEqual(["bt-preview-pr-42"]);
		expect(writes().filter(touchesSharedDatabase)).toEqual([]);
	});

	it("issue #42: a connection string whose host isn't the preview branch's own endpoint is refused before anything uses it", async () =>
	{
		const {
			deps, prepared, configs,
		} = standIns({
			branches: withStaging(),
			connectionUri: (id) => uriOf(id === "br-preview-42" ? "br-staging" : id),
		});
		await expect(bootstrapDeploy(deps, "preview", 42)).rejects.toThrow(/not the preview branch's/);
		expect(prepared).toEqual([]);
		expect(configs).toEqual([]);
	});

	it("issue #42: Neon operations are waited for, and a failed or cancelled one fails the deploy", async () =>
	{
		const waited = standIns({
			branches: withStaging(),
			operationStatuses: ["running", "running", "finished"],
		});
		await bootstrapDeploy(waited.deps, "preview", 42);
		expect(waited.calls.filter((call) => /\/operations\//.test(call.url))).toHaveLength(3);
		for (const status of ["failed", "error", "cancelled"])
		{
			const failing = standIns({
				branches: withStaging(),
				operationStatuses: [status],
			});
			await expect(bootstrapDeploy(failing.deps, "preview", 42)).rejects.toThrow(new RegExp(`create_branch[^]*${status}`));
			expect(failing.configs).toEqual([]);
		}
	});

	it("issue #42: an existing branch still busy is waited for before it is reset", async () =>
	{
		const { deps, calls } = standIns({
			branches: withStaging([{
				id: "br-preview-42",
				name: "preview-pr-42",
				parent_id: "br-staging",
				init_source: "parent-data",
				current_state: "init",
			}]),
		});
		await bootstrapDeploy(deps, "preview", 42);
		const poll = calls.findIndex((call) => call.method === "GET" && new URL(call.url).pathname.endsWith("/branches/br-preview-42"));
		const restore = calls.findIndex((call) => call.url.endsWith("/branches/br-preview-42/restore"));
		expect(poll).toBeGreaterThanOrEqual(0);
		expect(poll).toBeLessThan(restore);
	});

	it("issue #42: Neon's 423 Locked is retried with a capped backoff on create, restore and delete; a lasting lock says so, not the limit", async () =>
	{
		const created = standIns({
			branches: withStaging(),
			failures: [{
				method: "POST",
				path: /\/branches$/,
				status: 423,
				times: 2,
			}],
		});
		await bootstrapDeploy(created.deps, "preview", 42);
		expect(created.sleeps.slice(0, 2)).toEqual([1_000, 2_000]);

		const reset = standIns({
			branches: withStaging(),
		});
		await bootstrapDeploy(reset.deps, "preview", 42);
		const restoreLocked = standIns({
			branches: reset.branches,
			hyperdrive: reset.configs,
			failures: [{
				method: "POST",
				path: /\/restore$/,
				status: 423,
				times: 2,
			}],
		});
		expect((await bootstrapDeploy(restoreLocked.deps, "preview", 42)).created).toEqual(["reset preview-pr-42 from staging"]);

		const deleteLocked = standIns({
			branches: reset.branches,
			hyperdrive: reset.configs,
			failures: [{
				method: "DELETE",
				path: /\/branches\/br-preview-42$/,
				status: 423,
				times: 2,
			}],
		});
		await teardownPreview(deleteLocked.deps, 42);
		expect(deleteLocked.branches.map((b) => b.name)).toEqual(["production", "staging"]);

		const locked = standIns({
			branches: withStaging(),
			failures: [{
				method: "POST",
				path: /\/branches$/,
				status: 423,
				times: 1_000,
			}],
		});
		const error = await bootstrapDeploy(locked.deps, "preview", 42).catch((e: Error) => e);
		expect(String(error)).toMatch(/423/);
		expect(String(error)).toMatch(/locked/i);
		expect(String(error)).not.toMatch(/limit/);
		expect(Math.max(...locked.sleeps)).toBeLessThanOrEqual(8_000);
		expect(locked.sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(70_000);
	});

	it("issue #42: hitting Neon's branch limit or Hyperdrive's config limit fails with a message that says so", async () =>
	{
		const neonFull = standIns({
			branches: withStaging(),
			failures: [{
				method: "POST",
				path: /\/branches$/,
				status: 422,
				times: 1,
				body: {
					message: "branches limit exceeded",
				},
			}],
		});
		await expect(bootstrapDeploy(neonFull.deps, "preview", 42)).rejects.toThrow(/preview-pr-42[^]*422[^]*branch limit/);
		const hyperdriveFull = standIns({
			branches: withStaging(),
			failures: [{
				method: "POST",
				path: /\/hyperdrive\/configs$/,
				status: 400,
				times: 1,
				body: {
					success: false,
					errors: [{
						code: 2017,
						message: "too many configs",
					}],
				},
			}],
		});
		await expect(bootstrapDeploy(hyperdriveFull.deps, "preview", 42)).rejects.toThrow(/bt-preview-pr-42[^]*Hyperdrive config limit/);
	});

	it("issue #42: a preview is refused on a staging that copied production, a preview-pr-<N> not made from staging, a duplicate name, or a bad pull request number", async () =>
	{
		const copied = standIns({
			branches: [{
				id: "br-production",
				name: "production",
				default: true,
			}, {
				id: "br-staging",
				name: "staging",
				init_source: "parent-data",
			}],
		});
		await expect(bootstrapDeploy(copied.deps, "preview", 42)).rejects.toThrow(/copy of production's data/);
		expect(copied.writes()).toEqual([]);
		const wrongParent = standIns({
			branches: withStaging([{
				id: "br-preview-42",
				name: "preview-pr-42",
				parent_id: "br-production",
			}]),
		});
		await expect(bootstrapDeploy(wrongParent.deps, "preview", 42)).rejects.toThrow(/not a branch of staging/);
		expect(wrongParent.writes()).toEqual([]);
		const duplicate = standIns({
			branches: withStaging([{
				id: "br-preview-42",
				name: "preview-pr-42",
				parent_id: "br-staging",
			}, {
				id: "br-preview-42b",
				name: "preview-pr-42",
				parent_id: "br-staging",
			}]),
		});
		await expect(bootstrapDeploy(duplicate.deps, "preview", 42)).rejects.toThrow(/2 Neon branches named preview-pr-42/);
		expect(duplicate.writes()).toEqual([]);
		for (const bad of [0, -1, 1.5, Number.NaN])
		{
			await expect(bootstrapDeploy(copied.deps, "preview", bad)).rejects.toThrow(/pull request/);
		}
		await expect(bootstrapDeploy(copied.deps, "preview")).rejects.toThrow(/names its pull request/);
		expect(parsePullRequest("42")).toBe(42);
		for (const bad of [undefined, "", "abc", "1e3", "07", "-3", "1.5", "0", "42abc"])
		{
			expect(() => parsePullRequest(bad)).toThrow(/positive whole number/);
		}
	});

	it("issue #42: teardown deletes the preview's Worker, Hyperdrive config and branch only, and a second teardown finds nothing to do", async () =>
	{
		const world = standIns({
			branches: withStaging([{
				id: "br-preview-42",
				name: "preview-pr-42",
				parent_id: "br-staging",
			}, {
				id: "br-preview-43",
				name: "preview-pr-43",
				parent_id: "br-staging",
			}]),
			hyperdrive: [{
				id: "hd-staging",
				name: "bt-staging",
			}, {
				id: "hd-42",
				name: "bt-preview-pr-42",
			}, {
				id: "hd-other",
				name: "bt-preview-pr-43",
			}],
			workers: ["baseball-theater-pr-42", "baseball-theater-pr-43", "baseball-theater-staging"],
		});
		expect(await teardownPreview(world.deps, 42)).toEqual(["Worker baseball-theater-pr-42", "Hyperdrive config bt-preview-pr-42", "Neon branch preview-pr-42"]);
		expect(world.branches.map((b) => b.name)).toEqual(["production", "staging", "preview-pr-43"]);
		expect(world.configs.map((c) => c.name)).toEqual(["bt-staging", "bt-preview-pr-43"]);
		expect([...world.workers]).toEqual(["baseball-theater-pr-43", "baseball-theater-staging"]);
		// The delete's operation is waited for.
		expect(world.calls.some((call) => /\/operations\//.test(call.url))).toBe(true);
		const writes = world.writes().length;
		expect(await teardownPreview(world.deps, 42)).toEqual([]);
		expect(world.writes().length).toBe(writes + 1); // only the Worker delete, answered "not found"
		expect(world.writes().filter(touchesSharedDatabase)).toEqual([]);
	});

	it("issue #42: teardown refuses a branch it didn't make, a duplicate, a bad number, and fails on an API error", async () =>
	{
		const wrongParent = standIns({
			branches: withStaging([{
				id: "br-preview-42",
				name: "preview-pr-42",
				parent_id: "br-production",
			}]),
		});
		await expect(teardownPreview(wrongParent.deps, 42)).rejects.toThrow(/not a branch of staging/);
		expect(wrongParent.branches).toHaveLength(3);
		const duplicate = standIns({
			branches: withStaging(),
			hyperdrive: [{
				id: "a",
				name: "bt-preview-pr-42",
			}, {
				id: "b",
				name: "bt-preview-pr-42",
			}],
		});
		await expect(teardownPreview(duplicate.deps, 42)).rejects.toThrow(/2 Hyperdrive configs named bt-preview-pr-42/);
		expect(duplicate.configs).toHaveLength(2);
		await expect(teardownPreview(duplicate.deps, 0)).rejects.toThrow(/pull request/);
		const down = standIns({
			branches: withStaging(),
			failures: [{
				method: "GET",
				path: /\/branches$/,
				status: 500,
				times: 1,
			}],
		});
		await expect(teardownPreview(down.deps, 42)).rejects.toThrow(/Neon GET \/branches: 500/);
		const workerRefused = standIns({
			branches: withStaging(),
			failures: [{
				method: "DELETE",
				path: /\/workers\/scripts\//,
				status: 403,
				times: 1,
				body: {
					success: false,
					errors: [{
						code: 10000,
						message: "Authentication error",
					}],
				},
			}],
		});
		await expect(teardownPreview(workerRefused.deps, 42)).rejects.toThrow(/Cloudflare DELETE[^]*403/);
	});

	it("issue #42: the weekly cleanup tears down only closed pull requests' previews, never an open one, and fails at the end for one it couldn't check", async () =>
	{
		const world = standIns({
			branches: withStaging([1, 2, 3].map((n) => ({
				id: `br-preview-${n}`,
				name: `preview-pr-${n}`,
				parent_id: "br-staging",
			}))),
			hyperdrive: [{
				id: "hd-staging",
				name: "bt-staging",
			}, {
				id: "hd-1",
				name: "bt-preview-pr-1",
			}, {
				id: "hd-2",
				name: "bt-preview-pr-2",
			}, {
				id: "hd-4",
				name: "bt-preview-pr-4",
			}],
			workers: ["baseball-theater-pr-1", "baseball-theater-pr-2"],
		});
		const asked: number[] = [];
		const result = await cleanupPreviews(world.deps, async (pr) =>
		{
			asked.push(pr);
			if (pr === 3) throw new Error("GitHub said 502");
			return pr === 2 ? "open" : "closed";
		});
		// Each closed one is asked about twice: to decide, then again right before the first delete.
		expect(asked).toEqual([1, 1, 2, 3, 4, 4]);
		expect(result.tornDown).toEqual([1, 4]);
		expect(result.kept).toEqual([2]);
		expect(result.failed).toEqual([{
			pullRequest: 3,
			error: "GitHub said 502",
		}]);
		expect(world.branches.map((b) => b.name)).toEqual(["production", "staging", "preview-pr-2", "preview-pr-3"]);
		expect(world.configs.map((c) => c.name)).toEqual(["bt-staging", "bt-preview-pr-2"]);
		expect([...world.workers]).toEqual(["baseball-theater-pr-2"]);
		expect(world.writes().filter(touchesSharedDatabase)).toEqual([]);
		// Nothing to clean: no calls to GitHub at all.
		const empty = standIns({
			branches: withStaging(),
		});
		expect(await cleanupPreviews(empty.deps, async () =>
		{
			throw new Error("not asked");
		})).toEqual({
			tornDown: [],
			kept: [],
			failed: [],
		});
	});
});

/** An existing preview branch of staging, in `state`. */
function previewBranch(state = "ready"): NeonBranch
{
	return {
		id: "br-preview-42",
		name: "preview-pr-42",
		parent_id: "br-staging",
		init_source: "parent-data",
		current_state: state,
	};
}

describe("issue #42: previews survive Neon's and Cloudflare's edge cases", () =>
{
	it("issue #42: an archived preview branch (idle two weeks) is reset, which wakes it, instead of waited on forever", async () =>
	{
		const {
			deps, writes, branches,
		} = standIns({
			branches: withStaging([previewBranch("archived")]),
		});
		const plan = await bootstrapDeploy(deps, "preview", 42);
		expect(plan.created).toContain("reset preview-pr-42 from staging");
		expect(writes().some((call) => call.url.endsWith("/branches/br-preview-42/restore"))).toBe(true);
		expect(branches.find((b) => b.id === "br-preview-42")?.current_state).toBe("ready");
	});

	it("issue #42: after a reset the branch is read again and waited for, not taken from the list before it", async () =>
	{
		const { deps, calls } = standIns({
			branches: withStaging([previewBranch()]),
		});
		await bootstrapDeploy(deps, "preview", 42);
		const restore = calls.findIndex((call) => call.url.endsWith("/branches/br-preview-42/restore"));
		const reread = calls.findIndex((call, i) => i > restore && call.method === "GET" && new URL(call.url).pathname.endsWith("/branches/br-preview-42"));
		expect(restore).toBeGreaterThanOrEqual(0);
		expect(reread).toBeGreaterThan(restore);
		const connect = calls.findIndex((call) => call.url.includes("/connection_uri"));
		expect(connect).toBeGreaterThan(reread);
	});

	it("issue #42: an operation still running after the wait's cap fails the deploy", async () =>
	{
		const { deps, configs } = standIns({
			branches: withStaging(),
			operationStatuses: Array.from({
				length: 61,
			}, () => "running"),
		});
		await expect(bootstrapDeploy(deps, "preview", 42)).rejects.toThrow(/create_branch[^]*still running/);
		expect(configs).toEqual([]);
	});

	it("issue #42: a write answering no operations at all goes straight on", async () =>
	{
		const { deps } = standIns({
			branches: withStaging([previewBranch()]),
		});
		const empty = {
			...deps,
			neon: {
				...deps.neon,
				fetch: async (url: string, init?: RequestInit) =>
				{
					const response = await deps.neon.fetch(url, init);
					if (!url.endsWith("/restore")) return response;
					const body = await response.json() as Record<string, unknown>;
					return new Response(JSON.stringify({
						...body,
						operations: [],
					}));
				},
			},
		};
		expect((await bootstrapDeploy(empty, "preview", 42)).created).toContain("reset preview-pr-42 from staging");
	});

	it("issue #42: a connection string that could reach another host (?host=, &hostaddr=, Neon's endpoint option, any extra parameter) is refused", async () =>
	{
		const preview = uriOf("br-preview-42");
		const staging = uriOf("br-staging");
		for (const uri of [
			`${preview}&host=ep-staging.neon.tech`,
			`${staging.replace("ep-staging", "ep-preview-42")}&hostaddr=10.0.0.1`,
			`${preview}&options=endpoint%3Dep-staging`,
			`${preview}&application_name=x`,
		])
		{
			const {
				deps, prepared, configs,
			} = standIns({
				branches: withStaging(),
				connectionUri: (id) => id === "br-preview-42" ? uri : uriOf(id),
			});
			await expect(bootstrapDeploy(deps, "preview", 42), uri).rejects.toThrow(/not the preview branch's/);
			expect(prepared).toEqual([]);
			expect(configs).toEqual([]);
		}
		// What Neon actually answers passes, channel_binding included.
		const fine = standIns({
			branches: withStaging(),
			connectionUri: (id) => `${uriOf(id)}&channel_binding=require`,
		});
		await bootstrapDeploy(fine.deps, "preview", 42);
		expect(fine.prepared).toHaveLength(1);
		// A staging URI whose ?host= names the preview's endpoint is refused too.
		const disguised = standIns({
			branches: withStaging(),
			connectionUri: (id) => id === "br-preview-42" ? `${staging}&host=${PREVIEW_HOST}` : uriOf(id),
		});
		await expect(bootstrapDeploy(disguised.deps, "preview", 42)).rejects.toThrow(/not the preview branch's/);
		expect(disguised.prepared).toEqual([]);
	});

	it("issue #42: finds a preview's Hyperdrive config past the first page of the list", async () =>
	{
		const many = Array.from({
			length: 150,
		}, (_, i) => ({
			id: `hd-other-${i}`,
			name: `other-${i}`,
		}));
		const { deps, configs } = standIns({
			branches: withStaging(),
			hyperdrive: [...many, {
				id: "hd-42",
				name: "bt-preview-pr-42",
			}],
		});
		const plan = await bootstrapDeploy(deps, "preview", 42);
		expect(plan.hyperdriveId).toBe("hd-42");
		expect(configs).toHaveLength(151);
		const teardown = await teardownPreview(deps, 42);
		expect(teardown).toContain("Hyperdrive config bt-preview-pr-42");
	});

	it("issue #42: teardown deletes the Worker, then the config, then the branch, and one already deleted by a racing run is fine", async () =>
	{
		const { deps, writes } = standIns({
			branches: withStaging([previewBranch()]),
			hyperdrive: [{
				id: "hd-42",
				name: "bt-preview-pr-42",
			}],
			workers: ["baseball-theater-pr-42"],
			failures: [{
				method: "DELETE",
				path: /\/hyperdrive\/configs\/hd-42$/,
				status: 404,
				times: 1,
				body: {
					success: false,
					errors: [{
						code: 2009,
						message: "not found",
					}],
				},
			}, {
				method: "DELETE",
				path: /\/branches\/br-preview-42$/,
				status: 404,
				times: 1,
				body: {
					message: "branch not found",
				},
			}],
		});
		await teardownPreview(deps, 42);
		const order = writes().map((call) => new URL(call.url).pathname.replace(/^.*\/(workers|hyperdrive|branches)/, "/$1"));
		expect(order).toEqual(["/workers/scripts/baseball-theater-pr-42", "/hyperdrive/configs/hd-42", "/branches/br-preview-42"]);
	});

	it("issue #42: a limit hint only when the refusal is a limit; any other refusal is passed on as it is", async () =>
	{
		const neonDown = standIns({
			branches: withStaging(),
			failures: [{
				method: "POST",
				path: /\/branches$/,
				status: 500,
				times: 1,
				body: {
					message: "internal",
				},
			}],
		});
		const neonError = String(await bootstrapDeploy(neonDown.deps, "preview", 42).catch((e: Error) => e));
		expect(neonError).toMatch(/500/);
		expect(neonError).not.toMatch(/limit/);
		const forbidden = standIns({
			branches: withStaging(),
			failures: [{
				method: "POST",
				path: /\/branches$/,
				status: 403,
				times: 1,
				body: {
					message: "projects branches limit exceeded",
				},
			}],
		});
		await expect(bootstrapDeploy(forbidden.deps, "preview", 42)).rejects.toThrow(/branch limit/);
		const cloudflareDown = standIns({
			branches: withStaging(),
			failures: [{
				method: "POST",
				path: /\/hyperdrive\/configs$/,
				status: 500,
				times: 1,
				body: {
					success: false,
					errors: [{
						code: 1000,
						message: "internal error",
					}],
				},
			}],
		});
		const cloudflareError = String(await bootstrapDeploy(cloudflareDown.deps, "preview", 42).catch((e: Error) => e));
		expect(cloudflareError).toMatch(/500/);
		expect(cloudflareError).not.toMatch(/limit/);
	});

	it("issue #42: Neon reads are not retried on 423, only writes", async () =>
	{
		const { deps, sleeps } = standIns({
			branches: withStaging(),
			failures: [{
				method: "GET",
				path: /\/branches$/,
				status: 423,
				times: 1,
			}],
		});
		await expect(bootstrapDeploy(deps, "preview", 42)).rejects.toThrow(/Neon GET \/branches: 423/);
		expect(sleeps).toEqual([]);
	});

	it("issue #42: the cleanup sweeps a stray Worker, leaves look-alike names alone, and counts a state other than closed as a failure", async () =>
	{
		const world = standIns({
			branches: withStaging([{
				id: "br-preview-5",
				name: "preview-pr-5",
				parent_id: "br-staging",
			}, {
				id: "br-manual",
				name: "preview-pr-7-manual",
				parent_id: "br-staging",
			}]),
			hyperdrive: [{
				id: "hd-x",
				name: "xbt-preview-pr-8",
			}],
			workers: ["baseball-theater-pr-9", "baseball-theater-pr-9-old", "baseball-theater-staging"],
		});
		const asked: number[] = [];
		const result = await cleanupPreviews(world.deps, async (pr) =>
		{
			asked.push(pr);
			return pr === 5 ? "merged" : "closed";
		});
		expect(asked).toEqual([5, 9, 9]);
		expect(result.tornDown).toEqual([9]);
		expect(result.failed).toEqual([{
			pullRequest: 5,
			error: "GitHub says the pull request is \"merged\"",
		}]);
		expect(world.branches.map((b) => b.name)).toEqual(["production", "staging", "preview-pr-5", "preview-pr-7-manual"]);
		expect(world.configs.map((c) => c.name)).toEqual(["xbt-preview-pr-8"]);
		expect([...world.workers]).toEqual(["baseball-theater-pr-9-old", "baseball-theater-staging"]);
	});

	it("issue #42: the cleanup leaves a preview alone when its pull request reopens between the check and the first delete", async () =>
	{
		const world = standIns({
			branches: withStaging([{
				id: "br-preview-6",
				name: "preview-pr-6",
				parent_id: "br-staging",
			}]),
			workers: ["baseball-theater-pr-6"],
		});
		const answers = ["closed", "open"];
		const result = await cleanupPreviews(world.deps, async () => answers.shift()!);
		// Reopened is the open case, not a failure: the weekly run stays green.
		expect(result).toEqual({
			tornDown: [],
			kept: [6],
			failed: [],
		});
		expect(world.branches.map((b) => b.name)).toContain("preview-pr-6");
		expect([...world.workers]).toEqual(["baseball-theater-pr-6"]);
		expect(world.writes()).toEqual([]);
	});
});
