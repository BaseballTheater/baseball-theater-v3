/**
 * S51 AC 3: the composition `pnpm dev` runs, on Postgres — here PGlite with the committed
 * migrations — serving the API and keeping what it serves in Postgres tables, accounts and
 * settings included. The Worker builds the same composition on `scopedDatabase`, which this
 * also exercises through `inDatabaseScope`.
 */
import { DEFAULT_SETTINGS } from "@bt/domain";
import { sql } from "drizzle-orm";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import {
	inDatabaseScope, scopedDatabase, withDatabase,
} from "./adapters/postgres/connect.js";
import { migratedPglite } from "./adapters/postgres/migrate.js";
import type { PostgresDb } from "./adapters/postgres/repos.js";
import { handleApiRequest } from "./handlers/api.js";
import { getOrRefreshGame, getOrRefreshSchedule } from "./services/ingest.js";
import { loadDevSeed, recordDevSeed } from "./services/dev-seed.js";
import { recordedClient } from "./test/recorded-mlb.js";
import { createManagementStandIn } from "./test/logto-management.js";
import {
	createTestTenant, TEST_LOGTO_APP_ID, TEST_LOGTO_ENDPOINT,
} from "./test/logto-tokens.js";
import type { WorkerEnv } from "./worker-app.js";
import { createWorkerApp, logtoAdmin } from "./worker-app.js";

async function count(db: PostgresDb, table: string): Promise<number>
{
	const result = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`));
	return (result as unknown as { rows: { n: number }[] }).rows[0]!.n;
}

describe("the Worker composition on Postgres (S51)", () =>
{
	it("PGlite: serves the schedule, a game and a signed-in account, and stores them in Postgres", async () =>
	{
		const { db } = await migratedPglite();
		// Local dev's composition: `dev:` sign-in is wired only there (S114 AC 7).
		const app = createWorkerApp({
			BT_LOCAL: "1",
		}, db);
		const get = (path: string, headers: Record<string, string> = {}) => handleApiRequest(new Request(`http://bt.test${path}`, {
			headers,
		}), app.context);

		expect((await get("/api/v1/schedule?date=2024-07-04")).status).toBe(200);
		expect((await get("/api/v1/games/744834")).status).toBe(200);
		const signedIn = {
			Authorization: "Bearer dev:test-user",
		};
		expect((await get("/api/v1/me", signedIn)).status).toBe(200);
		const put = await handleApiRequest(new Request("http://bt.test/api/v1/me/settings", {
			method: "PUT",
			headers: {
				...signedIn,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				...DEFAULT_SETTINGS,
				favoriteTeamIds: [121],
				version: 1,
			}),
		}), app.context);
		expect(put.status).toBe(200);

		expect(await count(db, "schedule_days")).toBe(1);
		expect(await count(db, "games")).toBeGreaterThan(0);
		expect(await count(db, "users")).toBe(1);
		expect(await count(db, "account_settings")).toBe(1);
	});

	it("PGlite: the isolate composition reads the database of the scope it runs in, and none outside one", async () =>
	{
		const { db } = await migratedPglite();
		const app = createWorkerApp({}, scopedDatabase);
		await expect(app.ingest.schedules.getByDate("2024-07-04")).rejects.toThrow(/no database in scope/);
		await expect(inDatabaseScope(undefined, () => app.ingest.schedules.getByDate("2024-07-04"))).rejects.toThrow(/HYPERDRIVE binding is missing/);
		const response = await withDatabase(db, () => inDatabaseScope(undefined, () => handleApiRequest(new Request("http://bt.test/api/v1/schedule?date=2024-07-04"), app.context)));
		expect(response.status).toBe(200);
		expect(await count(db, "schedule_days")).toBe(1);
	});
});

