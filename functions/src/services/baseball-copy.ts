/**
 * Copying production's baseball data into another database (S117; owner, 2026-11-05: "No user
 * data, copied baseball data"). `pnpm db:copy-baseball` (src/scripts/db-copy-baseball.ts) runs it
 * by hand, never as a deploy step, so whatever someone is trying on staging isn't overwritten
 * between copies (owner: "it should be a manual step (to allow for local iteration not getting
 * stomped)").
 *
 * What it copies is decided by the data classification manifest alone (ADR-028): the Postgres
 * tables labeled `none` (MLB schedules, games, projections, replay artifacts). Personal tables and
 * the deletion log (`retained`) are never read from production and never written to the target,
 * so no fan's row reaches staging, not even for a moment. A table added later is copied only once
 * the manifest labels it `none` and `COPY_RULES` says how its rows are compared; a `none` table with
 * no rule stops the copy before it touches anything.
 *
 * It only adds (owner, 2026-11-05: "if I make changes to data and schemas that's different from
 * production, it'll need to have data in staging that isn't present in production"):
 * - nothing in the target is deleted, truncated or dropped; rows only the target has stay;
 * - only the columns both sides have are copied, so a column only the target has keeps its values,
 *   a column only production has is skipped, and a table either side lacks is skipped (a column a
 *   target-only change renamed gets nothing from production under its new name);
 * - a column the target generates (`GENERATED ALWAYS`, stored or identity) is left to the
 *   target; a target-only column that is required with no default (NOT NULL, nothing to fill it)
 *   makes that table be skipped with the reason, getting none of production's rows, and the
 *   other tables are still copied.
 *
 * Which row is newer is decided per table by `COPY_RULES` (owner, 2026-11-13, after Claude's review
 * of PR #21: "option A"), never by comparing `version` between the two databases: each database
 * counts its own versions (`stampVersion`), so production's v1 can be newer than staging's v40.
 * - Schedule days and games compare when their content last changed (`lastChangedAt`;
 *   `compareAcrossStores` / `adoptAcrossStores`, the one implementation, in `@bt/domain`). A row
 *   production changed strictly later replaces the target's at the target's version + 1, so the
 *   target's counter only moves forward and its hub, clients and next ingest poll keep applying
 *   only what is newer (ADR-022). The write itself is still guarded inside the target
 *   (`excluded.version > <table>.version`), so a row the target's ingest writes between the copy's
 *   read and its write keeps ingest's write. An ingest write that read the row before the copy's
 *   write and lands after it at the same version is dropped instead, and its projection may land
 *   in place of the copy's; ingest's next change restamps both (the race `INGEST_OWNS_MS` accepts).
 *   A row in its active window that changed within the trail plus an hour (`INGEST_OWNS_MS`) is
 *   left to the target's ingest. A tie, the same content, or a time that can't be read keeps the
 *   target's row. An adopted schedule day can carry an older `fetchedAt` than the target's, so the
 *   month view's oldest-fetch figure may move back: that costs one extra refresh, nothing more.
 * - Game projections are never copied: for every game production's pages name whose projection
 *   in the target isn't current (every game the copy writes, and any a stopped copy left behind),
 *   it is rebuilt from the target's game with `projectGame` (the target's code), written under the
 *   same guard; a game `projectGame` can't project is logged and counted, and the copy carries on.
 *   Games are skipped whenever the target's `game_projections` can't take their projections.
 * - Replay artifacts compare `version`, which for them is the number of retained patches and so
 *   means the same in both databases; it isn't restamped.
 *
 * A table a migration production hasn't run touched is skipped whole (owner, 2026-11-13: "I think
 * option b is better"): staging may have reshaped it, and production's rows are in the old shape.
 * The copy compares the two databases' migration records (drizzle's `__drizzle_migrations`) and
 * reads each target-only migration's SQL from the checkout (`readMigrationFiles`, as the migrator
 * does), skipping every baseball table its text names (`tablesNamedIn`; a word search, so it errs
 * toward skipping). Its blind spots are SQL that touches a table without naming it: dynamic SQL
 * (`EXECUTE format(...)`) and `ALTER TYPE` / `ALTER DOMAIN` on a type a table's column uses. Games
 * and their projections move together. A target-only migration this checkout doesn't have makes
 * the copy refuse (`CopyRefused`), since nothing can say what it changed; a production-only one
 * skips every table. It runs only by hand (owner, 2026-11-13: "I want it to be a manual thing for
 * now").
 *
 * The caller migrates the target first (`migrateTarget`) and production never. Every read of
 * production runs in a transaction of its own made read-only before it reads anything, so it
 * holds through Neon's pooler (PgBouncer, transaction mode), where a session setting could land
 * on one server connection and the next statement on another; nothing is set on production's
 * session, which a pooler could otherwise leave on a connection production's own clients reuse.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GameSnapshot, VersionStamp } from "@bt/domain";
import {
	adoptAcrossStores, compareAcrossStores, projectGame,
} from "@bt/domain";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { MIGRATIONS_FOLDER } from "../adapters/postgres/migrate.js";
import type { PostgresDb } from "../adapters/postgres/repos.js";
import { DATA_CLASSIFICATION } from "./data-classification.js";

/** At most this many rows are read and written per statement (the page's row cap). */
export const COPY_BATCH_ROWS = 100;

