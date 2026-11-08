/**
 * How much room the game data takes (S122 AC 9; owner, 2026-11-07: "Let's do it locally and
 * then see how big it actually is"): each game table's row count and its on-disk size,
 * `pg_total_relation_size` (the table with its indexes and TOAST), as the backfill prints at
 * the end. Read-only.
 */
import { sql } from "drizzle-orm";
import type { PostgresDb } from "../adapters/postgres/repos.js";

/** The tables a backfill fills, in the order the report lists them. */
export const GAME_TABLES = ["schedule_days", "games", "game_projections"] as const;

export type TableSize = {
	table: (typeof GAME_TABLES)[number];
	rows: number;
	bytes: number;
};

/** Rows and on-disk bytes of each of {@link GAME_TABLES}. */
export async function gameTableSizes(db: PostgresDb): Promise<TableSize[]>
{
	const sizes: TableSize[] = [];
	for (const table of GAME_TABLES)
	{
		// The names are this module's constants, never input, so they're safe as identifiers.
		const result = await db.execute(sql`SELECT count(*)::bigint AS rows, pg_total_relation_size(${table}::regclass)::bigint AS bytes FROM ${sql.identifier(table)}`);
		const [row] = (result as unknown as { rows: { rows: string | number;
			bytes: string | number; }[]; }).rows;
		sizes.push({
			table,
			rows: Number(row?.rows ?? 0),
			bytes: Number(row?.bytes ?? 0),
		});
	}
	return sizes;
}

/** Bytes for people: `812 B`, `14.2 kB`, `3.1 MB`, `1.4 GB` (powers of 1024). */
export function formatBytes(bytes: number): string
{
	const units = ["B", "kB", "MB", "GB", "TB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1)
	{
		value /= 1024;
		unit++;
	}
	return unit === 0 ? `${value} ${units[0]}` : `${value.toFixed(1)} ${units[unit]}`;
}

/** The report's lines: one per table, then the total. */
export function formatSizeReport(sizes: TableSize[]): string[]
{
	const total = sizes.reduce((sum, size) => sum + size.bytes, 0);
	return [
		...sizes.map((size) => `${size.table}: ${size.rows.toLocaleString("en-US")} rows, ${formatBytes(size.bytes)}`),
		`total: ${formatBytes(total)} (pg_total_relation_size: tables, indexes and TOAST)`,
	];
}
