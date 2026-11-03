/**
 * `pnpm db:seed` on PGlite (S51 AC 2): the committed fixture days land in Postgres, and seeding
 * a second time leaves every table's row count where it was.
 */
import { sql } from "drizzle-orm";
import {
	describe, expect, it,
} from "vitest";
import {
	FIXTURES_ROOT, FixtureMlbStatsClient, nodeFixtureFiles,
} from "../adapters/fixtures/mlb.js";
import { migratedPglite } from "../adapters/postgres/migrate.js";
import type { PostgresDb } from "../adapters/postgres/repos.js";
import {
	PostgresGameProjectionRepository, PostgresGameRepository, PostgresScheduleRepository,
} from "../adapters/postgres/repos.js";
import { seedFromFixtures } from "./seed.js";

const TABLES = ["schedule_days", "games", "game_projections"] as const;

async function counts(db: PostgresDb): Promise<Record<string, number>>
{
	const entries = await Promise.all(TABLES.map(async (table) =>
	{
		const result = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`));
		return [table, (result as unknown as { rows: { n: number }[] }).rows[0]!.n] as const;
	}));
	return Object.fromEntries(entries);
}

describe("seedFromFixtures (S51)", () =>
{
	it("seeds every fixture day, and seeding twice leaves the row counts unchanged", async () =>
	{
		const { db } = await migratedPglite();
		const deps = {
			mlb: new FixtureMlbStatsClient(),
			schedules: new PostgresScheduleRepository(db),
			games: new PostgresGameRepository(db),
			projections: new PostgresGameProjectionRepository(db),
		};
		const files = nodeFixtureFiles(FIXTURES_ROOT);

		const days = await seedFromFixtures(deps, files);
		expect(days).toContain("2024-07-04");
		expect(days).toContain("2026-09-05");
		const first = await counts(db);
		expect(first.schedule_days).toBe(days.length);
		expect(first.games).toBeGreaterThan(0);

		await seedFromFixtures(deps, files);
		expect(await counts(db)).toEqual(first);
	});
});