/**
 * And at most about this many bytes of JSON per page (the byte cap; one row more than the cap
 * when a single row is larger). Game documents and replay artifacts run to megabytes each, so
 * the row cap alone could make one page's JSON text hundreds of MB, past what one string or one
 * Postgres value can hold, failing at the same page on every try.
 */
export const COPY_BATCH_BYTES = 16 * 1024 * 1024;

/**
 * The tables the copy may touch: every Postgres table the manifest labels `none`, in manifest
 * order. Personal and retained tables are not in this list, so the copy has no way to name them.
 */
export function baseballTables(): string[]
{
	return Object.entries(DATA_CLASSIFICATION.postgresTables)
		.filter(([, label]) => label.kind === "none")
		.map(([table]) => table);
}

/**
 * How each table's rows are compared between the two databases (see the module comment). Every table the manifest
 * labels `none` must have one (`checkCopyRules`), so a table added later can't fall back to comparing two
 * databases' counters. `rebuiltFromGames` assumes the `games` table and a projection per `game_pk`.
 */
export type CopyRule = "changedLater" | "rebuiltFromGames" | "patchCount";

export const COPY_RULES: Readonly<Record<string, CopyRule>> = {
	schedule_days: "changedLater",
	games: "changedLater",
	game_projections: "rebuiltFromGames",
	replay_artifacts: "patchCount",
};

/**
 * Throws, before anything is read or written, when one of `tables` has no copy rule, or a table rebuilt from the
 * games comes before `games` (its rebuild counts are gathered during the games pass).
 */
export function checkCopyRules(tables: readonly string[]): void
{
	for (const [index, table] of tables.entries())
	{
		const rule = COPY_RULES[table];
		if (!rule) throw new Error(`${table}: no copy rule (COPY_RULES in baseball-copy.ts) says how its rows are compared between two databases`);
		if (rule === "rebuiltFromGames" && !tables.slice(0, index).includes("games")) throw new Error(`${table}: must come after games, whose copied rows it is rebuilt from`);
	}
}

/** The copy refused to run, having written no row: `runCopy` reports it and exits 2. */
export class CopyRefused extends Error
{
	override name = "CopyRefused";
}

/** Why a row both databases have was left as the target holds it (`compareAcrossStores`, plus a lost race). */
export type KeptReason = "same" | "notLater" | "ingesting" | "unreadable" | "raced";

const KEPT_WORDS: Record<KeptReason, string> = {
	same: "the same content",
	notLater: "not changed later in production",
	ingesting: "being ingested on the target",
	unreadable: "no readable change time",
	raced: "written on the target meanwhile",
};

/** What happened to one table: rows read from production, rows inserted or updated in the target, or why it was skipped. */
export type TableCopy = {
	table: string;
	read: number;
	/** Rows inserted or updated; for `game_projections`, projections rebuilt from the games written. */
	written: number;
	/** Rows production also has that the target kept, by why. */
	kept: Partial<Record<KeptReason, number>>;
	/** `game_projections` only: games `projectGame` couldn't project, and projections the target already held at a higher version. */
	notBuilt?: number;
	leftNewer?: number;
	/** Why the table got none of production's rows, when it didn't. */
	skipped?: string;
	/** Production's columns the target lacks (left out), and the target's that production lacks (left as they are). */
	sourceOnlyColumns: string[];
	targetOnlyColumns: string[];
	/** Columns both sides have that the target generates itself, so they are left to the target. */
	generatedColumns: string[];
};

