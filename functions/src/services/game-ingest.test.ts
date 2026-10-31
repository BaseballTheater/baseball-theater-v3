/**
 * S48: one game's ingest (ADR-020 layer 1) — ensured once, polled by its alarm through
 * `MlbStatsClient`, written before it is published, and stopped with the final state once
 * the game leaves its window. Fixture 745001 is a game in progress, so it is always in
 * its window.
 */
import type { GameSnapshot } from "@bt/domain";
import { DEFAULT_CADENCE, isGameInActiveWindow } from "@bt/domain";
import {
	describe, expect, it, vi,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository,
	InMemoryGameRepository,
	InMemoryScheduleRepository,
} from "../adapters/memory/repos.js";
import { FakeDurableStorage } from "./fake-durable-storage.js";
import {
	ensureIngestRunning, GameIngest, gameIngestName,
} from "./game-ingest.js";
import type { IngestDeps } from "./ingest.js";

const T0 = new Date("2026-10-30T12:00:00Z");

/** Ingest deps over the fixtures, with `fetchGame` counted and optionally rewritten. */
function setup(rewrite: (game: Awaited<ReturnType<FixtureMlbStatsClient["fetchGame"]>>) => typeof game = (game) => game)
{
	const real = new FixtureMlbStatsClient();
	const mlb = new FixtureMlbStatsClient();
	const fetchGame = vi.fn(async (pk: number) => rewrite(await real.fetchGame(pk)));
	mlb.fetchGame = fetchGame;
	const order: string[] = [];
	const games = new InMemoryGameRepository();
	const upsert = games.upsert.bind(games);
	games.upsert = async (game) =>
	{
		order.push("write");
		await upsert(game);
	};
	const deps: IngestDeps = {
		mlb,
		schedules: new InMemoryScheduleRepository(),
		games,
		projections: new InMemoryGameProjectionRepository(),
	};
	const published: { hubId: string;
		snapshot: GameSnapshot; }[] = [];
	const publish = vi.fn(async (hubId: string, snapshot: GameSnapshot) =>
	{
		order.push("publish");
		published.push({
			hubId,
			snapshot,
		});
	});
	const storage = new FakeDurableStorage();
	return {
		deps,
		fetchGame,
		games,
		order,
		publish,
		published,
		storage,
		ingest: new GameIngest(storage, deps, publish),
	};
}

