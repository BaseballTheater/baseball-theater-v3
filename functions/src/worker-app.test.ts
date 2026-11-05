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
import { createWorkerApp } from "./worker-app.js";

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
		const app = createWorkerApp({}, db);
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