export type CopyDeps = {
	/** Production (or whatever is copied from); only read, each read in its own read-only transaction. */
	source: PostgresDb;
	/** The database written; migrated by `migrateTarget` before anything is read or written. */
	target: PostgresDb;
	/**
	 * Applies the migrations in `migrationsFolder` to the target (`migratePostgres`). It is handed the same folder the
	 * copy reads to compare the two databases' migration records, so the two can't disagree.
	 */
	migrateTarget: (migrationsFolder: string) => Promise<void>;
	/** The checkout's migrations ({@link MIGRATIONS_FOLDER}); tests pass a folder with migrations of their own. */
	migrationsFolder?: string;
	log?: (line: string) => void;
	/** The page's row cap ({@link COPY_BATCH_ROWS}) and byte cap ({@link COPY_BATCH_BYTES}); tests shrink them. */
	batchRows?: number;
	batchBytes?: number;
	/** The time a row's active window is judged against (`compareAcrossStores`). */
	now?: () => Date;
	/** Runs after a page is decided and before it is written: tests write the target here, as its ingest could. */
	beforeWrite?: (table: string) => Promise<void>;
};

/** Runs one statement; a database or a transaction. */
type Runs = Pick<PostgresDb, "execute">;

async function rows<T extends Record<string, unknown>>(db: Runs, query: SQL): Promise<T[]>
{
	return (await db.execute(query) as unknown as { rows: T[] }).rows;
}

/**
 * Reads production: `query` alone in a transaction made read-only before it runs, so a write
 * can't happen even by mistake, and the guard and the read share one server connection even
 * through a pooler. Nothing outlives the transaction.
 */
async function readSource<T extends Record<string, unknown>>(source: PostgresDb, query: SQL): Promise<T[]>
{
	return source.transaction(async (tx) =>
	{
		await tx.execute(sql`SET TRANSACTION READ ONLY`);
		return rows<T>(tx, query);
	});
}

/** One column of a `public` table, with what the copy needs to know to write it. */
type Column = {
	name: string;
	/** NOT NULL with no default, and not generated: an insert that leaves it out fails. */
	required: boolean;
	/** The database fills it (`GENERATED ALWAYS`, stored or identity): an insert that names it fails. */
	generated: boolean;
};

/** The query for a `public` table's columns, in table order; empty when the table doesn't exist. */
function columnsQuery(table: string): SQL
{
	return sql`SELECT column_name AS name,
		(is_nullable = 'NO' AND column_default IS NULL AND is_generated = 'NEVER' AND is_identity = 'NO') AS required,
		(is_generated = 'ALWAYS' OR identity_generation = 'ALWAYS') AS generated
		FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY ordinal_position`;
}

/** The target table's primary key columns with their SQL types, from the catalog. */
async function primaryKeyOf(db: PostgresDb, table: string): Promise<{ name: string;
	type: string; }[]>
{
	return rows<{ name: string;
		type: string; }>(db, sql`SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
		FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
		WHERE i.indrelid = to_regclass(${`public.${table}`}) AND i.indisprimary`);
}

const list = (names: string[]) => sql.join(names.map((name) => sql.identifier(name)), sql`, `);

/**
 * The baseball tables `text` (a migration's SQL) names: each as a whole word, in any case, quoted or bare,
 * schema-qualified or not, comments included. It errs toward finding a table (a JSON path `'{games}'` counts), which
 * only skips a table for one copy; it can't see SQL that touches a table without naming it (see the module comment).
 */
export function tablesNamedIn(text: string, tables: readonly string[]): string[]
{
	return tables.filter((table) => new RegExp(`(?<![A-Za-z0-9_$])${table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_$])`, "i").test(text));
}

/** One applied migration, as drizzle records it: the journal's `when`, and the sha256 of its SQL file. */
type Applied = { createdAt: number;
	hash: string; };

