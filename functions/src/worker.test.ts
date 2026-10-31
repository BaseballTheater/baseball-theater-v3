/**
 * S45: the Worker entry and its composition, exercised in Node (coverage lives here;
 * `worker.workerd.test.ts` runs the same Worker inside workerd). The fixture client is
 * the default and the live one opt-in; the cron ensures per-game ingest objects (S48)
 * deployed, and in local dev only behind BT_INGEST_TICK.
 */
import {
	describe, expect, it, vi,
} from "vitest";
import { FixtureClient } from "./adapters/fixtures/fixture-client.js";
import { HttpMlbStatsClient } from "./adapters/http/mlb.js";
import * as gameIngest from "./services/game-ingest.js";
import worker from "./worker.js";
import {
	createMlbClient, createWorkerApp, tickAllowed, workerApp,
} from "./worker-app.js";

describe("the Worker composition (S45)", () =>
{
	it("the bundled fixture client by default; live statsapi only with BT_USE_LIVE_MLB=1", () =>
	{
		expect(createMlbClient({})).toBeInstanceOf(FixtureClient);
		expect(createMlbClient({
			BT_USE_LIVE_MLB: "0",
		})).toBeInstanceOf(FixtureClient);
		expect(createMlbClient({
			BT_USE_LIVE_MLB: "1",
		})).toBeInstanceOf(HttpMlbStatsClient);
	});

	it("seeds the configured day, with a given session key and app origin", async () =>
	{
		const app = createWorkerApp({
			BT_SEED_DATE: "2026-09-05",
			BT_SESSION_KEY: "k",
			BT_APP_ORIGIN: "https://bt.test",
		});
		await app.ready;
		expect((await app.ingest.schedules.getByDate("2026-09-05"))?.games.length).toBe(15);
	});

	it("one app per isolate", () =>
	{
		expect(workerApp({})).toBe(workerApp({
			BT_USE_LIVE_MLB: "1",
		}));
	});

	it("the cron tick runs deployed, and in local dev only with BT_INGEST_TICK=1", () =>
	{
		expect(tickAllowed({})).toBe(true);
		expect(tickAllowed({
			BT_LOCAL: "1",
		})).toBe(false);
		expect(tickAllowed({
			BT_LOCAL: "1",
			BT_INGEST_TICK: "1",
		})).toBe(true);
	});
});

describe("the Worker entry (S45)", () =>
{
	it("fetch answers the API through handleApiRequest", async () =>
	{
		const res = await worker.fetch(new Request("http://bt.test/api/v1/games/744834"), {});
		expect(res.status).toBe(200);
		expect((await res.json() as { gamePk: number }).gamePk).toBe(744834);
	});

	it("scheduled ensures a game-ingest object for each in-window game when allowed and bound, and nothing in local dev without the gate", async () =>
	{
		const ensure = vi.spyOn(gameIngest, "ensureIngestRunning");
		const fetches: string[] = [];
		const namespace = {
			idFromName: (name: string) => name,
			get: (id: never) => ({
				fetch: async (input: string) =>
				{
					fetches.push(`${String(id)} ${input}`);
					return Response.json({
						armed: true,
					});
				},
			}),
		};
		const waits: Promise<unknown>[] = [];
		const ctx = {
			waitUntil: (p: Promise<unknown>) => void waits.push(p),
		};
		await worker.scheduled(undefined, {
			BT_LOCAL: "1",
			GAME_INGEST: namespace,
		}, ctx);
		await worker.scheduled(undefined, {}, ctx);
		expect(ensure).not.toHaveBeenCalled();
		await worker.scheduled(undefined, {
			GAME_INGEST: namespace,
		}, ctx);
		expect(ensure).toHaveBeenCalledTimes(1);
		const ensured = await waits[0] as number[];
		expect(fetches).toEqual(ensured.map((pk) => `game-ingest:${pk} https://game-ingest/ensure?gamePk=${pk}`));
		ensure.mockRestore();
	});
});
