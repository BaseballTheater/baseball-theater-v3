/**
 * The baseball-data copy (S117) between two in-process PGlite databases: production holds both
 * baseball and fans' rows; the target is staging. Triggers on the target make any write to a
 * personal table, and any delete or truncate at all, fail the copy outright, so "never written,
 * not even for a moment" is checked as it happens, not only by what is left at the end.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import {
	describe, expect, it,
} from "vitest";
import { MIGRATIONS_FOLDER, migratedPglite } from "../adapters/postgres/migrate.js";
import type { PostgresDb } from "../adapters/postgres/repos.js";
import { baseballTables, copyBaseballData } from "./baseball-copy.js";
import { DATA_CLASSIFICATION } from "./data-classification.js";

const PERSONAL_TABLES = Object.entries(DATA_CLASSIFICATION.postgresTables).filter(([, label]) => label.kind !== "none").map(([table]) => table);

async function all(db: PostgresDb, query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]>
{
	return (await db.execute(query) as unknown as { rows: Record<string, unknown>[] }).rows;
}

/** Every row of a table, keyed columns sorted, for before/after comparison. */
async function dump(db: PostgresDb, table: string): Promise<Record<string, unknown>[]>
{
	return all(db, sql`SELECT * FROM ${sql.identifier(table)} ORDER BY 1`);
}

/** Production: two days of baseball across every `none` table, and one fan in every personal table and the deletion log. */
async function production(): Promise<PostgresDb>
{
	const { db } = await migratedPglite();
	await db.execute(sql`INSERT INTO schedule_days (date, version, document) VALUES
		('2024-04-01', 3, '{"date":"2024-04-01","games":[1,2]}'), ('2024-04-02', 1, '{"date":"2024-04-02","games":[]}')`);
	await db.execute(sql`INSERT INTO games (game_pk, official_date, version, document) VALUES
		(1, '2024-04-01', 5, '{"gamePk":1,"note":"prod"}'), (2, '2024-04-01', 5, '{"gamePk":2}'), (3, '2024-04-02', 2, '{"gamePk":3}')`);
	await db.execute(sql`INSERT INTO game_projections (game_pk, version, document) VALUES (1, 5, '{"header":{"version":5}}')`);
	await db.execute(sql`INSERT INTO replay_artifacts (game_pk, version, document) VALUES (1, 1, '{"version":1}')`);
	await db.execute(sql`INSERT INTO users (uid, email, display_name, role, created_at, updated_at) VALUES ('u1', 'fan@example.com', 'Fan', 'user', 'now', 'now')`);
	await db.execute(sql`INSERT INTO entitlements (uid, tier, faster_live_refresh, cloud_synced_settings, savant_links) VALUES ('u1', 'free', false, false, false)`);
	await db.execute(sql`INSERT INTO identity_links (provider, subject, uid) VALUES ('logto', 'sub-1', 'u1')`);
	await db.execute(sql`INSERT INTO account_settings (uid, favorite_team_ids, opens_first, game_row_slot, collapse_non_favorites, hide_scores, video_player, version)
		VALUES ('u1', '{147}', 'scoreboard', 'score', false, false, 'inline', 1)`);
	await db.execute(sql`INSERT INTO deletion_log (uid, deleted_at) VALUES ('gone', 'then')`);
	return db;
}

/**
 * Makes `tables` fail any statement of `events` (INSERT, UPDATE, DELETE, TRUNCATE): the copy
 * then cannot so much as try one without failing.
 */
async function forbid(db: PostgresDb, tables: string[], events: string[]): Promise<void>
{
	await db.execute(sql`CREATE OR REPLACE FUNCTION forbidden() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'forbidden % on %', TG_OP, TG_TABLE_NAME; END $$`);
	const rowEvents = events.filter((event) => event !== "TRUNCATE");
	for (const table of tables)
	{
		if (rowEvents.length) await db.execute(sql.raw(`CREATE TRIGGER forbid_rows BEFORE ${rowEvents.join(" OR ")} ON "${table}" FOR EACH ROW EXECUTE FUNCTION forbidden()`));
		if (events.includes("TRUNCATE")) await db.execute(sql.raw(`CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON "${table}" FOR EACH STATEMENT EXECUTE FUNCTION forbidden()`));
	}
}

const noMigration = async () => undefined;

/** What a watched source saw: one entry per statement run inside a transaction, and how many of them were page reads. */
type SourceWatch = { readOnlyAfter: string[];
	pageReads: number; };

/**
 * Production as a pooler would serve it: a statement outside a transaction throws (through
 * PgBouncer's transaction mode it could land on any server connection, so nothing may rely on
 * one), and every statement inside a transaction is followed by `SHOW transaction_read_only`, so
 * a read that ran before the transaction was made read-only is caught.
 */