/** The migrations `read` (a database) has applied; none when it has no drizzle record. */
async function appliedMigrations(read: <T extends Record<string, unknown>>(query: SQL) => Promise<T[]>): Promise<Applied[]>
{
	const [record] = await read<{ present: boolean }>(sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`);
	if (!record?.present) return [];
	const found = await read<{ created_at: string;
		hash: string; }>(sql`SELECT created_at::text AS created_at, hash FROM drizzle.__drizzle_migrations ORDER BY created_at`);
	return found.map((row) => ({
		createdAt: Number(row.created_at),
		hash: row.hash,
	}));
}

/** What the two databases' migration records say: every table to skip with why, or why to skip them all. */
type MigrationVerdict = {
	skipAll?: string;
	/** A baseball table and the first target-only migration that names it. */
	touchedBy: Map<string, string>;
};

/**
 * Compares the migrations each database has run, after the target is migrated (owner, 2026-11-13: option b). The
 * checkout's files are read the way drizzle's migrator reads them (`readMigrationFiles`: `folderMillis` and the hash
 * of the SQL), so a record matches a file exactly when the migrator would call it that file.
 */
async function compareMigrations(deps: CopyDeps, folder: string, tables: string[], log: (line: string) => void): Promise<MigrationVerdict>
{
	const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as { entries: { when: number;
		tag: string; }[]; };
	const committed = readMigrationFiles({
		migrationsFolder: folder,
	}).map((file) => ({
		createdAt: file.folderMillis,
		hash: file.hash,
		sql: file.sql.join("\n"),
		name: journal.entries.find((entry) => entry.when === file.folderMillis)?.tag ?? `created_at ${file.folderMillis}`,
	}));
	const inProduction = await appliedMigrations((query) => readSource(deps.source, query));
	const inTarget = await appliedMigrations((query) => rows(deps.target, query));
	const key = (migration: Applied) => `${migration.createdAt}:${migration.hash}`;
	const fileOf = (migration: Applied) => committed.find((file) => file.createdAt === migration.createdAt && file.hash === migration.hash);
	const productionKeys = new Set(inProduction.map(key));
	const targetKeys = new Set(inTarget.map(key));

	const touchedBy = new Map<string, string>();
	const described: string[] = [];
	for (const migration of inTarget.filter((applied) => !productionKeys.has(key(applied))))
	{
		const file = fileOf(migration);
		if (!file)
		{
			throw new CopyRefused(`the target has run migration created_at ${migration.createdAt} (hash ${migration.hash}), which this checkout doesn't have, so the copy can't tell which tables it changed; nothing was copied. Run the copy from a ref that has that migration, or take it out of the target`);
		}
		const touched = tablesNamedIn(file.sql, tables);
		for (const table of touched) if (!touchedBy.has(table)) touchedBy.set(table, file.name);
		described.push(`${file.name} (${touched.length ? `touches ${touched.join(", ")}` : "touches no baseball table"})`);
	}
	if (described.length) log(`migrations only the target has: ${described.join("; ")}`);

	const [behind] = inProduction.filter((applied) => !targetKeys.has(key(applied)));
	if (!behind) return {
		touchedBy,
	};
	const file = fileOf(behind);
	const newest = inTarget.at(-1);
	const newestName = newest ? fileOf(newest)?.name ?? `created_at ${newest.createdAt}` : "none";
	return {
		touchedBy,
		skipAll: file
			? `the target never ran migration ${file.name} although this checkout has it, because it had already run the newer migration ${newestName} (drizzle runs only migrations newer than the last it ran)`
			: `production has run migration created_at ${behind.createdAt}, which this checkout doesn't have; run the copy from a ref that has it`,
	};
}

/** A table's columns on both sides, and how a page of it is written. */
type Shape = {
	common: string[];
	key: { name: string;
		type: string; };
};

/** Works out what of `table` can be copied: its shape, or the entry saying why it is skipped. Throws when a write couldn't be guarded. */
async function shapeOf(deps: CopyDeps, table: string, rule: CopyRule): Promise<{ result: TableCopy;
	shape?: Shape; }>
{
	const sourceColumns = (await readSource<Column>(deps.source, columnsQuery(table))).map((column) => column.name);
	const targetInfo = await rows<Column>(deps.target, columnsQuery(table));
	const targetColumns = targetInfo.map((column) => column.name);
	const generated = targetInfo.filter((column) => column.generated && sourceColumns.includes(column.name)).map((column) => column.name);
	const common = sourceColumns.filter((column) => targetColumns.includes(column) && !generated.includes(column));
	const result: TableCopy = {
		table,
		read: 0,
		written: 0,
		kept: {},
		sourceOnlyColumns: sourceColumns.filter((column) => !targetColumns.includes(column)),
		targetOnlyColumns: targetColumns.filter((column) => !sourceColumns.includes(column)),
		generatedColumns: generated,
	};
	const skip = (why: string) => ({
		result: {
			...result,
			skipped: why,
		},
	});
	if (sourceColumns.length === 0) return skip("production has no such table");
	if (targetColumns.length === 0) return skip("the target has no such table");
	const keys = await primaryKeyOf(deps.target, table);
	const [key] = keys;
	if (keys.length !== 1 || !key || !common.includes(key.name))
	{
		throw new Error(`${table}: the copy needs one primary-key column both databases have, not generated by the target (found ${keys.map((k) => k.name).join(", ") || "none"})`);
	}
	if (!common.includes("version")) throw new Error(`${table}: no version column on both sides (not generated by the target), so a write can't be version-guarded (ADR-022)`);
	const required = targetInfo.find((column) => column.required && !sourceColumns.includes(column.name));
	if (required) return skip(`the target's column ${required.name} is required (NOT NULL, no default) and production has no values for it`);
	if (rule === "changedLater" && !common.includes("document")) return skip("no document column on both sides, so when its rows last changed can't be read");
	return {
		result,
		shape: {
			common,
			key,
		},
	};
}