describe("GameIngest", () =>
{
	it("ensureRunning: called twice for one game arms exactly one alarm", async () =>
	{
		const { ingest, storage } = setup();
		expect(gameIngestName(745001)).toBe("game-ingest:745001");
		expect(await ingest.ensureRunning(745001, T0)).toBe(true);
		expect(await ingest.ensureRunning(745001, T0)).toBe(false);
		expect(storage.armed).toEqual([T0.getTime()]);
	});

	it("unchanged: the alarm polls 745001 through MlbStatsClient; a second, unchanged payload makes no new version and publishes nothing", async () =>
	{
		const {
			ingest, fetchGame, games, publish,
		} = setup();
		await ingest.hubs.register("hub-a", T0);
		await ingest.ensureRunning(745001, T0);
		await ingest.alarm(T0);
		const first = await games.getByPk(745001);
		expect(first?.version).toBe(1);
		await ingest.alarm(new Date(T0.getTime() + DEFAULT_CADENCE.intervalMs));
		expect(fetchGame).toHaveBeenCalledTimes(2);
		expect((await games.getByPk(745001))?.version).toBe(1);
		expect(publish).toHaveBeenCalledTimes(1);
	});

	it("write before publish: the store holds the change before any hub hears of it, and the next alarm is armed", async () =>
	{
		const {
			ingest, order, published, storage,
		} = setup();
		await ingest.hubs.register("hub-a", T0);
		await ingest.ensureRunning(745001, T0);
		await ingest.alarm(T0);
		expect(order).toEqual(["write", "publish"]);
		expect(published.map((p) => [p.hubId, p.snapshot.gamePk, p.snapshot.version])).toEqual([["hub-a", 745001, 1]]);
		expect(storage.alarmAt).toBe(T0.getTime() + DEFAULT_CADENCE.intervalMs);
	});

	it("no hubs: a change is written and nothing is published", async () =>
	{
		const {
			ingest, order, publish,
		} = setup();
		await ingest.ensureRunning(745001, T0);
		await ingest.alarm(T0);
		expect(order).toEqual(["write"]);
		expect(publish).not.toHaveBeenCalled();
	});

	it("a hub that fails to take three publishes in a row is dropped", async () =>
	{
		let n = 0;
		const { ingest, publish } = setup((game) => ({
			...game,
			status: {
				...game.status,
				detailedState: `In Progress ${n++}`,
			},
		}));
		publish.mockRejectedValue(new Error("hub down"));
		await ingest.hubs.register("hub-a", T0);
		await ingest.ensureRunning(745001, T0);
		for (let i = 0; i < 4; i++) await ingest.alarm(new Date(T0.getTime() + i * 1000));
		expect(publish).toHaveBeenCalledTimes(3);
		expect(await ingest.hubs.live(T0)).toEqual([]);
	});

	it("end of the window: the last poll publishes the final state, clears the alarm and arms no other", async () =>
	{
		const {
			ingest, published, storage,
		} = setup((game) => ({
			...game,
			status: {
				abstractGameState: "Final",
				detailedState: "Final",
				codedGameState: "F",
			},
		}));
		await ingest.hubs.register("hub-a", T0);
		await ingest.ensureRunning(745001, T0);
		await ingest.alarm(T0);
		expect(published.map((p) => p.snapshot.status.codedGameState)).toEqual(["F"]);
		expect(published[0]?.snapshot.windowMode).toBe("cache");
		expect(storage.alarmAt).toBeNull();
		expect(storage.armed).toEqual([T0.getTime()]);
		// Nothing left to poll: a stray alarm does nothing.
		await ingest.alarm(T0);
		expect(published).toHaveLength(1);
	});

	it("a failed MLB call writes nothing and keeps the cadence", async () =>
	{
		const {
			ingest, fetchGame, order, storage,
		} = setup();
		fetchGame.mockRejectedValueOnce(new Error("MLB down"));
		await ingest.ensureRunning(745001, T0);
		await ingest.alarm(T0);
		expect(order).toEqual([]);
		expect(storage.alarmAt).toBe(T0.getTime() + DEFAULT_CADENCE.intervalMs);
	});
});

describe("ensureIngestRunning", () =>
{
	it("ensures an ingest object for each in-window game of today's schedule and stores the schedule; one that won't start doesn't stop the rest", async () =>
	{
		const now = new Date("2024-07-04T23:00:00Z");
		const { deps } = setup();
		const day = await new FixtureMlbStatsClient().fetchSchedule("2024-07-04");
		const inWindow = day.games.filter((g) => isGameInActiveWindow(g, now)).map((g) => g.gamePk);
		expect(inWindow).toContain(745001);
		const ensure = vi.fn(async (_gamePk: number) => undefined);
		expect(await ensureIngestRunning(deps, ensure, now)).toEqual(inWindow);
		expect(ensure.mock.calls.map(([pk]) => pk)).toEqual(inWindow);
		expect(await deps.schedules.getByDate("2024-07-04")).not.toBeNull();
		ensure.mockRejectedValueOnce(new Error("object busy"));
		expect(await ensureIngestRunning(deps, ensure, now)).toEqual(inWindow.slice(1));
	});
});

describe("GameIngest between alarms", () =>
{
	it("ensureRunning: while an alarm is due (the runtime reports none) it arms nothing; once alarms have stopped for two intervals it restarts them", async () =>
	{
		const { ingest, storage } = setup();
		await ingest.ensureRunning(745001, T0);
		storage.alarmAt = null;
		expect(await ingest.ensureRunning(745001, new Date(T0.getTime() + 1000))).toBe(false);
		expect(await ingest.ensureRunning(745001, new Date(T0.getTime() + 2 * DEFAULT_CADENCE.intervalMs))).toBe(true);
		expect(storage.armed).toEqual([T0.getTime(), T0.getTime() + 2 * DEFAULT_CADENCE.intervalMs]);
	});
});
