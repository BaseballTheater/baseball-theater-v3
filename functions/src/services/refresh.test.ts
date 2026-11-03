import {
	describe, expect, it, vi,
} from "vitest";
import type { GameSnapshot } from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository,
	InMemoryGameRepository,
	InMemoryScheduleRepository,
} from "../adapters/memory/repos.js";
import { getOrRefreshGame, type IngestDeps } from "./ingest.js";
import {
	CACHE_TTL_MS, isStale, RefreshCoordinator,
} from "./refresh.js";

/**
 * MlbStatsClient that counts `fetchGame` calls and can hold each one open, so a
 * test can prove that concurrent reads collapse to a single in-flight call
 * (single-flight) rather than fanning out into shared MLB egress.
 */
function spyClient(): {
	client: MlbStatsClient;
	calls: () => number;
	release: () => void;
}
{
	const real = new FixtureMlbStatsClient();
	const fetchGame = vi.fn(async (gamePk: number) =>
	{
		await gate;
		return real.fetchGame(gamePk);
	});
	let open!: () => void;
	const gate = new Promise<void>((resolve) =>
	{
		open = resolve;
	});
	const client = {
		fetchSchedule: (d: string) => real.fetchSchedule(d),
		fetchGame,
		fetchGameContent: (pk: number) => real.fetchGameContent(pk),
		fetchPlayMetrics: (pk: number) => real.fetchPlayMetrics(pk),
		fetchStandings: (d: string) => real.fetchStandings(d),
		fetchSeasonCalendar: (season: number) => real.fetchSeasonCalendar(season),
		fetchPlayers: (ids: number[]) => real.fetchPlayers(ids),
		fetchGameTimestamps: (pk: number) => real.fetchGameTimestamps(pk),
		fetchGameDiffPatch: (pk: number, s: string, e: string) =>
			real.fetchGameDiffPatch(pk, s, e),
	} satisfies MlbStatsClient;
	return {
		client,
		calls: () => fetchGame.mock.calls.length,
		release: () => open(),
	};
}

function deps(overrides: Partial<IngestDeps> = {}): IngestDeps
{
	return {
		mlb: new FixtureMlbStatsClient(),
		schedules: new InMemoryScheduleRepository(),
		games: new InMemoryGameRepository(),
		projections: new InMemoryGameProjectionRepository(),
		...overrides,
	};
}

const STALE = new Date(Date.now() - CACHE_TTL_MS - 1_000).toISOString();
const FRESH = new Date().toISOString();

function cached(fetchedAt: string): GameSnapshot
{
	return {
		gamePk: 744834,
		officialDate: "2024-07-04",
		status: {
			abstractGameState: "Final",
			detailedState: "Final",
			codedGameState: "F",
		},
		teams: {
			home: {
				id: 120,
				name: "Washington Nationals",
				abbreviation: "WSH",
				runs: 0,
			},
			away: {
				id: 121,
				name: "New York Mets",
				abbreviation: "NYM",
				runs: 0,
			},
		},
		venue: {
			id: 3309,
			name: "Nationals Park",
		},
		linescore: {
			currentInning: 9,
			inningState: "Bottom",
			balls: 0,
			strikes: 0,
			outs: 3,
		},
		plays: [],
		highlights: [],
		fetchedAt,
		windowMode: "cache",
	} as unknown as GameSnapshot;
}

describe("isStale", () =>
{
	it("treats a missing or expired fetchedAt as stale, a recent one as fresh", () =>
	{
		const now = new Date();
		expect(isStale(undefined, now)).toBe(true);
		expect(isStale("not-a-date", now)).toBe(true);
		expect(isStale(STALE, now)).toBe(true);
		expect(isStale(FRESH, now)).toBe(false);
	});
});