/**
 * Production's rows of `table` in key order, a page at a time: up to the row cap, then only as many of them as fit
 * the byte cap (always the first). `last` is the greatest key actually kept, so a row fetched but left over is the
 * first of the next page, never skipped.
 */
async function* sourcePages(deps: CopyDeps, table: string, shape: Shape, batchRows: number, batchBytes: number): AsyncGenerator<{ batch: string;
	n: number; }>
{
	const qualified = sql.identifier(table);
	const keyColumn = sql.identifier(shape.key.name);
	const keyType = sql.raw(shape.key.type);
	let last: string | undefined;
	for (;;)
	{
		const after = last === undefined ? sql`` : sql`WHERE ${keyColumn} > CAST(${last} AS ${keyType})`;
		const [page] = await readSource<{ batch: string | null;
			last: string | null;
			n: number;
			fetched: number; }>(deps.source, sql`WITH head AS (
				SELECT r.${keyColumn} AS k, row_to_json(r)::text AS j
				FROM (SELECT ${list(shape.common)} FROM ${qualified} ${after} ORDER BY ${keyColumn} LIMIT ${batchRows}) r),
			sized AS (SELECT k, j, sum(octet_length(j)) OVER (ORDER BY k ROWS UNBOUNDED PRECEDING) AS running, row_number() OVER (ORDER BY k) AS i FROM head),
			kept AS (SELECT k, j FROM sized WHERE running <= ${batchBytes} OR i = 1)
			SELECT '[' || string_agg(j, ',' ORDER BY k) || ']' AS batch, max(k)::text AS last, count(*)::int AS n,
				(SELECT count(*)::int FROM head) AS fetched
			FROM kept`);
		if (!page?.batch || page.last === null || Number(page.n) === 0) return;
		yield {
			batch: page.batch,
			n: Number(page.n),
		};
		last = page.last;
		// The end: a page the byte cap didn't cut that came back short of the row cap.
		if (Number(page.n) === Number(page.fetched) && Number(page.fetched) < batchRows) return;
	}
}

/**
 * Writes `batch` (a JSON array of rows) into `table`: inserts each new key, and on a key conflict either leaves the
 * target's row (`onConflict: "nothing"`) or updates it only when the incoming `version` is greater (`"newer"`, the
 * ingest guard; the caller makes sure both versions are counted in the same database). Returns the keys written.
 */
async function writeRows(target: PostgresDb, table: string, columns: string[], keyName: string, batch: string, onConflict: "nothing" | "newer"): Promise<string[]>
{
	const qualified = sql.identifier(table);
	const keyColumn = sql.identifier(keyName);
	const assignments = sql.join(columns.filter((column) => column !== keyName).map((column) => sql`${sql.identifier(column)} = excluded.${sql.identifier(column)}`), sql`, `);
	const conflict = onConflict === "nothing"
		? sql`ON CONFLICT (${keyColumn}) DO NOTHING`
		: sql`ON CONFLICT (${keyColumn}) DO UPDATE SET ${assignments} WHERE excluded.version > ${qualified}.version`;
	const written = await rows<{ k: string }>(target, sql`INSERT INTO ${qualified} (${list(columns)})
		SELECT ${list(columns)} FROM json_populate_recordset(NULL::${qualified}, CAST(${batch} AS json))
		${conflict}
		RETURNING ${keyColumn}::text AS k`);
	return written.map((row) => row.k);
}

/** Splits `items` into runs whose sizes add up to at most `cap`, each holding at least one item. */
function underCap<T>(items: T[], sizeOf: (item: T) => number, cap: number): T[][]
{
	const runs: T[][] = [];
	let run: T[] = [];
	let size = 0;
	for (const item of items)
	{
		const itemSize = sizeOf(item);
		if (run.length > 0 && size + itemSize > cap)
		{
			runs.push(run);
			run = [];
			size = 0;
		}
		run.push(item);
		size += itemSize;
	}
	if (run.length > 0) runs.push(run);
	return runs;
}

