/**
 * The dev seed (S112) without the network: `HttpMlbStatsClient` records through a fetch
 * stand-in (`recordedClient`) serving the committed `fixtures/raw/` recordings, into a temporary directory — never
 * the git-ignored seed file `pnpm seed:refresh` writes. Loading goes through the Postgres
 * repositories on PGlite, twice.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import {
	afterEach, describe, expect, it,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { migratedPglite } from "../adapters/postgres/migrate.js";
import type { PostgresDb } from "../adapters/postgres/repos.js";
import {
	PostgresGameProjectionRepository, PostgresGameRepository, PostgresScheduleRepository,
} from "../adapters/postgres/repos.js";
import { recordedClient } from "../test/recorded-mlb.js";
import type { DevSeed } from "./dev-seed.js";
import {
	defaultSeedRange, loadDevSeed, readDevSeed, recordDevSeed, writeDevSeed,
} from "./dev-seed.js";

const dirs: string[] = [];
afterEach(async () =>
{
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, {
		recursive: true,
		force: true,
	})));
});

async function tempFile(): Promise<string>
{
	const dir = await mkdtemp(path.join(tmpdir(), "bt-dev-seed-"));
	dirs.push(dir);
	return path.join(dir, "nested", "seed.json.gz");
}

async function recordedSeed(): Promise<DevSeed>
{
	const { mlb } = recordedClient();
	return (await recordDevSeed(mlb, {
		start: "2026-09-04",
		end: "2026-09-06",
	}, {
		now: () => new Date("2026-11-04T12:00:00.000Z"),
	})).seed;
}

describe("seed:refresh (S112 AC 1)", () =>
{
	it("S112 AC 1: records every day in the range and each game it lists, hydrated, into one gzipped file", async () =>
	{
		const { mlb, asked } = recordedClient();
		const { seed, skipped } = await recordDevSeed(mlb, {
			start: "2026-09-04",
			end: "2026-09-06",
		});
		const file = await tempFile();
		await writeDevSeed(file, seed);
		expect(readFileSync(file).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));

		const read = await readDevSeed(file);
		expect(read?.days.map((day) => day.date)).toEqual(["2026-09-04", "2026-09-05", "2026-09-06"]);
		expect(read?.days[0]?.games).toEqual([]);
		const listed = read?.days[1]?.games.map((game) => game.gamePk) ?? [];
		expect(listed).toContain(823823);
		// Each listed game is asked for once; the recordings hold one, the rest are reported.
		expect(new Set(asked.filter((url) => url.includes("/feed/live")))).toHaveProperty("size", listed.length);
		const game = read?.games.find((g) => g.gamePk === 823823);
		expect(read?.games).toHaveLength(1);
		expect(skipped).toHaveLength(listed.length - 1);
		expect(game?.plays?.length).toBeGreaterThan(0);
		expect(game?.highlights.length).toBeGreaterThan(0);
		expect(game?.playMetrics).toBeTruthy();
	});

	it("S112 AC 1: with no dates, the most recent finished season's last regular-season month through its last postseason game", async () =>
	{
		const { mlb } = recordedClient();
		// 2026's regular season ended 2026-09-27 and its World Series on 2026-10-28.
		expect(await defaultSeedRange(mlb, "2026-11-04")).toEqual({
			start: "2026-08-28",
			end: "2026-10-28",
		});
		// Mid-season, the seed is the last finished season instead.
		const last = await defaultSeedRange(mlb, "2026-07-01");
		expect(last.end.startsWith("2025-")).toBe(true);
		expect(last.start < last.end).toBe(true);
	});

	it("S112 AC 1: with this year's calendar unreachable, the default range is the year before's finished season", async () =>
	{
		// fetchSeasonCalendar rejects on a 500 (S128); defaultSeedRange treats it like an unpublished season.
		const { mlb } = recordedClient((url) => url.pathname.endsWith("/api/v1/seasons/2026") ? new Response("{}", {
			status: 500,
		}) : undefined);
		// 2025's regular season ended 2025-09-28 and its World Series on 2025-11-01.
		expect(await defaultSeedRange(mlb, "2026-07-01")).toEqual({
			start: "2025-08-29",
			end: "2025-11-01",
		});
	});

	it("S112 AC 1: a missing seed file reads as none", async () =>
	{
		expect(await readDevSeed(await tempFile())).toBeNull();
	});
});

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

describe("loading the seed on dev start (S112 AC 2)", () =>
{
	it("S112 AC 2: loads the seed into Postgres through the repositories, and loading twice changes nothing", async () =>
	{
		const { db } = await migratedPglite();
		const deps = {
			mlb: new FixtureMlbStatsClient(),
			schedules: new PostgresScheduleRepository(db),
			games: new PostgresGameRepository(db),
			projections: new PostgresGameProjectionRepository(db),
		};
		const seed = await recordedSeed();
		expect(await loadDevSeed(deps, seed)).toBe(3);
		const first = await counts(db);
		expect(first.schedule_days).toBe(3);
		expect(first.games).toBe(1);
		const stored = await deps.games.getByPk(823823);
		expect(stored?.plays?.length).toBeGreaterThan(0);

		await loadDevSeed(deps, seed);
		expect(await counts(db)).toEqual(first);
		expect((await deps.games.getByPk(823823))?.version).toBe(stored?.version);
		expect((await deps.schedules.getByDate("2026-09-05"))?.games.length).toBe(seed.days[1]?.games.length);
	});
});