describe("getOrRefreshGame staleness trigger", () =>
{
	it("does not refresh a fresh cache entry", async () =>
	{
		const spy = spyClient();
		const games = new InMemoryGameRepository();
		await games.upsert(cached(FRESH));
		spy.release();
		const out = await getOrRefreshGame(
			deps({
				mlb: spy.client,
				games,
				refresh: new RefreshCoordinator(),
			}),
			744834,
		);
		expect(out?.fetchedAt).toBe(FRESH);
		expect(spy.calls()).toBe(0);
	});

	it("triggers exactly one upstream refresh for a stale cache entry", async () =>
	{
		const spy = spyClient();
		const games = new InMemoryGameRepository();
		await games.upsert(cached(STALE));
		spy.release();
		const out = await getOrRefreshGame(
			deps({
				mlb: spy.client,
				games,
				refresh: new RefreshCoordinator(),
			}),
			744834,
		);
		expect(spy.calls()).toBe(1);
		expect(out?.fetchedAt).not.toBe(STALE);
	});
});

describe("single-flight", () =>
{
	it("collapses N concurrent stale reads for one key into 1 upstream call", async () =>
	{
		const spy = spyClient();
		const games = new InMemoryGameRepository();
		await games.upsert(cached(STALE));
		const d = deps({
			mlb: spy.client,
			games,
			refresh: new RefreshCoordinator(),
		});

		const reads = Promise.all(
			Array.from({
				length: 8,
			}, () => getOrRefreshGame(d, 744834)),
		);
		// All eight are now parked on the same in-flight fetch.
		spy.release();
		const results = await reads;

		expect(spy.calls()).toBe(1);
		expect(results.every((r) => r?.gamePk === 744834)).toBe(true);
	});
});

describe("refresh cooldown", () =>
{
	it("suppresses a second upstream refresh inside REFRESH_COOLDOWN_MS", async () =>
	{
		const spy = spyClient();
		spy.release();
		const games = new InMemoryGameRepository();
		await games.upsert(cached(STALE));

		// Start the clock exactly at the point the cached entry turns stale.
		let clock = new Date(Date.parse(STALE) + CACHE_TTL_MS + 1_000);
		const cooldown = new RefreshCoordinator(() => clock, 60_000);
		const d = deps({
			mlb: spy.client,
			games,
			refresh: cooldown,
			now: () => clock,
		});

		await getOrRefreshGame(d, 744834);
		expect(spy.calls()).toBe(1);

		// A forced refresh (`?refresh=1`) inside the cooldown is still blocked.
		clock = new Date(clock.getTime() + 30_000);
		const second = await getOrRefreshGame(d, 744834, {
			force: true,
		});
		expect(spy.calls()).toBe(1); // cooldown blocked the re-hit
		expect(second?.gamePk).toBe(744834); // still served from cache

		// Past the cooldown, a refresh is allowed again.
		clock = new Date(clock.getTime() + 60_000);
		await getOrRefreshGame(d, 744834, {
			force: true,
		});
		expect(spy.calls()).toBe(2);
	});

	it("counts an unchanged refresh as checked, so reads past the TTL don't re-pull until the TTL lapses again", async () =>
	{
		const spy = spyClient();
		spy.release();
		const games = new InMemoryGameRepository();
		await games.upsert(cached(STALE));
		let clock = new Date(Date.parse(STALE) + CACHE_TTL_MS + 1_000);
		const d = deps({
			mlb: spy.client,
			games,
			refresh: new RefreshCoordinator(() => clock, 60_000),
			now: () => clock,
		});

		await getOrRefreshGame(d, 744834);
		expect(spy.calls()).toBe(1);

		// Past the cooldown but inside the TTL since that check: served from the store.
		clock = new Date(clock.getTime() + 2 * 60_000);
		await getOrRefreshGame(d, 744834);
		expect(spy.calls()).toBe(1);

		// A full TTL after the check, the next read refreshes again.
		clock = new Date(clock.getTime() + CACHE_TTL_MS);
		await getOrRefreshGame(d, 744834);
		expect(spy.calls()).toBe(2);
	});
});
