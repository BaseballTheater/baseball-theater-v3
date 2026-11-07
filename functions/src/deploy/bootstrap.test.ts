/**
 * S114: the deploy's bootstrapping against stand-ins for the Cloudflare and Neon APIs (an
 * in-memory account and project behind a `fetch`) and PGlite. Nothing here reaches a hosted
 * service. The point is idempotence (AC 5): a second deploy finds what the first created.
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
	bootstrapDeploy, deployConfig, findOrCreateBranch, HYPERDRIVE_CONFIG, parseWranglerConfig, prepareSchemaOnlyCopy, previewWorkerName, workerSecrets,
} from "./bootstrap.js";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";

const WRANGLER = parseWranglerConfig(readFileSync(new URL("../../../wrangler.jsonc", import.meta.url), "utf8"));
const STAGING_URL = "postgres://neondb_owner:s%40cret@ep-staging.neon.tech:5432/neondb?sslmode=require";
const PRODUCTION_URL = "postgres://neondb_owner:prod@ep-production.neon.tech/neondb?sslmode=require";

type Call = { method: string;
	url: string;
	body?: unknown; };

/** An in-memory Cloudflare account and Neon project behind one `fetch`, recording every call. */
function standIns(initial: { branches?: NeonBranch[];
	hyperdrive?: { id: string;
		name: string; }[]; } = {})
{
	const calls: Call[] = [];
	const branches: NeonBranch[] = initial.branches ?? [{
		id: "br-production",
		name: "production",
		default: true,
	}];
	const configs = [...initial.hyperdrive ?? []];
	const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
		status,
	});
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
		if (pathname.endsWith("/hyperdrive/configs"))
		{
			if (method === "GET") return json({
				success: true,
				result: configs,
			});
			const config = {
				id: `hd-${configs.length + 1}`,
				name: body.name,
			};
			configs.push(config);
			return json({
				success: true,
				result: config,
			});
		}
		if (pathname.endsWith("/workers/subdomain")) return json({
			success: true,
			result: {
				subdomain: "bt-owner",
			},
		});
		if (pathname.endsWith("/branches") && method === "GET") return json({
			branches,
		});
		if (pathname.endsWith("/branches") && method === "POST")
		{
			const branch: NeonBranch = {
				id: "br-staging",
				name: body.branch.name,
				// Neon takes `schema-only` on create but lists the branch back as `parent-schema`
				// (seen on the first real staging deploy, 2026-11-06), so the stand-in does too.
				init_source: body.branch.init_source === "schema-only" ? "parent-schema" : body.branch.init_source,
				current_state: "init",
			};
			branches.push(branch);
			return json({
				branch,
			}, 201);
		}
		const branch = /\/branches\/([^/]+)$/.exec(pathname);
		if (branch)
		{
			const found = branches.find((b) => b.id === branch[1])!;
			found.current_state = "ready";
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
		if (pathname.endsWith("/connection_uri")) return json({
			uri: searchParams.get("branch_id") === "br-production" ? PRODUCTION_URL : STAGING_URL,
		});
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
			sleep: async () =>
			{},
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
	};
}

async function rowsOf(db: PostgresDb, query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]>
{
	return (await db.execute(query) as unknown as { rows: Record<string, unknown>[] }).rows;
}

describe("S114 AC 1: a preview per pull request on staging's database", () =>
{
	it("S114 AC 1: binds bt-staging over the staging branch, names its own Worker and address, never production", async () =>
	{
		const { deps, calls } = standIns();
		const plan = await bootstrapDeploy(deps, "preview", 42);
		expect(HYPERDRIVE_CONFIG.preview).toBe("bt-staging");
		expect(plan.databaseUrl).toBe(STAGING_URL);
		expect(plan.workerName).toBe(previewWorkerName(42));
		expect(plan.appOrigin).toBe("https://baseball-theater-pr-42.bt-owner.workers.dev");
		const block = plan.config.env!.preview!;
		expect(block.name).toBe("baseball-theater-pr-42");
		expect(block.vars?.BT_APP_ORIGIN).toBe(plan.appOrigin);
		expect(block.hyperdrive).toEqual([{
			binding: "HYPERDRIVE",
			id: plan.hyperdriveId,
		}]);
		expect(calls.some((call) => call.url.includes("br-production") || JSON.stringify(call.body ?? {}).includes("bt-production"))).toBe(false);
		await expect(bootstrapDeploy(deps, "preview")).rejects.toThrow(/names its pull request/);
	});
});

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
		// A preview after staging reuses both.
		expect((await bootstrapDeploy(deps, "preview", 7)).created).toEqual([]);
		expect(writes().length).toBe(writesAfterFirst);
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
