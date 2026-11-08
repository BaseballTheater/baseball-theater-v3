/**
 * Where the local database is (S51, S122): the Node commands that write it (`pnpm db:seed`,
 * `pnpm mlb:backfill`) share this, so "local" means one thing. Import-safe — nothing runs on
 * import — and Node-only (it reads `wrangler.jsonc` from disk), so the Worker never imports it.
 */
import { readFileSync } from "node:fs";

/** Hosts that are the developer's own machine or compose.yaml's Postgres, never a hosted database. */
export const LOCAL_DB_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "::1", "[::1]", "postgres"];

/** Whether a connection string's host is local ({@link LOCAL_DB_HOSTS}). */
export function isLocalDbHost(host: string): boolean
{
	return LOCAL_DB_HOSTS.includes(host);
}

/** wrangler.jsonc's local Hyperdrive connection string (comments stripped; the file is JSONC). */
export function localConnectionString(): string
{
	const text = readFileSync(new URL("../../../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
	const config = JSON.parse(text) as { hyperdrive?: { binding: string;
		localConnectionString?: string; }[]; };
	const local = config.hyperdrive?.find((h) => h.binding === "HYPERDRIVE")?.localConnectionString;
	if (!local) throw new Error("wrangler.jsonc has no HYPERDRIVE localConnectionString");
	return local;
}

/**
 * The database a connection string names, as logs and the backfill's resume file name it:
 * host and database only — never the user or password (S117, S122).
 */
export function databaseTarget(connectionString: string): { host: string;
	name: string; }
{
	const url = new URL(connectionString);
	return {
		host: url.hostname,
		name: decodeURIComponent(url.pathname.slice(1)) || "postgres",
	};
}
