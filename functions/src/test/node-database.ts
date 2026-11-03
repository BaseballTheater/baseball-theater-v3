/**
 * For Node tests that reach the Worker's isolate composition (`workerApp`, the Durable
 * Objects): a migrated PGlite as the process's database (`setNodeDatabase`, S51), fresh per
 * test file.
 */
import { setNodeDatabase } from "../adapters/postgres/connect.js";
import { migratedPglite } from "../adapters/postgres/migrate.js";
import type { PostgresDb } from "../adapters/postgres/repos.js";

export async function useNodeDatabase(): Promise<PostgresDb>
{
	const { db } = await migratedPglite();
	setNodeDatabase(db);
	return db;
}