describe("the dev composition on a loaded dev seed (S112)", () =>
{
	afterEach(() =>
	{
		vi.restoreAllMocks();
	});

	it("S112 AC 3: a refresh-on-read of a seeded, final game and its day finds them current in the store, asking MLB nothing", async () =>
	{
		const { db } = await migratedPglite();
		const app = createWorkerApp({}, db);
		const { seed: recorded } = await recordDevSeed(recordedClient().mlb, {
			start: "2026-09-04",
			end: "2026-09-05",
		});
		// A real seed differs from the committed fixtures: it holds days they don't (here
		// 2026-09-04 lists 2026-09-05's games) and later recordings of games they do (823823
		// with one clip fewer). A refresh through the fixtures would replace both.
		const seed = {
			...recorded,
			days: recorded.days.map((d) => d.date === "2026-09-04" ? {
				...d,
				games: recorded.days[1]!.games,
			} : d),
			games: recorded.games.map((g) => ({
				...g,
				highlights: g.highlights.slice(1),
			})),
		};
		await loadDevSeed(app.ingest, seed);
		const day = await app.ingest.schedules.getByDate("2026-09-05");
		const game = await app.ingest.games.getByPk(823823);
		expect(game?.status.codedGameState).toBe("F");

		const network = vi.spyOn(globalThis, "fetch");
		const refreshedGame = await getOrRefreshGame(app.ingest, 823823, {
			force: true,
		});
		const refreshedDay = await getOrRefreshSchedule(app.ingest, "2026-09-05", {
			force: true,
		});
		const seededOnly = await getOrRefreshSchedule(app.ingest, "2026-09-04", {
			force: true,
		});
		expect(network).not.toHaveBeenCalled();
		expect(refreshedGame?.version).toBe(game?.version);
		expect(refreshedGame?.plays).toEqual(game?.plays);
		expect(refreshedDay.version).toBe(day?.version);
		expect(refreshedDay.games).toEqual(day?.games);
		expect(seededOnly.games.length).toBeGreaterThan(0);
		expect(refreshedGame?.highlights).toEqual(game?.highlights);

		// Served through the API from the store, as `pnpm dev` would.
		const served = await handleApiRequest(new Request("http://bt.test/api/v1/games/823823"), app.context);
		expect(served.status).toBe(200);
		expect(network).not.toHaveBeenCalled();
	});
});

describe("Logto accounts in the Worker composition (S116)", () =>
{
	/** Signs in with a Logto ID token (`claims` over the stand-in's defaults), then deletes the account; answers the deletion's status and the user rows left. */
	async function signInAndDelete(env: WorkerEnv, claims: Record<string, unknown> = {})
	{
		const { db } = await migratedPglite();
		const tenant = await createTestTenant();
		const management = createManagementStandIn("tenant1");
		management.users.set("logto-user-1", {
			id: "logto-user-1",
			primaryEmail: "fan@example.test",
			isSuspended: false,
		});
		const app = createWorkerApp(env, db, {
			fetch: (input, init) => (input.startsWith(TEST_LOGTO_ENDPOINT) ? tenant.fetch(input) : management.fetch(input, init)),
		});
		const call = (path: string, init: RequestInit) => handleApiRequest(new Request(`http://bt.test${path}`, init), app.context);
		const signedIn = await call("/api/v1/sign-in", {
			method: "POST",
			body: JSON.stringify({
				idToken: await tenant.sign(claims),
			}),
		});
		const { token } = await signedIn.json() as { token: string };
		expect(signedIn.status).toBe(200);
		const deleted = await call("/api/v1/me/delete", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				phrase: "delete my account",
			}),
		});
		return {
			status: deleted.status,
			users: await count(db, "users"),
			links: await count(db, "identity_links"),
			management,
		};
	}

	const logtoVars: WorkerEnv = {
		LOGTO_ENDPOINT: TEST_LOGTO_ENDPOINT,
		LOGTO_APP_ID: TEST_LOGTO_APP_ID,
	};

	it("S116 AC 4: with production's machine-to-machine secret, deleting an account deletes its Logto account too", async () =>
	{
		const result = await signInAndDelete({
			...logtoVars,
			LOGTO_TENANT_ID: "tenant1",
			LOGTO_S2S_APP_ID: "m2m-app",
			LOGTO_S2S_SECRET: "m2m-secret",
		});
		expect(result.status).toBe(200);
		expect(result.users).toBe(0);
		expect(result.links).toBe(0);
		expect(result.management.users.has("logto-user-1")).toBe(false);
	});

	it("S116 AC 4: without the secret (staging) no Logto admin is composed, and deletion still removes every BT row", async () =>
	{
		expect(logtoAdmin(logtoVars)).toBeUndefined();
		expect(logtoAdmin({
			...logtoVars,
			LOGTO_TENANT_ID: "tenant1",
			LOGTO_S2S_APP_ID: "m2m-app",
		})).toBeUndefined();
		const result = await signInAndDelete(logtoVars);
		expect(result.status).toBe(200);
		expect(result.users).toBe(0);
		expect(result.links).toBe(0);
		// The test account in staging's own tenant is left alone; nothing called the Management API.
		expect(result.management.calls).toEqual([]);
	});

	it("S120 AC 1: re-trading a still-valid ID token whose sign-in is 11 minutes old, or one without auth_time, gets a session deletion refuses", async () =>
	{
		const elevenMinutesAgo = Math.floor(Date.now() / 1000) - 11 * 60;
		for (const claims of [{
			auth_time: elevenMinutesAgo,
			iat: elevenMinutesAgo,
		}, {
			auth_time: undefined,
		}])
		{
			const result = await signInAndDelete(logtoVars, claims);
			expect(result.status).toBe(403);
			expect(result.users).toBe(1);
			expect(result.links).toBe(1);
		}
		// A sign-in from just now (the stand-in's default auth_time) deletes, as S116 AC 4 shows.
		expect((await signInAndDelete(logtoVars)).status).toBe(200);
	});
});

