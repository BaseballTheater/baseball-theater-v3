/**
 * The baseball-data copy (S117) between two in-process PGlite databases: production holds both
 * baseball and fans' rows; the target is staging. Triggers on the target make any write to a
 * personal table, and any delete or truncate at all, fail the copy outright, so "never written,
 * not even for a moment" is checked as it happens, not only by what is left at the end.
 */
import {
	cpSync, mkdtempSync, readFileSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { GameSnapshot } from "@bt/domain";
import { applyIfNewer, projectGame } from "@bt/domain";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import {
	describe, expect, it, vi,
} from "vitest";
import { MIGRATIONS_FOLDER, migratedPglite } from "../adapters/postgres/migrate.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import type { PostgresDb } from "../adapters/postgres/repos.js";
import { PostgresGameProjectionRepository, upsertGame } from "../adapters/postgres/repos.js";
import { isProjectionCurrent } from "./ingest.js";
import type { CopyDeps } from "./baseball-copy.js";
import {
	baseballTables, checkCopyRules, copyBaseballData, CopyRefused, tablesNamedIn,
} from "./baseball-copy.js";
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

/** A schedule-day or game document as ingest stores it: stamped, with the time its content last changed. */
function stamped(fields: Record<string, unknown>, version: number, lastChangedAt: string): string
{
	return JSON.stringify({
		...fields,
		windowMode: "cache",
		fetchedAt: lastChangedAt,
		version,
		lastChangedAt,
	});
}

/**
 * Production: two days of baseball across every `none` table, and one fan in every personal table and the deletion
 * log. Its games are toy documents `projectGame` can't project, so their projections are counted as not built; the
 * projection tests use a recorded game. Its own projection row is marked, so a test can see it is never copied.
 */
async function production(migrated?: PostgresDb): Promise<PostgresDb>
{
	const db = migrated ?? (await migratedPglite()).db;
	await db.execute(sql`INSERT INTO schedule_days (date, version, document) VALUES
		('2024-04-01', 3, ${stamped({
			date: "2024-04-01",
			games: [1, 2],
		}, 3, "2024-04-02T00:00:00.000Z")}), ('2024-04-02', 1, ${stamped({
			date: "2024-04-02",
			games: [],
		}, 1, "2024-04-03T00:00:00.000Z")})`);
	await db.execute(sql`INSERT INTO games (game_pk, official_date, version, document) VALUES
		(1, '2024-04-01', 5, ${stamped({
			gamePk: 1,
			note: "prod",
		}, 5, "2024-04-02T00:00:00.000Z")}), (2, '2024-04-01', 5, ${stamped({
			gamePk: 2,
		}, 5, "2024-04-02T00:00:00.000Z")}), (3, '2024-04-02', 2, ${stamped({
			gamePk: 3,
		}, 2, "2024-04-03T00:00:00.000Z")})`);
	await db.execute(sql`INSERT INTO game_projections (game_pk, version, document) VALUES (1, 5, '{"header":{"version":5},"marker":"production-only"}')`);
	await db.execute(sql`INSERT INTO replay_artifacts (game_pk, version, document) VALUES (1, 1, '{"version":1}')`);
	await db.execute(sql`INSERT INTO users (uid, email, display_name, role, created_at, updated_at) VALUES ('u1', 'fan@example.com', 'Fan', 'user', 'now', 'now')`);
	await db.execute(sql`INSERT INTO entitlements (uid, tier, faster_live_refresh, cloud_synced_settings, savant_links) VALUES ('u1', 'free', false, false, false)`);
	await db.execute(sql`INSERT INTO identity_links (provider, subject, uid) VALUES ('logto', 'sub-1', 'u1')`);
	await db.execute(sql`INSERT INTO account_settings (uid, favorite_team_ids, opens_first, game_row_slot, collapse_non_favorites, hide_scores, video_player, version)
		VALUES ('u1', '{147}', 'scoreboard', 'score', false, false, 'inline', 1)`);
	await db.execute(sql`INSERT INTO deletion_log (uid, deleted_at) VALUES ('gone', 'then')`);
	return db;
}

/** The tables copied row for row (projections are rebuilt, never copied). */
const COPIED_TABLES = ["schedule_days", "games", "replay_artifacts"];

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

const fixtures = new FixtureMlbStatsClient();

/** The recorded game 744834 re-keyed and stamped: a document `projectGame` can project. */
async function recordedGame(gamePk: number, version: number, lastChangedAt: string, fields: Partial<GameSnapshot> = {}): Promise<GameSnapshot>
{
	const fetched = await fixtures.fetchGame(744834);
	return {
		...fetched,
		gamePk,
		windowMode: "cache",
		fetchedAt: lastChangedAt,
		...fields,
		version,
		lastChangedAt,
	};
}

/** Copies with the defaults every test shares; `extra` overrides any of them. */
function copy(source: PostgresDb, target: PostgresDb, extra: Partial<CopyDeps> = {}): ReturnType<typeof copyBaseballData>
{
	return copyBaseballData({
		source,
		target,
		migrateTarget: noMigration,
		now: () => NOW,
		...extra,
	});
}

const NOW = new Date("2026-11-13T12:00:00.000Z");

/** The committed migration's `when`, so a test's own migrations sort before or after it as needed. */
const FIRST_WHEN = (JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as { entries: { when: number }[] }).entries.at(-1)!.when;

/** A copy of the committed migrations folder with `extra` migrations after them, as a checkout ahead of production would hold. */
function migrationsWith(extra: { tag: string;
	sql: string;
	when: number; }[]): string
{
	const folder = mkdtempSync(join(tmpdir(), "bt-migrations-"));
	cpSync(MIGRATIONS_FOLDER, folder, {
		recursive: true,
	});
	const journalPath = join(folder, "meta", "_journal.json");
	const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Record<string, unknown>[] };
	for (const migration of extra)
	{
		writeFileSync(join(folder, `${migration.tag}.sql`), migration.sql);
		journal.entries.push({
			idx: journal.entries.length,
			version: "7",
			when: migration.when,
			tag: migration.tag,
			breakpoints: true,
		});
	}
	writeFileSync(journalPath, JSON.stringify(journal));
	return folder;
}

