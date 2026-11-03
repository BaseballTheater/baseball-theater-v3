/**
 * S51 AC 3: the composition `pnpm dev` runs, on Postgres — here PGlite with the committed
 * migrations — serving the API and keeping what it serves in Postgres tables, accounts and
 * settings included. The Worker builds the same composition on `scopedDatabase`, which this
 * also exercises through `inDatabaseScope`.
 */
import { DEFAULT_SETTINGS } from "@bt/domain";
import { sql } from "drizzle-orm";
import {
	describe, expect, it,
} from "vitest";
import {
	inDatabaseScope, scopedDatabase, withDatabase,
} from "./adapters/postgres/connect.js";
import { migratedPglite } from "./adapters/postgres/migrate.js";
import type { PostgresDb } from "./adapters/postgres/repos.js";
import { handleApiRequest } from "./handlers/api.js";
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
