/**
 * S47 (ADR-021): the edge cache header on schedule and game responses. Out of the live
 * window the edge keeps a response for `cacheLifetimeMs(now − lastChangedAt)`; in the
 * window it keeps nothing; a refresh that finds new content drops back to the floor.
 */
import type { MlbStatsClient } from "@bt/ports";
import {
	describe, expect, it,
} from "vitest";
import { createDevAccountData, createDevAuth } from "../adapters/fixtures/auth.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository,
	InMemoryGameRepository,
	InMemoryScheduleRepository,
	InMemorySettingsRepository,
} from "../adapters/memory/repos.js";
import { RefreshCoordinator } from "../services/refresh.js";
import { handleApiRequest } from "./api.js";
import { edgeCacheControl, STALE_WHILE_REVALIDATE_S } from "./cache-control.js";

const HOUR = 60 * 60 * 1000;
/** Long after 823823 (2026-09-05) and its schedule day, so both are out of their window. */
const T0 = new Date("2026-10-30T12:00:00Z");

/** One API over shared in-memory stores, read at whatever `clock.now` says. */
function api(mlb: MlbStatsClient = new FixtureMlbStatsClient())
{
	const clock = {
		now: T0,
	};
	const auth = createDevAuth();
	const settings = new InMemorySettingsRepository();
	const ctx = {
		ingest: {
			mlb,
			schedules: new InMemoryScheduleRepository(),
			games: new InMemoryGameRepository(),
			projections: new InMemoryGameProjectionRepository(),
			now: () => clock.now,
			refresh: new RefreshCoordinator(() => clock.now),
		},
		auth,
		settings,
		account: createDevAccountData({
			users: auth.users,
			settings,
		}),
	};
	return {
		clock,
		games: ctx.ingest.games,
		get: (path: string) => handleApiRequest(new Request(`http://localhost:8787${path}`), ctx),
	};
}

describe("edgeCacheControl", () =>
{
	it("out of window: s-maxage follows the ladder from the last change, with stale-while-revalidate", () =>
	{
		const lastChangedAt = T0.toISOString();
		expect(edgeCacheControl({
			windowMode: "cache",
			lastChangedAt,
		}, T0)).toBe(`public, s-maxage=300, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
		expect(edgeCacheControl({
			windowMode: "cache",
			lastChangedAt,
		}, new Date(T0.getTime() + 3 * HOUR))).toBe(`public, s-maxage=36000, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
		expect(edgeCacheControl({
			windowMode: "cache",
			lastChangedAt,
		}, new Date(T0.getTime() + 30 * 24 * HOUR))).toBe(`public, s-maxage=172800, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
	});

	it("in window, or without a last change to judge by, the edge stores nothing", () =>
	{
		expect(edgeCacheControl({
			windowMode: "active",
			lastChangedAt: T0.toISOString(),
		}, new Date(T0.getTime() + 30 * 24 * HOUR))).toBe("no-store");
		expect(edgeCacheControl({
			windowMode: "cache",
		}, T0)).toBe("no-store");
		expect(edgeCacheControl({
			windowMode: "cache",
			lastChangedAt: "not a date",
		}, T0)).toBe("no-store");
	});
});

describe("GET /api/v1/games/:gamePk and /api/v1/schedule Cache-Control (S47)", () =>
{
	it("out of window: a game and a schedule unchanged for 3h get s-maxage=36000", async () =>
	{
		const { clock, get } = api();
		expect((await get("/api/v1/games/823823")).headers.get("Cache-Control")).toBe(`public, s-maxage=300, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
		expect((await get("/api/v1/schedule?date=2026-09-05")).headers.get("Cache-Control")).toBe(`public, s-maxage=300, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
		clock.now = new Date(T0.getTime() + 3 * HOUR);
		expect((await get("/api/v1/games/823823")).headers.get("Cache-Control")).toBe(`public, s-maxage=36000, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
		expect((await get("/api/v1/schedule?date=2026-09-05")).headers.get("Cache-Control")).toBe(`public, s-maxage=36000, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
	});

	it("in window: a game being played is never cached past the floor at the edge, however long it has gone unchanged", async () =>
	{
		const {
			clock, games, get,
		} = api();
		await get("/api/v1/games/823823");
		const stored = (await games.getByPk(823823))!;
		// The same game as ingest stores it while it is in its live window (ADR-002).
		await games.upsert({
			...stored,
			windowMode: "active",
			version: stored.version + 1,
		});
		clock.now = new Date(T0.getTime() + 30 * HOUR);
		const header = (await get("/api/v1/games/823823")).headers.get("Cache-Control") ?? "";
		const maxAge = /s-maxage=(\d+)/.exec(header);
		expect(maxAge === null || Number(maxAge[1]) <= 300).toBe(true);
		expect(header).toBe("no-store");
	});

	it("resets: a refresh that finds changed content drops the next response back to the floor", async () =>
	{
		const real = new FixtureMlbStatsClient();
		let changed = false;
		const mlb: MlbStatsClient = {
			fetchSchedule: (d) => real.fetchSchedule(d),
			fetchGame: async (pk) =>
			{
				const game = await real.fetchGame(pk);
				return changed && game ? {
					...game,
					status: {
						...game.status,
						detailedState: "Final: scoring change",
					},
				} : game;
			},
			fetchGameContent: (pk) => real.fetchGameContent(pk),
			fetchStandings: (d) => real.fetchStandings(d),
			fetchPlayers: (ids) => real.fetchPlayers(ids),
			fetchGameTimestamps: (pk) => real.fetchGameTimestamps(pk),
			fetchGameDiffPatch: (pk, s, e) => real.fetchGameDiffPatch(pk, s, e),
		};
		const { clock, get } = api(mlb);
		await get("/api/v1/games/823823");
		clock.now = new Date(T0.getTime() + 3 * HOUR);
		expect((await get("/api/v1/games/823823")).headers.get("Cache-Control")).toContain("s-maxage=36000");
		changed = true;
		// The 3h read re-checked (nothing new) and earned 10h; past that, the next read refreshes and finds the scoring change.
		clock.now = new Date(T0.getTime() + 14 * HOUR);
		expect((await get("/api/v1/games/823823")).headers.get("Cache-Control")).toBe(`public, s-maxage=300, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
	});
});
