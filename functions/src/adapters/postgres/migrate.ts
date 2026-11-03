/**
 * Applying the committed migrations from Node (S51): `pnpm db:seed` against compose.yaml's
 * Postgres, and PGlite in tests and `local-server.ts`. Drizzle records what it applied, so
 * running it again changes nothing. The Worker never migrates: deploys run `pnpm db:migrate`
 * first (S113).
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migrateNodePostgres } from "drizzle-orm/node-postgres/migrator";
import type { PostgresDb } from "./repos.js";

/** The committed SQL migrations beside the schema (`drizzle-kit generate`, S50). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));

/** Migrates a database opened by `openPostgres` (node-postgres). */
export async function migratePostgres(db: PostgresDb): Promise<void>
{
	await migrateNodePostgres(db as Parameters<typeof migrateNodePostgres>[0], {
		migrationsFolder: MIGRATIONS_FOLDER,
	});
}

/** A fresh in-process PGlite with the migrations applied, and the PGlite under it. */
export async function migratedPglite(): Promise<{ db: PostgresDb;
	pglite: PGlite; }>
{
	const pglite = new PGlite();
	const db = drizzlePglite(pglite);
	await migratePglite(db, {
		migrationsFolder: MIGRATIONS_FOLDER,
	});
	return {
		db,
		pglite,
	};
}