/** Counts for the projections rebuilt from the games a copy writes. */
type Rebuild = { built: number;
	notBuilt: number;
	leftNewer: number; };

/**
 * Rebuilds the projections of the page's games (`keys`) whose projection isn't current in the target (missing, or of
 * another version than its game: `isProjectionCurrent`'s rule), which includes every game the page just wrote. So a
 * copy stopped between a game and its projection is finished by the next copy, and a game that couldn't be projected
 * is tried again. Each is projected with `projectGame` (the target's code, ADR-025's one implementation); the target's
 * game documents are read and the projections written under the byte cap, the writes guarded by version (a
 * projection's version is its game's in this same database, so the comparison holds). A game `projectGame` throws on
 * is logged and counted; the rest carry on.
 */
async function rebuildProjections(deps: CopyDeps, keys: string[], run: Run, rebuild: Rebuild): Promise<void>
{
	const keysIn = sql`g.game_pk IN (SELECT CAST(value #>> '{}' AS integer) FROM json_array_elements(CAST(${JSON.stringify(keys.map(Number))} AS json)))`;
	const stale = await rows<{ k: number;
		size: number; }>(deps.target, sql`SELECT g.game_pk AS k, octet_length(g.document::text) AS size FROM games g LEFT JOIN game_projections p USING (game_pk)
		WHERE ${keysIn} AND p.version IS DISTINCT FROM g.version ORDER BY g.game_pk`);
	for (const run_ of underCap(stale, (game) => Number(game.size), run.batchBytes))
	{
		const games = await rows<{ document: VersionStamp }>(deps.target, sql`SELECT document FROM games WHERE game_pk IN (SELECT CAST(value #>> '{}' AS integer)
			FROM json_array_elements(CAST(${JSON.stringify(run_.map((game) => Number(game.k)))} AS json))) ORDER BY game_pk`);
		const built: string[] = [];
		for (const { document: game } of games)
		{
			try
			{
				const projection = projectGame(game as GameSnapshot);
				built.push(JSON.stringify({
					game_pk: projection.header.gamePk,
					version: projection.header.version,
					document: projection,
				}));
			}
			catch (error)
			{
				rebuild.notBuilt++;
				run.log(`game ${(game as { gamePk?: unknown }).gamePk}: projection not built: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		for (const chunk of underCap(built, (json) => json.length, run.batchBytes))
		{
			await deps.beforeWrite?.("game_projections");
			const written = await writeRows(deps.target, "game_projections", ["game_pk", "version", "document"], "game_pk", `[${chunk.join(",")}]`, "newer");
			rebuild.built += written.length;
			rebuild.leftNewer += chunk.length - written.length;
		}
	}
}

/** The context one copy's tables share. */
type Run = {
	batchRows: number;
	batchBytes: number;
	now: Date;
	log: (line: string) => void;
	/** Set when the games pass rebuilds projections (the target's `game_projections` can take them). */
	rebuild?: Rebuild;
};

/**
 * Copies one page of a `changedLater` table: reads the target's stamps for the page's keys, decides each row with
 * `compareAcrossStores` (and, for a row production changed later, `adoptAcrossStores` on the full documents, read
 * under the byte cap), then writes new rows and adopted ones. Returns the page's keys.
 */
async function copyChangedLaterPage(deps: CopyDeps, table: string, shape: Shape, batch: string, run: Run, result: TableCopy): Promise<string[]>
{
	const qualified = sql.identifier(table);
	const keyColumn = sql.identifier(shape.key.name);
	const keyType = sql.raw(shape.key.type);
	const page = JSON.parse(batch) as Record<string, unknown>[];
	const keyOf = (row: Record<string, unknown>) => String(row[shape.key.name]);
	const keysIn = (keys: unknown[]) => sql`${keyColumn} IN (SELECT CAST(value #>> '{}' AS ${keyType}) FROM json_array_elements(CAST(${JSON.stringify(keys)} AS json)))`;
	const stamps = new Map((await rows<{ k: string;
		version: number;
		changed: string | null;
		mode: string | null;
		size: number; }>(deps.target, sql`SELECT ${keyColumn}::text AS k, version, document->>'lastChangedAt' AS changed, document->>'windowMode' AS mode,
			octet_length(document::text) AS size FROM ${qualified} WHERE ${keysIn(page.map((row) => row[shape.key.name]))}`)).map((stamp) => [stamp.k, stamp]));
	const keep = (reason: KeptReason) =>
	{
		result.kept[reason] = (result.kept[reason] ?? 0) + 1;
	};

	const fresh: Record<string, unknown>[] = [];
	const later: Record<string, unknown>[] = [];
	for (const row of page)
	{
		const stamp = stamps.get(keyOf(row));
		const incoming = row.document as Partial<VersionStamp> | null;
		const outcome = compareAcrossStores(stamp
			? {
				version: Number(stamp.version),
				lastChangedAt: stamp.changed ?? "",
				...stamp.mode !== null && {
					windowMode: stamp.mode,
				},
			}
			: null, {
			lastChangedAt: String(incoming?.lastChangedAt ?? ""),
		}, run.now);
		if (outcome === "new") fresh.push(row);
		else if (outcome === "later") later.push(row);
		else keep(outcome);
	}

	// Only the rows production changed later are compared in full: their target documents, read under the byte cap.
	const adopted: Record<string, unknown>[] = [];
	const laterByKey = new Map(later.map((row) => [keyOf(row), row]));
	for (const keys of underCap(later.map(keyOf), (key) => Number(stamps.get(key)?.size ?? 0), run.batchBytes))
	{
		const stored = new Map((await rows<{ k: string;
			version: number;
			document: VersionStamp; }>(deps.target, sql`SELECT ${keyColumn}::text AS k, version, document FROM ${qualified} WHERE ${keysIn(keys.map((key) => laterByKey.get(key)![shape.key.name]))}`)).map((row) => [row.k, row]));
		for (const key of keys)
		{
			const row = laterByKey.get(key)!;
			const held = stored.get(key);
			if (!held)
			{
				// Gone from the target since the first read: whatever happened there is the target's own doing.
				keep("raced");
				continue;
			}
			const decision = adoptAcrossStores({
				...held.document,
				version: Number(held.version),
			}, row.document as VersionStamp, run.now);
			if (decision.state === null)
			{
				keep(decision.outcome === "new" || decision.outcome === "later" ? "raced" : decision.outcome);
				continue;
			}
			adopted.push({
				...row,
				version: decision.state.version,
				document: decision.state,
			});
		}
	}

	await deps.beforeWrite?.(table);
	for (const [chosen, onConflict] of [[fresh, "nothing"], [adopted, "newer"]] as const)
	{
		if (chosen.length === 0) continue;
		const written = new Set(await writeRows(deps.target, table, shape.common, shape.key.name, JSON.stringify(chosen), onConflict));
		for (const row of chosen)
		{
			if (written.has(keyOf(row))) result.written++;
			else keep("raced");
		}
	}
	return page.map(keyOf);
}

/** Copies one table by its rule, page by page in key order; see the module comment for what it may and may not do. */
async function copyTable(deps: CopyDeps, table: string, rule: CopyRule, shape: Shape, result: TableCopy, run: Run): Promise<TableCopy>
{
	for await (const page of sourcePages(deps, table, shape, run.batchRows, run.batchBytes))
	{
		result.read += page.n;
		if (rule === "patchCount")
		{
			await deps.beforeWrite?.(table);
			result.written += (await writeRows(deps.target, table, shape.common, shape.key.name, page.batch, "newer")).length;
			continue;
		}
		const keys = await copyChangedLaterPage(deps, table, shape, page.batch, run, result);
		if (table === "games" && run.rebuild) await rebuildProjections(deps, keys, run, run.rebuild);
	}
	return result;
}

const NO_TABLE = "the target has no such table";

/** Why the target's `game_projections` can't take rebuilt projections, or undefined when it can. */
async function projectionsUnwritable(deps: CopyDeps): Promise<string | undefined>
{
	const columns = await rows<Column>(deps.target, columnsQuery("game_projections"));
	if (columns.length === 0) return NO_TABLE;
	const missing = ["game_pk", "version", "document"].filter((name) => !columns.some((column) => column.name === name && !column.generated));
	if (missing.length) return `the target's game_projections has no ${missing.join(", ")} to write`;
	const required = columns.find((column) => column.required && !["game_pk", "version", "document"].includes(column.name));
	if (required) return `the target's column ${required.name} is required (NOT NULL, no default) and a rebuilt projection has no value for it`;
	return undefined;
}

/** The one line a table's entry is logged as: counts and column names only, never a row. */
function describe(copy: TableCopy): string
{
	if (copy.skipped) return `${copy.table}: skipped, none of production's rows copied (${copy.skipped})`;
	if (COPY_RULES[copy.table] === "rebuiltFromGames")
	{
		return [
			`${copy.table}: rebuilt ${copy.written} from the copied games`,
			copy.notBuilt ? `${copy.notBuilt} not built` : "",
			copy.leftNewer ? `${copy.leftNewer} left as they are (already newer than their game)` : "",
		].filter(Boolean).join("; ");
	}
	const kept = (Object.entries(copy.kept) as [KeptReason, number][]).map(([reason, n]) => `${n} ${KEPT_WORDS[reason]}`);
	return [
		`${copy.table}: ${copy.read} read, ${copy.written} written`,
		kept.length ? `kept ${kept.join(", ")}` : "",
		copy.sourceOnlyColumns.length ? `production-only columns skipped: ${copy.sourceOnlyColumns.join(", ")}` : "",
		copy.targetOnlyColumns.length ? `target-only columns kept: ${copy.targetOnlyColumns.join(", ")}` : "",
		copy.generatedColumns.length ? `columns the target generates left to it: ${copy.generatedColumns.join(", ")}` : "",
	].filter(Boolean).join("; ");
}

/**
 * Migrates the target, compares the two databases' migrations, then copies every baseball table from source to
 * target by its rule. Returns one entry per table; logs a line per table with counts and column names only, never a
 * row. Throws `CopyRefused`, having written no row, when the target has run a migration this checkout doesn't have.
 */
export async function copyBaseballData(deps: CopyDeps): Promise<TableCopy[]>
{
	const log = deps.log ?? (() => undefined);
	const tables = baseballTables();
	checkCopyRules(tables);
	const folder = deps.migrationsFolder ?? MIGRATIONS_FOLDER;
	await deps.migrateTarget(folder);
	const verdict = await compareMigrations(deps, folder, tables, log);
	const run: Run = {
		batchRows: deps.batchRows ?? COPY_BATCH_ROWS,
		batchBytes: deps.batchBytes ?? COPY_BATCH_BYTES,
		now: deps.now?.() ?? new Date(),
		log,
	};
	const migrationSkip = (table: string) =>
	{
		const by = verdict.touchedBy.get(table);
		return by ? `the target has migration ${by} that production hasn't run, and it touches ${table}` : undefined;
	};
	const unwritable = await projectionsUnwritable(deps);
	const projectionsSkip = verdict.skipAll ?? migrationSkip("game_projections") ?? unwritable;
	const projectionsBy = verdict.touchedBy.get("game_projections");
	// A game copied without its projection would leave the two disagreeing, so games wait for a game_projections that
	// can take theirs; a target with no game_projections at all has nothing to disagree with.
	const gamesWait = projectionsBy
		? `its projections (game_projections) are touched by migration ${projectionsBy}, which production hasn't run`
		: unwritable && unwritable !== NO_TABLE ? `its projections can't be rebuilt (${unwritable})` : undefined;
	let gamesCopied = false;
	const entry = (table: string, fields: Partial<TableCopy>): TableCopy => ({
		table,
		read: 0,
		written: 0,
		kept: {},
		sourceOnlyColumns: [],
		targetOnlyColumns: [],
		generatedColumns: [],
		...fields,
	});

	const copies: TableCopy[] = [];
	for (const table of tables)
	{
		const rule = COPY_RULES[table]!;
		let copy: TableCopy;
		const why = verdict.skipAll ?? migrationSkip(table)
			?? (table === "games" ? gamesWait : undefined);
		if (why) copy = entry(table, {
			skipped: why,
		});
		else if (rule === "rebuiltFromGames")
		{
			const skipped = projectionsSkip ?? (gamesCopied ? undefined : "its games weren't copied");
			copy = entry(table, skipped
				? {
					skipped,
				}
				: {
					written: run.rebuild?.built ?? 0,
					notBuilt: run.rebuild?.notBuilt ?? 0,
					leftNewer: run.rebuild?.leftNewer ?? 0,
				});
		}
		else
		{
			const { result, shape } = await shapeOf(deps, table, rule);
			if (table === "games" && shape && !projectionsSkip) run.rebuild = {
				built: 0,
				notBuilt: 0,
				leftNewer: 0,
			};
			copy = shape ? await copyTable(deps, table, rule, shape, result, run) : result;
			if (table === "games") gamesCopied = Boolean(shape);
		}
		copies.push(copy);
		log(describe(copy));
	}
	return copies;
}
