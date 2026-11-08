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
 * - every write is version-guarded the way ingest's are (ADR-022; `repos.ts`, `applyIfNewer`):
 *   insert, or on a key conflict update only when production's `version` is greater, so a newer
 *   target row is kept and copying again changes nothing.
 *
 * The caller migrates the target first (`migrateTarget`) and production never: the source
 * connection is switched to read-only before anything is read from it.
 */
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PostgresDb } from "../adapters/postgres/repos.js";
import { DATA_CLASSIFICATION } from "./data-classification.js";

/** Rows read and written per statement: small enough that a page of game documents stays a few MB. */
export const COPY_BATCH_ROWS = 100;

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
	skipped?: string;
	/** Production's columns the target lacks (left out), and the target's that production lacks (left as they are). */
	sourceOnlyColumns: string[];
	targetOnlyColumns: string[];
};

export type CopyDeps = {
	/** Production (or whatever is copied from); only read, over a read-only session. */
	source: PostgresDb;
	/** The database written; migrated by `migrateTarget` before anything is read or written. */
	target: PostgresDb;
	/** Applies the committed migrations to the target (`migrateDatabaseAt` / `migratePostgres`). */
	migrateTarget: () => Promise<void>;
	log?: (line: string) => void;
	batchRows?: number;
};

async function rows<T extends Record<string, unknown>>(db: PostgresDb, query: SQL): Promise<T[]>
{
	return (await db.execute(query) as unknown as { rows: T[] }).rows;
}

/** A `public` table's columns, in table order; empty when the table doesn't exist. */
async function columnsOf(db: PostgresDb, table: string): Promise<string[]>
{
	const found = await rows<{ column_name: string }>(db, sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY ordinal_position`);
	return found.map((row) => row.column_name);
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
async function copyTable(deps: CopyDeps, table: string, batchRows: number): Promise<TableCopy>
{
	const [sourceColumns, targetColumns] = [await columnsOf(deps.source, table), await columnsOf(deps.target, table)];
	const common = sourceColumns.filter((column) => targetColumns.includes(column));
	const result: TableCopy = {
		table,
		read: 0,
		written: 0,
		sourceOnlyColumns: sourceColumns.filter((column) => !targetColumns.includes(column)),
		targetOnlyColumns: targetColumns.filter((column) => !sourceColumns.includes(column)),
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
		throw new Error(`${table}: the copy needs one primary-key column both databases have (found ${keys.map((k) => k.name).join(", ") || "none"})`);
	}
	if (!common.includes("version")) throw new Error(`${table}: no version column on both sides, so a write can't be version-guarded (ADR-022)`);

	const qualified = sql.identifier(table);
	const keyColumn = sql.identifier(key.name);
	const keyType = sql.raw(key.type);
	const updated = common.filter((column) => column !== key.name);
	const assignments = sql.join(updated.map((column) => sql`${sql.identifier(column)} = excluded.${sql.identifier(column)}`), sql`, `);
	let last: string | undefined;
	for (;;)
	{
		const after = last === undefined ? sql`` : sql`WHERE ${keyColumn} > CAST(${last} AS ${keyType})`;
		const [page] = await rows<{ batch: string | null;
			last: string | null;
			n: number; }>(deps.source, sql`WITH page AS (SELECT ${list(common)} FROM ${qualified} ${after} ORDER BY ${keyColumn} LIMIT ${batchRows})
			SELECT json_agg(page)::text AS batch, max(${keyColumn})::text AS last, count(*)::int AS n FROM page`);
		if (!page?.batch || page.last === null || page.n === 0) break;
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
		if (Number(page.n) < batchRows) break;
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
	// Production is only ever read: every transaction on this session is read-only from here on.
	await deps.source.execute(sql`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`);
	const copies: TableCopy[] = [];
	for (const table of baseballTables())
	{
		const copy = await copyTable(deps, table, deps.batchRows ?? COPY_BATCH_ROWS);
		copies.push(copy);
		const columns = [
			copy.sourceOnlyColumns.length ? `production-only columns skipped: ${copy.sourceOnlyColumns.join(", ")}` : "",
			copy.targetOnlyColumns.length ? `target-only columns kept: ${copy.targetOnlyColumns.join(", ")}` : "",
		].filter(Boolean).join("; ");
		log(copy.skipped ? `${table}: skipped (${copy.skipped})` : `${table}: ${copy.read} read, ${copy.written} written${columns ? `; ${columns}` : ""}`);
	}
	return copies;
}