/** A fresh PGlite migrated from `folder`. */
async function migratedFrom(folder: string): Promise<PostgresDb>
{
	const db = drizzlePglite(new PGlite()) as unknown as PostgresDb;
	await migratePglite(db as Parameters<typeof migratePglite>[0], {
		migrationsFolder: folder,
	});
	return db;
}

/** Migrates `db` from the folder the copy hands it. */
function migrating(db: PostgresDb): CopyDeps["migrateTarget"]
{
	return (folder) => migratePglite(db as Parameters<typeof migratePglite>[0], {
		migrationsFolder: folder,
	});
}

const dialect = new PgDialect();

/**
 * The target with every statement's SQL text recorded, and `before` run ahead of each one: tests count the copy's
 * statements of one kind, or change the target just before one runs, as its own ingest could.
 */
function watchTarget(db: PostgresDb, before: (text: string) => Promise<void> = async () => undefined): { db: PostgresDb;
	statements: string[]; }
{
	const statements: string[] = [];
	const watched = new Proxy(db, {
		get(target, prop)
		{
			if (prop === "execute") return async (query: SQL) =>
			{
				const text = dialect.sqlToQuery(query).sql;
				statements.push(text);
				await before(text);
				return target.execute(query);
			};
			return Reflect.get(target, prop, target) as unknown;
		},
	});
	return {
		db: watched,
		statements,
	};
}

