/**
 * Global setup for the workerd tests (S51): the Worker's `HYPERDRIVE` binding needs a
 * Postgres to talk to, and CI has no Docker, so this serves a migrated PGlite over the
 * Postgres wire protocol on `PGLITE_PORT` (`@electric-sql/pglite-socket`) for the test run.
 * `vitest.workers.config.ts` points the binding there. PGlite is one connection underneath;
 * the server multiplexes the Worker's connections onto it.
 */
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migratedPglite } from "../adapters/postgres/migrate.js";

/** Where the workerd tests' Postgres listens; `vitest.workers.config.ts` reads the same constant. */
export const PGLITE_PORT = 54329;

/**
 * The server drops its socket's error listener once a connection is done, so a Worker
 * connection reset after that (workerd ends sockets abruptly) would surface as an uncaught
 * ECONNRESET (or EPIPE, writing to it) and end the test run. Those are a client hanging up;
 * anything else still throws.
 */
function ignoreClientResets(error: NodeJS.ErrnoException): void
{
	if (error.code !== "ECONNRESET" && error.code !== "EPIPE") throw error;
}

export default async function setup(): Promise<() => Promise<void>>
{
	process.on("uncaughtException", ignoreClientResets);
	const { pglite } = await migratedPglite();
	const server = new PGLiteSocketServer({
		db: pglite,
		host: "127.0.0.1",
		port: PGLITE_PORT,
		maxConnections: 16,
	});
	await server.start();
	return async () =>
	{
		await server.stop();
		// The listener stays: stopping the server resets the sockets still open.
		await pglite.close();
	};
}
