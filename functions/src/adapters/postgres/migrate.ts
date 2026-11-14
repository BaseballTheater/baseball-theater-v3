/**
 * Applying the committed migrations from Node (S51): `pnpm db:seed` against compose.yaml's
 * Postgres, PGlite in tests and `local-server.ts`, and `pnpm db:migrate` against whatever
 * database `BT_DATABASE_URL` names, production included (S113, run by the owner). Drizzle
 * records what it applied, so running it again changes nothing. The Worker never migrates.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migrateNodePostgres } from "drizzle-orm/node-postgres/migrator";
import { openPostgres } from "./connect.js";
import type { PostgresDb } from "./repos.js";

/** The committed SQL migrations beside the schema (`drizzle-kit generate`, S50). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));

/**
 * Migrates a database opened by `openPostgres` (node-postgres) from `migrationsFolder`, the committed
 * migrations unless a caller (the baseball-data copy, which compares against the same folder) names one.
 */
export async function migratePostgres(db: PostgresDb, migrationsFolder: string = MIGRATIONS_FOLDER): Promise<void>
{
	await migrateNodePostgres(db as Parameters<typeof migrateNodePostgres>[0], {
		migrationsFolder,
	});
}

/**
 * Opens `connectionString`, applies every committed migration it hasn't had, and closes it
 * (`pnpm db:migrate`, S113). The connection string comes from the caller's environment; none
 * for a hosted database is ever committed.
 */
export async function migrateDatabaseAt(connectionString: string): Promise<void>
{
	const { db, close } = await openPostgres(connectionString);
	try
	{
		await migratePostgres(db);
	}
	finally
	{
		await close();
	}
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
