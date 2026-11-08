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
 * the manifest labels it `none`.
 *
 * It only adds (owner, 2026-11-05: "if I make changes to data and schemas that's different from
 * production, it'll need to have data in staging that isn't present in production"):
 * - nothing in the target is deleted, truncated or dropped; rows only the target has stay;
 * - only the columns both sides have are copied, so a column only the target has (a migration
 *   production hasn't had yet) keeps its values, a column only production has is skipped, and a
 *   table either side lacks is skipped (a column a target-only migration renamed gets nothing
 *   from production under its new name);
 * - a column the target generates (`GENERATED ALWAYS`, stored or identity) is left to the
 *   target; a target-only column that is required with no default (NOT NULL, nothing to fill it)
 *   makes that table be skipped with the reason, getting none of production's rows, and the
 *   other tables are still copied;
 * - every write is version-guarded the way ingest's are (ADR-022; `repos.ts`, `applyIfNewer`):
 *   insert, or on a key conflict update only when production's `version` is greater, so a newer
 *   target row is kept and copying again changes nothing.
 *
 * The caller migrates the target first (`migrateTarget`) and production never. Every read of
 * production runs in a transaction of its own made read-only before it reads anything, so it
 * holds through Neon's pooler (PgBouncer, transaction mode), where a session setting could land
 * on one server connection and the next statement on another; nothing is set on production's
 * session, which a pooler could otherwise leave on a connection production's own clients reuse.
 */
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
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

/** What happened to one table: rows read from production, rows inserted or updated in the target, or why it was skipped. */
export type TableCopy = {
	table: string;
	read: number;
	written: number;
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
	/** Applies the committed migrations to the target (`migrateDatabaseAt` / `migratePostgres`). */
	migrateTarget: () => Promise<void>;
	log?: (line: string) => void;
	/** The page's row cap ({@link COPY_BATCH_ROWS}) and byte cap ({@link COPY_BATCH_BYTES}); tests shrink them. */
	batchRows?: number;
	batchBytes?: number;
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

/** Copies one table, page by page in key order; see the module comment for what it may and may not do. */
async function copyTable(deps: CopyDeps, table: string, batchRows: number, batchBytes: number): Promise<TableCopy>
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
		sourceOnlyColumns: sourceColumns.filter((column) => !targetColumns.includes(column)),
		targetOnlyColumns: targetColumns.filter((column) => !sourceColumns.includes(column)),
		generatedColumns: generated,
	};
	if (sourceColumns.length === 0) return {
		...result,
		skipped: "production has no such table",
	};
	if (targetColumns.length === 0) return {
		...result,
		skipped: "the target has no such table",
	};
	const keys = await primaryKeyOf(deps.target, table);
	const [key] = keys;
	if (keys.length !== 1 || !key || !common.includes(key.name))
	{
		throw new Error(`${table}: the copy needs one primary-key column both databases have, not generated by the target (found ${keys.map((k) => k.name).join(", ") || "none"})`);
	}
	if (!common.includes("version")) throw new Error(`${table}: no version column on both sides (not generated by the target), so a write can't be version-guarded (ADR-022)`);
	const required = targetInfo.find((column) => column.required && !sourceColumns.includes(column.name));
	if (required) return {
		...result,
		skipped: `the target's column ${required.name} is required (NOT NULL, no default) and production has no values for it`,
	};

	const qualified = sql.identifier(table);
	const keyColumn = sql.identifier(key.name);
	const keyType = sql.raw(key.type);
	const updated = common.filter((column) => column !== key.name);
	const assignments = sql.join(updated.map((column) => sql`${sql.identifier(column)} = excluded.${sql.identifier(column)}`), sql`, `);
	let last: string | undefined;
	for (;;)
	{
		const after = last === undefined ? sql`` : sql`WHERE ${keyColumn} > CAST(${last} AS ${keyType})`;
		// The next rows in key order, up to the row cap, then only as many of them as fit the byte
		// cap (always the first). `last` is the greatest key actually kept, so a row fetched but
		// left over is the first of the next page, never skipped.
		const [page] = await readSource<{ batch: string | null;
			last: string | null;
			n: number;
			fetched: number; }>(deps.source, sql`WITH head AS (
				SELECT r.${keyColumn} AS k, row_to_json(r)::text AS j
				FROM (SELECT ${list(common)} FROM ${qualified} ${after} ORDER BY ${keyColumn} LIMIT ${batchRows}) r),
			sized AS (SELECT k, j, sum(octet_length(j)) OVER (ORDER BY k ROWS UNBOUNDED PRECEDING) AS running, row_number() OVER (ORDER BY k) AS i FROM head),
			kept AS (SELECT k, j FROM sized WHERE running <= ${batchBytes} OR i = 1)
			SELECT '[' || string_agg(j, ',' ORDER BY k) || ']' AS batch, max(k)::text AS last, count(*)::int AS n,
				(SELECT count(*)::int FROM head) AS fetched
			FROM kept`);
		if (!page?.batch || page.last === null || Number(page.n) === 0) break;
		const [wrote] = await rows<{ n: number }>(deps.target, sql`WITH written AS (
			INSERT INTO ${qualified} (${list(common)})
			SELECT ${list(common)} FROM json_populate_recordset(NULL::${qualified}, CAST(${page.batch} AS json))
			ON CONFLICT (${keyColumn}) DO UPDATE SET ${assignments}
			WHERE excluded.version > ${qualified}.version
			RETURNING 1)
			SELECT count(*)::int AS n FROM written`);
		result.read += Number(page.n);
		result.written += Number(wrote?.n ?? 0);
		last = page.last;
		// The end: a page the byte cap didn't cut that came back short of the row cap.
		if (Number(page.n) === Number(page.fetched) && Number(page.fetched) < batchRows) break;
	}
	return result;
}

/**
 * Migrates the target, then copies every baseball table from source to target. Returns one
 * entry per table; logs a line per table with counts and column names only, never a row.
 */
export async function copyBaseballData(deps: CopyDeps): Promise<TableCopy[]>
{
	const log = deps.log ?? (() => undefined);
	await deps.migrateTarget();
	const copies: TableCopy[] = [];
	for (const table of baseballTables())
	{
		const copy = await copyTable(deps, table, deps.batchRows ?? COPY_BATCH_ROWS, deps.batchBytes ?? COPY_BATCH_BYTES);
		copies.push(copy);
		const columns = [
			copy.sourceOnlyColumns.length ? `production-only columns skipped: ${copy.sourceOnlyColumns.join(", ")}` : "",
			copy.targetOnlyColumns.length ? `target-only columns kept: ${copy.targetOnlyColumns.join(", ")}` : "",
			copy.generatedColumns.length ? `columns the target generates left to it: ${copy.generatedColumns.join(", ")}` : "",
		].filter(Boolean).join("; ");
		log(copy.skipped ? `${table}: skipped, none of production's rows copied (${copy.skipped})` : `${table}: ${copy.read} read, ${copy.written} written${columns ? `; ${columns}` : ""}`);
	}
	return copies;
}
