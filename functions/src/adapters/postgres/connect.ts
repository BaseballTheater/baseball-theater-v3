/**
 * Connecting the Postgres adapter (S51; ADR-018). On Workers a connection belongs to the
 * request that opened it — another request can't use its socket — so the isolate's one
 * composition holds `scopedDatabase`, a handle that resolves to the connection of the unit
 * of work it runs in (a request, a cron tick, a Durable Object call), and `inDatabaseScope`
 * opens that connection through the `HYPERDRIVE` binding and closes it after. Locally the
 * binding's `localConnectionString` points at compose.yaml's Postgres; in the workerd tests,
 * at PGlite served over a socket. Node callers hand the composition a database directly.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import type { PostgresDb } from "./repos.js";

/** The `HYPERDRIVE` binding as the Worker sees it (`wrangler.jsonc` `hyperdrive`). */
export type HyperdriveBinding = { connectionString: string };

/**
 * One connection over node-postgres (`pg`, the driver Cloudflare recommends with Hyperdrive),
 * and how to close it. Hyperdrive pools behind it, so a unit of work needs only the one.
 */
export async function openPostgres(connectionString: string): Promise<{ db: PostgresDb;
	close: () => Promise<void>; }>
{
	const client = new Client({
		connectionString,
	});
	// A failed query rejects its own promise; this listener is for the socket. On Workers its
	// read loop ends with "Stream was cancelled" once we close it (pg-cloudflare), which is the
	// goodbye, not a fault. Anything before the close is worth a log line.
	let closed = false;
	client.on("error", (error) =>
	{
		if (!closed) console.error("[postgres] connection error", error);
	});
	await client.connect();
	return {
		db: drizzle(client),
		close: () =>
		{
			closed = true;
			return client.end();
		},
	};
}

const scope = new AsyncLocalStorage<PostgresDb>();

/** Node's database outside any scope (`setNodeDatabase`); never set in the Worker. */
let nodeDatabase: PostgresDb | undefined;

/**
 * Under Node there are no requests to scope (tests, `local-server.ts`): the process has one
 * database — PGlite — that unscoped work uses. The Worker never calls this, so work there
 * that escaped `inDatabaseScope` still throws.
 */
export function setNodeDatabase(db: PostgresDb | undefined): void
{
	nodeDatabase = db;
}

/** Runs `work` with `db` as the database `scopedDatabase` resolves to. */
export function withDatabase<T>(db: PostgresDb, work: () => Promise<T>): Promise<T>
{
	return scope.run(db, work);
}

/**
 * The database of the unit of work in progress. Every property read goes to the current
 * scope's connection, so repositories built once per isolate never hold another request's
 * socket. Used outside a scope it throws rather than reach for a connection that isn't there.
 */
export const scopedDatabase: PostgresDb = new Proxy({} as PostgresDb, {
	get(_target, key)
	{
		const db = scope.getStore() ?? nodeDatabase;
		if (!db) throw new Error("no database in scope: wrap the work in inDatabaseScope (S51)");
		const value = Reflect.get(db, key, db) as unknown;
		return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(db) : value;
	},
});

/**
 * Runs `work` on its own connection through `binding`, closing it afterwards — through
 * `waitUntil` when given, so the response isn't held for the goodbye. Inside an existing
 * scope (or under Node, with `setNodeDatabase`) it uses that database, so nested calls share
 * a connection.
 */
export async function inDatabaseScope<T>(
	binding: HyperdriveBinding | undefined,
	work: () => Promise<T>,
	waitUntil?: (promise: Promise<unknown>) => void,
): Promise<T>
{
	if (scope.getStore() ?? nodeDatabase) return work();
	if (!binding) throw new Error("the HYPERDRIVE binding is missing (wrangler.jsonc hyperdrive)");
	const { db, close } = await openPostgres(binding.connectionString);
	try
	{
		return await withDatabase(db, work);
	}
	finally
	{
		const closing = close();
		if (waitUntil) waitUntil(closing);
		else await closing;
	}
}