describe("POST /api/v1/sign-in failures (S120)", () =>
{
	const logtoVars: WorkerEnv = {
		LOGTO_ENDPOINT: TEST_LOGTO_ENDPOINT,
		LOGTO_APP_ID: TEST_LOGTO_APP_ID,
	};

	afterEach(() =>
	{
		vi.restoreAllMocks();
	});

	it("S120 AC 4: answers 401 only for a refused credential, and 503 sign_in_failed when BT itself fails", async () =>
	{
		const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const tenant = await createTestTenant();
		const other = await createTestTenant();
		const { db, pglite } = await migratedPglite();
		let jwks: "up" | "error" | "unreachable" = "up";
		const app = createWorkerApp(logtoVars, db, {
			fetch: async (input) =>
			{
				if (jwks === "unreachable") throw new TypeError("fetch failed");
				return jwks === "error" ? new Response("unavailable", {
					status: 503,
				}) : tenant.fetch(input);
			},
		});
		const signIn = async (idToken: string) =>
		{
			const response = await handleApiRequest(new Request("http://bt.test/api/v1/sign-in", {
				method: "POST",
				body: JSON.stringify({
					idToken,
				}),
			}), app.context);
			return {
				status: response.status,
				body: await response.json() as unknown,
			};
		};
		const refused = {
			status: 401,
			body: {
				error: "sign_in_refused",
			},
		};
		const failed = {
			status: 503,
			body: {
				error: "sign_in_failed",
			},
		};

		// The tenant's keys can't be fetched: BT's failure, not the fan's.
		jwks = "error";
		expect(await signIn(await tenant.sign())).toEqual(failed);
		jwks = "unreachable";
		expect(await signIn(await tenant.sign())).toEqual(failed);

		// The credential itself: a forged signature, no email, malformed parts.
		jwks = "up";
		expect(await signIn(await other.sign())).toEqual(refused);
		expect(await signIn(await tenant.sign({
			email: undefined,
		}))).toEqual(refused);
		expect(await signIn("not-a-jwt")).toEqual(refused);
		expect(await signIn("%%%.%%%.%%%")).toEqual(refused);
		expect(await signIn("eyJhbGciOiJFUzM4NCJ9.e30.!!")).toEqual(refused);
		expect((await signIn(await tenant.sign())).status).toBe(200);

		// The database fails: 503 too.
		await pglite.close();
		expect(await signIn(await tenant.sign())).toEqual(failed);
		// Logged by error name only (ADR-028: no token, no account subject).
		expect(logged.mock.calls.every((call) => call.join(" ").startsWith("sign-in failed:"))).toBe(true);
		expect(logged).toHaveBeenCalledTimes(3);
	});
});