describe("copyBaseballData (S117)", () =>
{
	it("AC 1 personal: copies every baseball row and never writes a personal table or the deletion log", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		await forbid(target, PERSONAL_TABLES, ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]);
		const copies = await copy(source, target);
		expect(copies.map((entry) => entry.table)).toEqual(["schedule_days", "games", "game_projections", "replay_artifacts"]);
		expect(PERSONAL_TABLES.sort()).toEqual(["account_settings", "deletion_log", "entitlements", "identity_links", "users"]);
		for (const table of COPIED_TABLES) expect(await dump(target, table)).toEqual(await dump(source, table));
		for (const table of PERSONAL_TABLES) expect(await dump(target, table)).toEqual([]);
	});

	it("AC 1 personal: pages through a table larger than one batch", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		const [games] = await copy(source, target, {
			batchRows: 1,
		}).then((copies) => copies.filter((entry) => entry.table === "games"));
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
		const [games] = await copy(source, target, {
			batchRows: 100,
			batchBytes: 1,
		}).then((copies) => copies.filter((entry) => entry.table === "games"));
		expect(games).toMatchObject({
			read: 3,
			written: 3,
		});
		// One row per page under a 1-byte cap: schedule_days 2, games 3, replay_artifacts 1 (projections aren't read).
		expect(seen.pageReads).toBe(6);
		for (const table of COPIED_TABLES) expect(await dump(target, table)).toEqual(await dump(production_, table));
	});

	it("AC 1 personal: never reads a personal table or the deletion log, only the baseball tables", async () =>
	{
		const source = await production();
		await source.execute(sql`CREATE ROLE copier NOLOGIN`);
		await source.execute(sql`GRANT USAGE ON SCHEMA public TO copier`);
		await source.execute(sql.raw(`GRANT SELECT ON ${baseballTables().join(", ")} TO copier`));
		// From here production lets the copy read the baseball tables (and the migration record) and nothing else.
		await source.execute(sql`GRANT USAGE ON SCHEMA drizzle TO copier`);
		await source.execute(sql`GRANT SELECT ON drizzle.__drizzle_migrations TO copier`);
		await source.execute(sql`SET ROLE copier`);
		await expect(source.execute(sql`SELECT * FROM users`)).rejects.toThrow();
		const { db: target } = await migratedPglite();
		const copies = await copy(source, target);
		await source.execute(sql`RESET ROLE`);
		expect(copies.map((entry) => entry.read)).toEqual([2, 3, 0, 1]);
		for (const table of COPIED_TABLES) expect(await dump(target, table)).toEqual(await dump(source, table));
	});

	it("AC 2 twice: a second copy writes nothing and changes nothing", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		await copy(source, target);
		const before = await Promise.all(baseballTables().map((table) => dump(target, table)));
		const again = await copy(source, target);
		expect(again.map((entry) => entry.written)).toEqual([0, 0, 0, 0]);
		expect(again.map((entry) => entry.read)).toEqual([2, 3, 0, 1]);
		expect(await Promise.all(baseballTables().map((table) => dump(target, table)))).toEqual(before);
	});

	it("AC 2 newer: a target row changed later survives whatever its version; one changed earlier gets production's content one version past its own", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		await target.execute(sql`INSERT INTO games (game_pk, official_date, version, document) VALUES
			(1, '2024-04-01', 1, ${stamped({
				gamePk: 1,
				note: "staging changed it later",
			}, 1, "2024-04-05T00:00:00.000Z")}), (2, '2024-04-01', 9, ${stamped({
				gamePk: 2,
				note: "old",
			}, 9, "2024-04-01T00:00:00.000Z")})`);
		const copies = await copy(source, target);
		expect(copies.find((entry) => entry.table === "games")).toMatchObject({
			written: 2,
			kept: {
				notLater: 1,
			},
		});
		const rows = await all(target, sql`SELECT game_pk, version, document->>'version' AS doc_version, document->>'note' AS note, document->>'lastChangedAt' AS changed FROM games ORDER BY game_pk`);
		expect(rows).toEqual([
			{
				game_pk: 1,
				version: 1,
				doc_version: "1",
				note: "staging changed it later",
				changed: "2024-04-05T00:00:00.000Z",
			},
			{
				game_pk: 2,
				version: 10,
				doc_version: "10",
				note: null,
				changed: "2024-04-02T00:00:00.000Z",
			},
			{
				game_pk: 3,
				version: 2,
				doc_version: "2",
				note: null,
				changed: "2024-04-03T00:00:00.000Z",
			},
		]);
	});

	it("v40 against v1 (Claude's review of PR #21): production's final game replaces staging's stale mid-game one at v41, with its projection rebuilt", async () =>
	{
		const { db: source } = await migratedPglite();
		const { db: target } = await migratedPglite();
		const final = await recordedGame(777, 1, "2026-07-02T03:00:00.000Z");
		const midGame = await recordedGame(777, 40, "2026-07-01T20:00:00.000Z", {
			windowMode: "active",
			status: {
				...final.status,
				detailedState: "In Progress",
			},
		});
		await upsertGame(source, final);
		await upsertGame(target, midGame);
		await target.execute(sql`INSERT INTO game_projections (game_pk, version, document) VALUES (777, 40, ${JSON.stringify(projectGame(midGame))})`);
		const copies = await copy(source, target);
		expect(copies.find((entry) => entry.table === "games")?.written).toBe(1);
		const [stored] = await all(target, sql`SELECT version, document FROM games WHERE game_pk = 777`);
		const snapshot = stored?.document as GameSnapshot;
		expect(stored?.version).toBe(41);
		expect(snapshot).toEqual({
			...final,
			version: 41,
		});
		// A viewer holding v40 takes the copied game (ADR-022): without the bump, v1 would be ignored.
		expect(applyIfNewer<{ version: number }>({
			version: 40,
		}, snapshot)).toBe(snapshot);
		const [projection] = await all(target, sql`SELECT version, document FROM game_projections WHERE game_pk = 777`);
		expect(projection).toEqual({
			version: 41,
			document: JSON.parse(JSON.stringify(projectGame(snapshot))),
		});
		expect(copies.find((entry) => entry.table === "game_projections")?.written).toBe(1);
	});

	it("v40 against v1, reversed: staging's game changed later at v1 is kept against production's v5 changed earlier", async () =>
	{
		const { db: source } = await migratedPglite();
		const { db: target } = await migratedPglite();
		await upsertGame(source, await recordedGame(777, 5, "2026-07-01T20:00:00.000Z", {
			officialDate: "production",
		}));
		const staging = await recordedGame(777, 1, "2026-07-02T03:00:00.000Z");
		await upsertGame(target, staging);
		const copies = await copy(source, target);
		expect(copies.find((entry) => entry.table === "games")).toMatchObject({
			written: 0,
			kept: {
				notLater: 1,
			},
		});
		expect(await all(target, sql`SELECT version, document FROM games`)).toEqual([{
			version: 1,
			document: JSON.parse(JSON.stringify(staging)),
		}]);
	});

	it("schedule days are compared by when they changed too, both ways", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		await target.execute(sql`INSERT INTO schedule_days (date, version, document) VALUES
			('2024-04-01', 30, ${stamped({
				date: "2024-04-01",
				games: [1],
			}, 30, "2024-04-01T12:00:00.000Z")}), ('2024-04-02', 1, ${stamped({
				date: "2024-04-02",
				games: [9],
			}, 1, "2024-04-09T00:00:00.000Z")})`);
		await copy(source, target);
		expect(await all(target, sql`SELECT date, version, document->'games' AS games FROM schedule_days ORDER BY date`)).toEqual([
			{
				date: "2024-04-01",
				version: 31,
				games: [1, 2],
			},
			{
				date: "2024-04-02",
				version: 1,
				games: [9],
			},
		]);
	});

	it("a game only production has is added at production's version, its projection built from it, and production's projection row never copied", async () =>
	{
		const source = await production();
		const game = await recordedGame(888, 7, "2026-07-02T03:00:00.000Z");
		await upsertGame(source, game);
		await source.execute(sql`INSERT INTO game_projections (game_pk, version, document) VALUES (888, 7, '{"marker":"production-only"}')`);
		const { db: target } = await migratedPglite();
		await copy(source, target);
		expect(await all(target, sql`SELECT version FROM games WHERE game_pk = 888`)).toEqual([{
			version: 7,
		}]);
		expect(await all(target, sql`SELECT version, document FROM game_projections WHERE game_pk = 888`)).toEqual([{
			version: 7,
			document: JSON.parse(JSON.stringify(projectGame(game))),
		}]);
		expect(await all(target, sql`SELECT game_pk FROM game_projections WHERE document->>'marker' IS NOT NULL`)).toEqual([]);
	});

	it("the same content under different counters writes nothing (target v1, production v40)", async () =>
	{
		const { db: source } = await migratedPglite();
		const { db: target } = await migratedPglite();
		const game = await recordedGame(777, 1, "2026-07-01T20:00:00.000Z");
		await upsertGame(target, game);
		await upsertGame(source, {
			...game,
			version: 40,
			lastChangedAt: "2026-07-02T03:00:00.000Z",
			fetchedAt: "2026-07-02T03:00:00.000Z",
		});
		const copies = await copy(source, target);
		expect(copies.find((entry) => entry.table === "games")).toMatchObject({
			written: 0,
			kept: {
				same: 1,
			},
		});
		expect(await all(target, sql`SELECT version FROM games`)).toEqual([{
			version: 1,
		}]);
	});

	it("a game staging's ingest may still be writing (in its active window, changed within the trail) is left to it", async () =>
	{
		const { db: source } = await migratedPglite();
		const { db: target } = await migratedPglite();
		await upsertGame(target, await recordedGame(777, 40, "2026-11-13T11:00:00.000Z", {
			windowMode: "active",
		}));
		await upsertGame(source, await recordedGame(777, 1, "2026-11-13T11:30:00.000Z", {
			officialDate: "production",
		}));
		const copies = await copy(source, target);
		expect(copies.find((entry) => entry.table === "games")).toMatchObject({
			written: 0,
			kept: {
				ingesting: 1,
			},
		});
		expect(await all(target, sql`SELECT version FROM games`)).toEqual([{
			version: 40,
		}]);
	});

	it("a target row with no readable change time is kept, and counted", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		await target.execute(sql`INSERT INTO games (game_pk, official_date, version, document) VALUES (1, '2024-04-01', 1, '{"gamePk":1,"note":"no time"}')`);
		const copies = await copy(source, target);
		expect(copies.find((entry) => entry.table === "games")).toMatchObject({
			written: 2,
			kept: {
				unreadable: 1,
			},
		});
		expect(await all(target, sql`SELECT document->>'note' AS note FROM games WHERE game_pk = 1`)).toEqual([{
			note: "no time",
		}]);
	});

	it("a row staging writes between the copy's read and its write keeps staging's write, and its projection is made from that write", async () =>
	{
		const { db: source } = await migratedPglite();
		const { db: target } = await migratedPglite();
		await upsertGame(target, await recordedGame(777, 40, "2026-07-01T20:00:00.000Z"));
		await upsertGame(source, await recordedGame(777, 1, "2026-07-02T03:00:00.000Z", {
			officialDate: "production",
		}));
		const ingested = await recordedGame(777, 41, "2026-07-02T04:00:00.000Z", {
			officialDate: "ingested meanwhile",
		});
		const copies = await copy(source, target, {
			beforeWrite: async (table) =>
			{
				if (table === "games") await upsertGame(target, ingested);
			},
		});
		expect(copies.find((entry) => entry.table === "games")).toMatchObject({
			written: 0,
			kept: {
				raced: 1,
			},
		});
		expect(await all(target, sql`SELECT version, official_date FROM games`)).toEqual([{
			version: 41,
			official_date: "ingested meanwhile",
		}]);
		// Its projection is made from staging's own row, the one the target holds, never from production's.
		expect(await all(target, sql`SELECT document FROM game_projections`)).toEqual([{
			document: JSON.parse(JSON.stringify(projectGame(ingested))),
		}]);
	});

	it("a game projectGame can't project is logged and counted, and the others are still built", async () =>
	{
		const source = await production();
		await upsertGame(source, await recordedGame(888, 7, "2026-07-02T03:00:00.000Z"));
		const { db: target } = await migratedPglite();
		const lines: string[] = [];
		const copies = await copy(source, target, {
			log: (line) => lines.push(line),
		});
		expect(copies.find((entry) => entry.table === "game_projections")).toMatchObject({
			written: 1,
			notBuilt: 3,
		});
		expect(lines.filter((line) => /^game \d+: projection not built: /.test(line)).length).toBe(3);
		expect(await all(target, sql`SELECT game_pk FROM game_projections`)).toEqual([{
			game_pk: 888,
		}]);
	});

	it("rebuilt projections are written under the byte cap too", async () =>
	{
		const { db: source } = await migratedPglite();
		await upsertGame(source, await recordedGame(801, 2, "2026-07-02T03:00:00.000Z"));
		await upsertGame(source, await recordedGame(802, 3, "2026-07-02T03:00:00.000Z"));
		const { db: target } = await migratedPglite();
		const copies = await copy(source, target, {
			batchBytes: 1,
		});
		expect(copies.find((entry) => entry.table === "game_projections")?.written).toBe(2);
		expect(await all(target, sql`SELECT game_pk, version FROM game_projections ORDER BY game_pk`)).toEqual([
			{
				game_pk: 801,
				version: 2,
			},
			{
				game_pk: 802,
				version: 3,
			},
		]);
	});

	it("replay artifacts are still compared by patch count, which means the same in both databases, and not restamped", async () =>
	{
		const source = await production();
		await source.execute(sql`INSERT INTO replay_artifacts (game_pk, version, document) VALUES (2, 5, '{"version":5}'), (3, 3, '{"version":3}')`);
		const { db: target } = await migratedPglite();
		await target.execute(sql`INSERT INTO replay_artifacts (game_pk, version, document) VALUES (2, 3, '{"version":3}'), (3, 5, '{"version":5}')`);
		await copy(source, target);
		expect(await all(target, sql`SELECT game_pk, version FROM replay_artifacts ORDER BY game_pk`)).toEqual([
			{
				game_pk: 1,
				version: 1,
			},
			{
				game_pk: 2,
				version: 5,
			},
			{
				game_pk: 3,
				version: 5,
			},
		]);
	});

	it("every table the manifest labels none has a copy rule, and one without a rule is refused before anything is written", () =>
	{
		expect(() => checkCopyRules(baseballTables())).not.toThrow();
		expect(() => checkCopyRules([...baseballTables(), "new_mlb_table"])).toThrow(/new_mlb_table: no copy rule/);
	});

	it("a table compared by change time with no document column on both sides is skipped with the reason", async () =>
	{
		const source = await production();
		await source.execute(sql`ALTER TABLE schedule_days DROP COLUMN document`);
		const { db: target } = await migratedPglite();
		await target.execute(sql`ALTER TABLE schedule_days ALTER COLUMN document DROP NOT NULL`);
		const copies = await copy(source, target);
		expect(copies.find((entry) => entry.table === "schedule_days")?.skipped).toBe("no document column on both sides, so when its rows last changed can't be read");
		expect(copies.find((entry) => entry.table === "games")?.written).toBe(3);
	});

	it("AC 3 ahead: a target with a column added by hand and a migration of its own keeps both and its rows, and gets production's", async () =>
	{
		const source = await production();
		await source.execute(sql`ALTER TABLE games ADD COLUMN production_only text`);
		await source.execute(sql`UPDATE games SET production_only = 'not copied'`);
		// Staging's own migration, which production hasn't had, touches no baseball table: a table of its own.
		const folder = migrationsWith([{
			tag: "0001_staging_only",
			sql: "CREATE TABLE \"staging_only\" (\"id\" integer PRIMARY KEY, \"version\" integer NOT NULL);",
			when: FIRST_WHEN + 1,
		}]);
		const target = await migratedFrom(folder);
		// A column added by hand (no migration), and rows of staging's own.
		await target.execute(sql`ALTER TABLE games ADD COLUMN staging_note text`);
		await target.execute(sql`INSERT INTO staging_only VALUES (1, 1)`);
		await target.execute(sql`INSERT INTO games (game_pk, official_date, version, document, staging_note) VALUES (999, '2030-01-01', 1, '{"gamePk":999}', 'mine')`);
		// A row both sides have, changed earlier on staging: production's columns win, staging's own column keeps its value.
		await target.execute(sql`INSERT INTO games (game_pk, official_date, version, document, staging_note) VALUES (1, '2024-04-01', 0, ${stamped({
			gamePk: 1,
			note: "old",
		}, 0, "2024-04-01T00:00:00.000Z")}, 'kept')`);
		await forbid(target, [...baseballTables(), "staging_only"], ["DELETE", "TRUNCATE"]);
		const order: string[] = [];
		const copies = await copy(source, target, {
			migrationsFolder: folder,
			migrateTarget: async (from) =>
			{
				order.push(`migrate ${from}`);
				await migrating(target)(from);
			},
			log: (line) => order.push(line),
		});
		expect(order[0]).toBe(`migrate ${folder}`);
		expect(copies.find((entry) => entry.table === "games")).toMatchObject({
			read: 3,
			written: 3,
			sourceOnlyColumns: ["production_only"],
			targetOnlyColumns: ["staging_note"],
		});
		expect(await all(target, sql`SELECT game_pk, version, staging_note FROM games ORDER BY game_pk`)).toEqual([
			{
				game_pk: 1,
				version: 1,
				staging_note: "kept",
			},
			{
				game_pk: 2,
				version: 5,
				staging_note: null,
			},
			{
				game_pk: 3,
				version: 2,
				staging_note: null,
			},
			{
				game_pk: 999,
				version: 1,
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
		const copies = await copy(source, target);
		expect(copies.find((entry) => entry.table === "replay_artifacts")?.skipped).toBe("production has no such table");
		expect(copies.find((entry) => entry.table === "game_projections")?.skipped).toBe("the target has no such table");
		expect(await all(target, sql`SELECT to_regclass('public.game_projections') AS t`)).toEqual([{
			t: null,
		}]);
	});

	it("AC 3 ahead: a target-only column that is required with a default gets its default", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		await target.execute(sql`ALTER TABLE games ADD COLUMN staging_flag text NOT NULL DEFAULT 'd'`);
		await copy(source, target);
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
		const copies = await copy(source, target, {
			log: (line) => lines.push(line),
		});
		expect(copies.find((entry) => entry.table === "games")).toMatchObject({
			read: 0,
			written: 0,
			skipped: "the target's column required_note is required (NOT NULL, no default) and production has no values for it",
		});
		expect(lines.find((line) => line.startsWith("games:"))).toContain("none of production's rows copied");
		expect(copies.find((entry) => entry.table === "game_projections")?.skipped).toBe("its games weren't copied");
		expect(await dump(target, "games")).toEqual([]);
		for (const table of COPIED_TABLES.filter((name) => name !== "games")) expect(await dump(target, table)).toEqual(await dump(source, table));
	});

	it("AC 3 ahead: a column the target generates is left to the target, not written", async () =>
	{
		const source = await production();
		await source.execute(sql`ALTER TABLE games ADD COLUMN derived integer`);
		await source.execute(sql`UPDATE games SET derived = 77`);
		const { db: target } = await migratedPglite();
		await target.execute(sql`ALTER TABLE games ADD COLUMN derived integer GENERATED ALWAYS AS (version * 2) STORED`);
		const copies = await copy(source, target);
		expect(copies.find((entry) => entry.table === "games")).toMatchObject({
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

	it("AC 3 ahead: an unmigrated target is migrated, from the folder the copy compares against, before anything is copied", async () =>
	{
		const source = await production();
		const target = drizzlePglite(new PGlite()) as unknown as PostgresDb;
		const folders: string[] = [];
		await copy(source, target, {
			migrateTarget: async (folder) =>
			{
				folders.push(folder);
				await migrating(target)(folder);
			},
		});
		expect(folders).toEqual([MIGRATIONS_FOLDER]);
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
		await copy(source, target);
		expect(await Promise.all(tables.map((table) => dump(source, table)))).toEqual(before);
		expect(await all(source, sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`)).toEqual(migrations);
	});

	it("AC 3 production unchanged: every production read runs in its own read-only transaction, safe through a pooler, and nothing is set on its session", async () =>
	{
		const production_ = await production();
		const { db: source, seen } = watchSource(production_);
		const { db: target } = await migratedPglite();
		await copy(source, target);
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
		await expect(copy(source, target)).rejects.toThrow(/replay_artifacts: no version column/);
		const { db: noKey } = await migratedPglite();
		await noKey.execute(sql`ALTER TABLE schedule_days DROP CONSTRAINT schedule_days_pkey`);
		await expect(copy(await production(), noKey)).rejects.toThrow(/schedule_days: the copy needs one primary-key column/);
	});
	it("a copy stopped between a game and its projection is finished by the next copy", async () =>
	{
		const { db: source } = await migratedPglite();
		const { db: target } = await migratedPglite();
		const midGame = await recordedGame(777, 40, "2026-07-01T20:00:00.000Z");
		await upsertGame(target, midGame);
		await target.execute(sql`INSERT INTO game_projections (game_pk, version, document) VALUES (777, 40, ${JSON.stringify(projectGame(midGame))})`);
		await upsertGame(source, await recordedGame(777, 1, "2026-07-02T03:00:00.000Z", {
			officialDate: "production",
		}));
		await expect(copy(source, target, {
			beforeWrite: async (table) =>
			{
				if (table === "game_projections") throw new Error("connection dropped");
			},
		})).rejects.toThrow(/connection dropped/);
		const projections = new PostgresGameProjectionRepository(target);
		const [stopped] = await all(target, sql`SELECT document FROM games`);
		expect(await isProjectionCurrent({
			projections,
		}, stopped?.document as GameSnapshot)).toBe(false);
		const again = await copy(source, target);
		expect(again.find((entry) => entry.table === "game_projections")?.written).toBe(1);
		const [stored] = await all(target, sql`SELECT version, document FROM games`);
		expect(stored?.version).toBe(41);
		expect(await isProjectionCurrent({
			projections,
		}, stored?.document as GameSnapshot)).toBe(true);
	});

	it("a projection staging's ingest writes just before the copy's keeps ingest's, and counts as left newer", async () =>
	{
		const { db: source } = await migratedPglite();
		const { db: target } = await migratedPglite();
		await upsertGame(target, await recordedGame(777, 40, "2026-07-01T20:00:00.000Z"));
		await upsertGame(source, await recordedGame(777, 1, "2026-07-02T03:00:00.000Z", {
			officialDate: "production",
		}));
		const ingested = await recordedGame(777, 42, "2026-07-02T04:00:00.000Z", {
			officialDate: "ingested meanwhile",
		});
		const copies = await copy(source, target, {
			beforeWrite: async (table) =>
			{
				if (table !== "game_projections") return;
				await upsertGame(target, ingested);
				await new PostgresGameProjectionRepository(target).upsert(projectGame(ingested));
			},
		});
		expect(copies.find((entry) => entry.table === "game_projections")).toMatchObject({
			written: 0,
			leftNewer: 1,
		});
		expect(await all(target, sql`SELECT version, document FROM game_projections`)).toEqual([{
			version: 42,
			document: JSON.parse(JSON.stringify(projectGame(ingested))),
		}]);
	});

	it("a game staging's ingest adds between the copy's read and its write keeps staging's row, and its projection is made from that row", async () =>
	{
		const { db: source } = await migratedPglite();
		const { db: target } = await migratedPglite();
		await upsertGame(source, await recordedGame(777, 5, "2026-07-01T20:00:00.000Z", {
			officialDate: "production",
		}));
		const ingested = await recordedGame(777, 1, "2026-07-02T03:00:00.000Z", {
			officialDate: "ingested meanwhile",
		});
		const copies = await copy(source, target, {
			beforeWrite: async (table) =>
			{
				if (table === "games") await upsertGame(target, ingested);
			},
		});
		expect(copies.find((entry) => entry.table === "games")).toMatchObject({
			written: 0,
			kept: {
				raced: 1,
			},
		});
		expect(await all(target, sql`SELECT version, official_date FROM games`)).toEqual([{
			version: 1,
			official_date: "ingested meanwhile",
		}]);
		expect(await all(target, sql`SELECT document FROM game_projections`)).toEqual([{
			document: JSON.parse(JSON.stringify(projectGame(ingested))),
		}]);
	});

	it("a row gone from the target between the copy's two reads counts as raced, not new", async () =>
	{
		const { db: source } = await migratedPglite();
		const { db: plain } = await migratedPglite();
		await upsertGame(plain, await recordedGame(777, 40, "2026-07-01T20:00:00.000Z"));
		await upsertGame(source, await recordedGame(777, 1, "2026-07-02T03:00:00.000Z"));
		const { db: target } = watchTarget(plain, async (text) =>
		{
			if (/^select "game_pk"::text as k, version, document from "games"/i.test(text)) await plain.execute(sql`DELETE FROM games`);
		});
		const copies = await copy(source, target);
		expect(copies.find((entry) => entry.table === "games")).toMatchObject({
			written: 0,
			kept: {
				raced: 1,
			},
		});
	});

	it("rebuilt projections are written one statement per byte-capped run", async () =>
	{
		const { db: source } = await migratedPglite();
		await upsertGame(source, await recordedGame(801, 2, "2026-07-02T03:00:00.000Z"));
		await upsertGame(source, await recordedGame(802, 3, "2026-07-02T03:00:00.000Z"));
		const { db: plain } = await migratedPglite();
		const { db: target, statements } = watchTarget(plain);
		await copy(source, target, {
			batchRows: 100,
			batchBytes: 1,
		});
		expect(statements.filter((text) => /^INSERT INTO "game_projections"/.test(text)).length).toBe(2);
	});

	it("the target documents compared for adoption are read under the byte cap", async () =>
	{
		// Production's rows are small and fit one page; staging's documents (a recorded game each) are each bigger than the cap.
		const source = await production();
		const fullReads = async (batchBytes: number) =>
		{
			const { db: plain } = await migratedPglite();
			for (const gamePk of [1, 2]) await upsertGame(plain, await recordedGame(gamePk, 4, "2024-04-01T00:00:00.000Z"));
			const { db: target, statements } = watchTarget(plain);
			const copies = await copy(source, target, {
				batchBytes,
			});
			expect(copies.find((entry) => entry.table === "games")?.written).toBe(3);
			return statements.filter((text) => /^SELECT "game_pk"::text AS k, version, document FROM "games"/.test(text)).length;
		};
		expect(await fullReads(10_000)).toBe(2);
		expect(await fullReads(1e9)).toBe(1);
	});

	it("games are skipped whenever their projections can't be rebuilt into a game_projections the target has", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		await target.execute(sql`ALTER TABLE game_projections ADD COLUMN staging_required text NOT NULL`);
		const copies = await copy(source, target);
		expect(copies.find((entry) => entry.table === "game_projections")?.skipped).toBe("the target's column staging_required is required (NOT NULL, no default) and a rebuilt projection has no value for it");
		expect(copies.find((entry) => entry.table === "games")?.skipped).toBe("its projections can't be rebuilt (the target's column staging_required is required (NOT NULL, no default) and a rebuilt projection has no value for it)");
		expect(await dump(target, "games")).toEqual([]);
	});

	it("copyBaseballData checks the copy rules before it migrates or touches anything", async () =>
	{
		const tables = DATA_CLASSIFICATION.postgresTables as Record<string, unknown>;
		tables.new_mlb_table = {
			kind: "none",
			why: "a test's table",
		};
		try
		{
			const migrateTarget = vi.fn(noMigration);
			await expect(copy(await production(), (await migratedPglite()).db, {
				migrateTarget,
			})).rejects.toThrow(/new_mlb_table: no copy rule/);
			expect(migrateTarget).not.toHaveBeenCalled();
		}
		finally
		{
			delete tables.new_mlb_table;
		}
	});

	it("the copy rules need projections to come after their games", () =>
	{
		expect(() => checkCopyRules(["schedule_days", "game_projections", "games", "replay_artifacts"])).toThrow(/game_projections: must come after games/);
	});
});

describe("copyBaseballData: tables a migration production hasn't run touched (owner, 2026-11-13: option b)", () =>
{
	it("a staging-only migration that reshapes games skips games and their projections, names it, and copies the rest", async () =>
	{
		const source = await production();
		const folder = migrationsWith([{
			tag: "0001_reshape_games",
			sql: "ALTER TABLE \"games\" ADD COLUMN \"flags\" text;\n--> statement-breakpoint\nUPDATE \"games\" SET \"document\" = jsonb_set(\"document\", '{format}', '2');",
			when: FIRST_WHEN + 1,
		}]);
		const target = await migratedFrom(folder);
		await target.execute(sql`INSERT INTO games (game_pk, official_date, version, document) VALUES (1, '2024-04-01', 1, ${stamped({
			gamePk: 1,
			format: 2,
		}, 1, "2024-04-01T00:00:00.000Z")})`);
		const before = await dump(target, "games");
		const lines: string[] = [];
		const copies = await copy(source, target, {
			migrationsFolder: folder,
			log: (line) => lines.push(line),
		});
		expect(copies.find((entry) => entry.table === "games")?.skipped).toBe("the target has migration 0001_reshape_games that production hasn't run, and it touches games");
		expect(copies.find((entry) => entry.table === "game_projections")?.skipped).toBe("its games weren't copied");
		expect(lines).toContain("migrations only the target has: 0001_reshape_games (touches games)");
		expect(await dump(target, "games")).toEqual(before);
		for (const table of ["schedule_days", "replay_artifacts"]) expect(await dump(target, table)).toEqual(await dump(source, table));
	});

	it("a staging-only migration touching only game_projections skips games too, since a copied game needs its projection rebuilt", async () =>
	{
		const source = await production();
		const folder = migrationsWith([{
			tag: "0001_projection_index",
			sql: "CREATE INDEX \"projections_version\" ON \"game_projections\" USING btree (\"version\");",
			when: FIRST_WHEN + 1,
		}]);
		const target = await migratedFrom(folder);
		const copies = await copy(source, target, {
			migrationsFolder: folder,
		});
		expect(copies.find((entry) => entry.table === "game_projections")?.skipped).toBe("the target has migration 0001_projection_index that production hasn't run, and it touches game_projections");
		expect(copies.find((entry) => entry.table === "games")?.skipped).toBe("its projections (game_projections) are touched by migration 0001_projection_index, which production hasn't run");
		expect(await dump(target, "games")).toEqual([]);
		expect(await dump(target, "schedule_days")).toEqual(await dump(source, "schedule_days"));
	});

	it("refuses, writing nothing, when the target has run a migration this checkout doesn't have", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		await target.execute(sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('from-elsewhere', 99999999999999)`);
		await forbid(target, baseballTables(), ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]);
		const failure = copy(source, target);
		await expect(failure).rejects.toBeInstanceOf(CopyRefused);
		await expect(failure).rejects.toThrow(/the target has run migration created_at 99999999999999 \(hash from-elsewhere\), which this checkout doesn't have/);
	});

	it("refuses a target record whose time matches a committed migration but whose hash doesn't", async () =>
	{
		const source = await production();
		const { db: target } = await migratedPglite();
		await target.execute(sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('edited-elsewhere', ${FIRST_WHEN})`);
		await forbid(target, baseballTables(), ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]);
		await expect(copy(source, target)).rejects.toThrow(new RegExp(`the target has run migration created_at ${FIRST_WHEN} \\(hash edited-elsewhere\\)`));
	});

	it("skips every table when production has run a migration this checkout doesn't have", async () =>
	{
		const source = await production();
		await source.execute(sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('production-ahead', 99999999999999)`);
		const { db: target } = await migratedPglite();
		const copies = await copy(source, target);
		for (const entry of copies)
		{
			expect(entry.skipped).toBe("production has run migration created_at 99999999999999, which this checkout doesn't have; run the copy from a ref that has it");
		}
		for (const table of baseballTables()) expect(await dump(target, table)).toEqual([]);
	});

	it("names both migrations when the target never ran one this checkout has, because it had already run a newer one", async () =>
	{
		const skippedOne = {
			tag: "0001_skipped",
			sql: "CREATE TABLE \"skipped\" (\"id\" integer PRIMARY KEY);",
			when: FIRST_WHEN + 1,
		};
		const newer = {
			tag: "0002_newer",
			sql: "CREATE TABLE \"newer\" (\"id\" integer PRIMARY KEY);",
			when: FIRST_WHEN + 2,
		};
		const source = await production(await migratedFrom(migrationsWith([skippedOne])));
		const target = await migratedFrom(migrationsWith([newer]));
		const folder = migrationsWith([skippedOne, newer]);
		const copies = await copy(source, target, {
			migrationsFolder: folder,
			migrateTarget: migrating(target),
		});
		for (const entry of copies)
		{
			expect(entry.skipped).toBe("the target never ran migration 0001_skipped although this checkout has it, because it had already run the newer migration 0002_newer (drizzle runs only migrations newer than the last it ran)");
		}
	});

	it("a migration recorded with the same time but a different hash counts as one production hasn't run", async () =>
	{
		const edited = {
			tag: "0001_edited",
			sql: "ALTER TABLE \"replay_artifacts\" ADD COLUMN \"note\" text;",
			when: FIRST_WHEN + 1,
		};
		const source = await production(await migratedFrom(migrationsWith([edited])));
		const folder = migrationsWith([{
			...edited,
			sql: `${edited.sql}\n-- edited after production ran it`,
		}]);
		const target = await migratedFrom(folder);
		const lines: string[] = [];
		await copy(source, target, {
			migrationsFolder: folder,
			log: (line) => lines.push(line),
		});
		expect(lines).toContain("migrations only the target has: 0001_edited (touches replay_artifacts)");
		const copies = await copy(source, target, {
			migrationsFolder: folder,
		});
		for (const entry of copies)
		{
			expect(entry.skipped).toBe(`production has run migration created_at ${FIRST_WHEN + 1}, which this checkout doesn't have; run the copy from a ref that has it`);
		}
	});
});

describe("tablesNamedIn", () =>
{
	const TABLES = ["schedule_days", "games", "game_projections", "replay_artifacts"];

	it("finds a table named quoted, bare, schema-qualified, in any case, or in a comment", () =>
	{
		for (const text of ["ALTER TABLE \"games\" ADD COLUMN x text", "UPDATE public.games SET x = 1", "update GAMES set x = 1", "-- games", "CREATE INDEX i ON \"games\" (x)"])
		{
			expect(tablesNamedIn(text, TABLES)).toEqual(["games"]);
		}
	});

	it("doesn't take a longer name that starts or ends with it", () =>
	{
		for (const text of ["CREATE TABLE old_games (x int)", "SELECT $games", "SELECT xgames", "SELECT games2"]) expect(tablesNamedIn(text, TABLES)).toEqual([]);
		expect(tablesNamedIn("CREATE INDEX \"games_official_date\" ON \"game_projections\" (x)", TABLES)).toEqual(["game_projections"]);
	});

	it("finds every baseball table in the committed initial migration", () =>
	{
		expect(tablesNamedIn(readFileSync(join(MIGRATIONS_FOLDER, "0000_initial.sql"), "utf8"), TABLES)).toEqual(TABLES);
	});
});
