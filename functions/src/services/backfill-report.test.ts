/**
 * The backfill's size report (S122 AC 9) against PGlite: the same Postgres the local database
 * and Neon run, so `pg_total_relation_size` is the real function.
 */
import {
	describe, expect, it,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { migratedPglite } from "../adapters/postgres/migrate.js";
import {
	PostgresGameProjectionRepository, PostgresGameRepository, PostgresScheduleRepository,
} from "../adapters/postgres/repos.js";
import {
	formatBytes, formatSizeReport, GAME_TABLES, gameTableSizes,
} from "./backfill-report.js";
import { ingestScheduleDay } from "./ingest.js";

describe("gameTableSizes (S122 AC 9)", () =>
{
	it("reports each game table's rows and on-disk size, empty and after a stored day", async () =>
	{
		const { db } = await migratedPglite();
		const empty = await gameTableSizes(db);
		expect(empty.map((size) => size.table)).toEqual([...GAME_TABLES]);
		expect(empty.map((size) => size.rows)).toEqual([0, 0, 0]);

		await ingestScheduleDay({
			mlb: new FixtureMlbStatsClient(),
			schedules: new PostgresScheduleRepository(db),
			games: new PostgresGameRepository(db),
			projections: new PostgresGameProjectionRepository(db),
			now: () => new Date("2026-11-08T17:00:00.000Z"),
		}, "2026-09-05");
		const sizes = await gameTableSizes(db);
		expect(sizes.find((size) => size.table === "schedule_days")?.rows).toBe(1);
		expect(sizes.find((size) => size.table === "games")?.rows).toBe(1);
		expect(sizes.find((size) => size.table === "game_projections")?.rows).toBe(1);
		for (const size of sizes) expect(size.bytes).toBeGreaterThan(empty.find((e) => e.table === size.table)!.bytes - 1);
		expect(sizes.find((size) => size.table === "games")!.bytes).toBeGreaterThan(8192);

		const lines = formatSizeReport(sizes);
		expect(lines).toHaveLength(4);
		expect(lines[1]).toMatch(/^games: 1 rows, [\d.]+ kB$/);
		expect(lines[3]).toMatch(/^total: [\d.]+ kB \(pg_total_relation_size/);
	});

	it("formats bytes for people", () =>
	{
		expect(formatBytes(812)).toBe("812 B");
		expect(formatBytes(14_540)).toBe("14.2 kB");
		expect(formatBytes(3.1 * 1024 ** 3)).toBe("3.1 GB");
	});
});
