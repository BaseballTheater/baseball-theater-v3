/**
 * `pnpm db:migrate` (S113) without a hosted database: `migrateDatabaseAt` reaches an empty
 * PGlite through a connection string, over the Postgres wire protocol (`pglite-socket`), the
 * way it reaches Neon. Migrating twice leaves the tables and Drizzle's record of applied
 * migrations as they were, and the tables it creates are exactly the ones the data
 * classification manifest labels (ADR-028).
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import {
	afterEach, describe, expect, it,
} from "vitest";
import { DATA_CLASSIFICATION } from "../../services/data-classification.js";
import { migrateDatabaseAt } from "./migrate.js";

let stop: (() => Promise<void>) | undefined;
afterEach(async () =>
{
	await stop?.();
	stop = undefined;
});

/** An empty PGlite served on a local port, and a connection string for it. */
async function emptyDatabase(): Promise<{ pglite: PGlite;
	url: string; }>
{
	const pglite = new PGlite();
	// A port of its own, so this file can't collide with the workerd tests' server.
	const port = 55000 + Math.floor(Math.random() * 4000);
	const server = new PGLiteSocketServer({
		db: pglite,
		host: "127.0.0.1",
		port,
	});
	await server.start();
	stop = async () =>
	{
		await server.stop();
		await pglite.close();
	};
	return {
		pglite,
		url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
	};
}

async function tables(pglite: PGlite): Promise<string[]>
{
	const result = await pglite.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
	return result.rows.map((row) => row.table_name);
}

async function applied(pglite: PGlite): Promise<string[]>
{
	const result = await pglite.query<{ hash: string }>("SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id");
	return result.rows.map((row) => row.hash);
}

describe("pnpm db:migrate (S113)", () =>
{
	it("S113 AC 1: applies the committed migrations to the database a connection string names, and twice changes nothing", async () =>
	{
		const { pglite, url } = await emptyDatabase();
		expect(await tables(pglite)).toEqual([]);

		await migrateDatabaseAt(url);
		const first = {
			tables: await tables(pglite),
			applied: await applied(pglite),
		};
		expect(first.tables.length).toBeGreaterThan(0);
		expect(first.applied.length).toBeGreaterThan(0);

		await migrateDatabaseAt(url);
		expect({
			tables: await tables(pglite),
			applied: await applied(pglite),
		}).toEqual(first);
	});

	it("S113 AC 5: the tables a migration creates are exactly the manifest's labeled Postgres tables", async () =>
	{
		const { pglite, url } = await emptyDatabase();
		await migrateDatabaseAt(url);
		expect(await tables(pglite)).toEqual(Object.keys(DATA_CLASSIFICATION.postgresTables).sort());
	});
});