function watchSource(db: PostgresDb): { db: PostgresDb;
	seen: SourceWatch; }
{
	const seen: SourceWatch = {
		readOnlyAfter: [],
		pageReads: 0,
	};
	type Tx = Pick<PostgresDb, "execute">;
	const watched = new Proxy(db, {
		get(target, prop)
		{
			if (prop === "execute") return () =>
			{
				throw new Error("source statement outside a transaction");
			};
			if (prop === "transaction") return (run: (tx: Tx) => Promise<unknown>) => target.transaction(async (tx) => run({
				execute: (async (query: ReturnType<typeof sql>) =>
				{
					const result = await tx.execute(query) as unknown as { rows: Record<string, unknown>[] };
					const shown = await tx.execute(sql`SHOW transaction_read_only`) as unknown as { rows: { transaction_read_only: string }[] };
					seen.readOnlyAfter.push(String(shown.rows[0]?.transaction_read_only));
					if (result.rows[0] && "fetched" in result.rows[0]) seen.pageReads++;
					return result;
				}) as unknown as Tx["execute"],
			}));
			return Reflect.get(target, prop, target) as unknown;
		},
	});
	return {
		db: watched,
		seen,
	};
}

describe("copyBaseballData (S117)", () =>
{
	it("AC 1 personal: copies every baseball row and never writes a personal table or the deletion log", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		await forbid(target, PERSONAL_TABLES, ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]);
		const copies = await copyBaseballData({
			source,
			target,
			migrateTarget: noMigration,
		});
		expect(copies.map((copy) => copy.table)).toEqual(["schedule_days", "games", "game_projections", "replay_artifacts"]);
		expect(PERSONAL_TABLES.sort()).toEqual(["account_settings", "deletion_log", "entitlements", "identity_links", "users"]);
		for (const table of baseballTables()) expect(await dump(target, table)).toEqual(await dump(source, table));
		for (const table of PERSONAL_TABLES) expect(await dump(target, table)).toEqual([]);
	});

	it("AC 1 personal: pages through a table larger than one batch", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		const [games] = await copyBaseballData({
			source,
			target,
			migrateTarget: noMigration,
			batchRows: 1,
		}).then((copies) => copies.filter((copy) => copy.table === "games"));
		expect(games).toMatchObject({
			read: 3,
			written: 3,
		});
		expect(await dump(target, "games")).toEqual(await dump(source, "games"));
	});

	it("AC 1 personal: pages by bytes as well as rows, so a page of big documents stays small", async () =>
	{
		const production_ = await production();
		const { db: source, seen } = watchSource(production_);
		const { db: target } = await migratedPglite();
		const [games] = await copyBaseballData({
			source,
			target,
			migrateTarget: noMigration,
			batchRows: 100,
			batchBytes: 1,
		}).then((copies) => copies.filter((copy) => copy.table === "games"));
		expect(games).toMatchObject({
			read: 3,
			written: 3,
		});
		// One row per page under a 1-byte cap: schedule_days 2, games 3, game_projections 1, replay_artifacts 1.
		expect(seen.pageReads).toBe(7);
		for (const table of baseballTables()) expect(await dump(target, table)).toEqual(await dump(production_, table));
	});

	it("AC 1 personal: never reads a personal table or the deletion log, only the baseball tables", async () =>
	{
		const source = await production();
		await source.execute(sql`CREATE ROLE copier NOLOGIN`);
		await source.execute(sql`GRANT USAGE ON SCHEMA public TO copier`);
		await source.execute(sql.raw(`GRANT SELECT ON ${baseballTables().join(", ")} TO copier`));
		// From here production lets the copy read the baseball tables and nothing else: reading a fan's table fails.
		await source.execute(sql`SET ROLE copier`);
		await expect(source.execute(sql`SELECT * FROM users`)).rejects.toThrow();
		const { db: target } = await migratedPglite();
		const copies = await copyBaseballData({
			source,
			target,
			migrateTarget: noMigration,
		});
		await source.execute(sql`RESET ROLE`);
		expect(copies.map((copy) => copy.read)).toEqual([2, 3, 1, 1]);
		for (const table of baseballTables()) expect(await dump(target, table)).toEqual(await dump(source, table));
	});

	it("AC 2 twice: a second copy writes nothing and changes nothing", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		await copyBaseballData({
			source,
			target,
			migrateTarget: noMigration,
		});
		const before = await Promise.all(baseballTables().map((table) => dump(target, table)));
		const again = await copyBaseballData({
			source,
			target,
			migrateTarget: noMigration,
		});
		expect(again.map((copy) => copy.written)).toEqual([0, 0, 0, 0]);
		expect(again.map((copy) => copy.read)).toEqual([2, 3, 1, 1]);
		expect(await Promise.all(baseballTables().map((table) => dump(target, table)))).toEqual(before);
	});

	it("AC 2 newer: a target row with a higher version survives; an older one is brought up to production's", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		await target.execute(sql`INSERT INTO games (game_pk, official_date, version, document) VALUES
			(1, '2024-04-01', 9, '{"gamePk":1,"note":"staging is ahead"}'), (2, '2024-04-01', 1, '{"gamePk":2,"note":"old"}')`);
		const copies = await copyBaseballData({
			source,
			target,
			migrateTarget: noMigration,
		});
		expect(copies.find((copy) => copy.table === "games")?.written).toBe(2);
		expect(await all(target, sql`SELECT game_pk, version, document FROM games ORDER BY game_pk`)).toEqual([
			{
				game_pk: 1,
				version: 9,
				document: {
					gamePk: 1,
					note: "staging is ahead",
				},
			},
			{
				game_pk: 2,
				version: 5,
				document: {
					gamePk: 2,
				},
			},
			{
				game_pk: 3,
				version: 2,
				document: {
					gamePk: 3,
				},
			},
		]);
	});

	it("AC 3 ahead: a target one migration ahead keeps its extra column, its extra table and its own rows, and gets production's", async () =>
	{
		const source = await production();
		await source.execute(sql`ALTER TABLE games ADD COLUMN production_only text`);
		await source.execute(sql`UPDATE games SET production_only = 'not copied'`);
		const { db: target } = await migratedPglite();
		// Staging's own migration, which production hasn't had: a column, a table, and a row of its own.
		await target.execute(sql`ALTER TABLE games ADD COLUMN staging_note text`);
		await target.execute(sql`CREATE TABLE staging_only (id integer PRIMARY KEY, version integer NOT NULL)`);
		await target.execute(sql`INSERT INTO staging_only VALUES (1, 1)`);
		await target.execute(sql`INSERT INTO games (game_pk, official_date, version, document, staging_note) VALUES (999, '2030-01-01', 1, '{"gamePk":999}', 'mine')`);
		// A row both sides have, older on staging: production's columns win, staging's own column keeps its value.
		await target.execute(sql`INSERT INTO games (game_pk, official_date, version, document, staging_note) VALUES (1, '2024-04-01', 0, '{"gamePk":1,"note":"old"}', 'kept')`);
		await target.execute(sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('staging-ahead', 99999999999999)`);
		await forbid(target, [...baseballTables(), "staging_only"], ["DELETE", "TRUNCATE"]);
		const order: string[] = [];
		const copies = await copyBaseballData({
			source,
			target,
			migrateTarget: async () =>
			{
				order.push("migrate");
				await migratePglite(target as Parameters<typeof migratePglite>[0], {
					migrationsFolder: MIGRATIONS_FOLDER,
				});
			},
			log: (line) => order.push(line),
		});
		expect(order[0]).toBe("migrate");
		expect(copies.find((copy) => copy.table === "games")).toMatchObject({
			read: 3,
			written: 3,
			sourceOnlyColumns: ["production_only"],
			targetOnlyColumns: ["staging_note"],
		});
		expect(await all(target, sql`SELECT game_pk, version, staging_note FROM games WHERE game_pk = 1`)).toEqual([{
			game_pk: 1,
			version: 5,
			staging_note: "kept",
		}]);
		expect(await all(target, sql`SELECT game_pk, staging_note FROM games ORDER BY game_pk`)).toEqual([
			{
				game_pk: 1,
				staging_note: "kept",
			},
			{
				game_pk: 2,
				staging_note: null,
			},
			{
				game_pk: 3,
				staging_note: null,
			},
			{
				game_pk: 999,
				staging_note: "mine",
			},
		]);
		expect(await all(target, sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'production_only'`)).toEqual([]);
		expect(await dump(target, "staging_only")).toEqual([{
			id: 1,
			version: 1,
		}]);
	});

	it("AC 3 ahead: a table either side lacks is skipped, not created", async () =>
	{
		const source = await production();
		await source.execute(sql`DROP TABLE replay_artifacts`);
		const { db: target } = await migratedPglite();
		await target.execute(sql`DROP TABLE game_projections`);
		const copies = await copyBaseballData({
			source,
			target,
			migrateTarget: noMigration,
		});
		expect(copies.find((copy) => copy.table === "replay_artifacts")?.skipped).toBe("production has no such table");
		expect(copies.find((copy) => copy.table === "game_projections")?.skipped).toBe("the target has no such table");
		expect(await all(target, sql`SELECT to_regclass('public.game_projections') AS t`)).toEqual([{
			t: null,
		}]);
	});

	it("AC 3 ahead: a target-only column that is required with a default gets its default", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		await target.execute(sql`ALTER TABLE games ADD COLUMN staging_flag text NOT NULL DEFAULT 'd'`);
		await copyBaseballData({
			source,
			target,
			migrateTarget: noMigration,
		});
		expect(await all(target, sql`SELECT game_pk, staging_flag FROM games ORDER BY game_pk`)).toEqual([1, 2, 3].map((gamePk) => ({
			game_pk: gamePk,
			staging_flag: "d",
		})));
	});

	it("AC 3 ahead: a target-only column that is required with no default skips that table with the reason, and the others are still copied", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		await target.execute(sql`ALTER TABLE games ADD COLUMN required_note text NOT NULL`);
		const lines: string[] = [];
		const copies = await copyBaseballData({
			source,
			target,
			migrateTarget: noMigration,
			log: (line) => lines.push(line),
		});
		expect(copies.find((copy) => copy.table === "games")).toMatchObject({
			read: 0,
			written: 0,
			skipped: "the target's column required_note is required (NOT NULL, no default) and production has no values for it",
		});
		expect(lines.find((line) => line.startsWith("games:"))).toContain("none of production's rows copied");
		expect(await dump(target, "games")).toEqual([]);
		for (const table of baseballTables().filter((name) => name !== "games")) expect(await dump(target, table)).toEqual(await dump(source, table));
	});

	it("AC 3 ahead: a column the target generates is left to the target, not written", async () =>
	{
		const source = await production();
		await source.execute(sql`ALTER TABLE games ADD COLUMN derived integer`);
		await source.execute(sql`UPDATE games SET derived = 77`);
		const { db: target } = await migratedPglite();
		await target.execute(sql`ALTER TABLE games ADD COLUMN derived integer GENERATED ALWAYS AS (version * 2) STORED`);
		const copies = await copyBaseballData({
			source,
			target,
			migrateTarget: noMigration,
		});
		expect(copies.find((copy) => copy.table === "games")).toMatchObject({
			written: 3,
			generatedColumns: ["derived"],
		});
		expect(await all(target, sql`SELECT game_pk, derived FROM games ORDER BY game_pk`)).toEqual([
			{
				game_pk: 1,
				derived: 10,
			},
			{
				game_pk: 2,
				derived: 10,
			},
			{
				game_pk: 3,
				derived: 4,
			},
		]);
	});

	it("AC 3 ahead: an unmigrated target is migrated before anything is copied", async () =>
	{
		const source = await production();
		const pglite = new PGlite();
		const target = drizzlePglite(pglite) as unknown as PostgresDb;
		await copyBaseballData({
			source,
			target,
			migrateTarget: () => migratePglite(target as Parameters<typeof migratePglite>[0], {
				migrationsFolder: MIGRATIONS_FOLDER,
			}),
		});
		expect(await dump(target, "games")).toEqual(await dump(source, "games"));
	});

	it("AC 3 production unchanged: production is only read and never migrated or written", async () =>
	{
		const source = await production();
		const tables = (await all(source, sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).map((row) => String(row.table_name));
		const before = await Promise.all(tables.map((table) => dump(source, table)));
		const migrations = await all(source, sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`);
		await forbid(source, tables, ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]);
		const { db: target } = await migratedPglite();
		await copyBaseballData({
			source,
			target,
			migrateTarget: noMigration,
		});
		expect(await Promise.all(tables.map((table) => dump(source, table)))).toEqual(before);
		expect(await all(source, sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`)).toEqual(migrations);
	});

	it("AC 3 production unchanged: every production read runs in its own read-only transaction, safe through a pooler, and nothing is set on its session", async () =>
	{
		const production_ = await production();
		const { db: source, seen } = watchSource(production_);
		const { db: target } = await migratedPglite();
		await copyBaseballData({
			source,
			target,
			migrateTarget: noMigration,
		});
		expect(seen.readOnlyAfter.length).toBeGreaterThan(0);
		expect(new Set(seen.readOnlyAfter)).toEqual(new Set(["on"]));
		expect(await all(production_, sql`SHOW default_transaction_read_only`)).toEqual([{
			default_transaction_read_only: "off",
		}]);
	});

	it("refuses a table without one shared primary key or a version column, rather than write unguarded", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		await source.execute(sql`ALTER TABLE replay_artifacts DROP COLUMN version`);
		await expect(copyBaseballData({
			source,
			target,
			migrateTarget: noMigration,
		})).rejects.toThrow(/replay_artifacts: no version column/);
		const { db: noKey } = await migratedPglite();
		await noKey.execute(sql`ALTER TABLE schedule_days DROP CONSTRAINT schedule_days_pkey`);
		await expect(copyBaseballData({
			source: await production(),
			target: noKey,
			migrateTarget: noMigration,
		})).rejects.toThrow(/schedule_days: the copy needs one primary-key column/);
	});
});
