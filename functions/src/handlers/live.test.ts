/**
 * S18: `GET /api/v1/games/:gamePk/live` — a WebSocket only for a game in its window
 * (745001, in progress); a finished one (744834) is pointed at the cached GET.
 */
import {
	describe, expect, it, vi,
} from "vitest";
import { migratedPglite } from "../adapters/postgres/migrate.js";
import { ingestScheduleDay } from "../services/ingest.js";
import { createWorkerApp, liveForwarder } from "../worker-app.js";
import { handleApiRequest } from "./api.js";

const upgrade = {
	Upgrade: "websocket",
};

async function api(live?: (gamePk: number, request: Request) => Promise<Response>)
{
	const app = createWorkerApp({}, (await migratedPglite()).db);
	await ingestScheduleDay(app.ingest, "2024-07-04");
	return (path: string, headers: Record<string, string> = upgrade) => handleApiRequest(new Request(`http://bt.test${path}`, {
		headers,
	}), {
		...app.context,
		live,
	});
}

describe("GET /api/v1/games/:gamePk/live", () =>
{
	it("in-window: a game in progress is handed to its hub", async () =>
	{
		const live = vi.fn(async () => new Response("to the hub"));
		const get = await api(live);
		const res = await get("/api/v1/games/745001/live?since=3");
		expect(await res.text()).toBe("to the hub");
		expect(live).toHaveBeenCalledWith(745001, expect.any(Request));
	});

	it("out of window: a finished game gets a 4xx pointing at the cached GET, and never reaches a hub", async () =>
	{
		const live = vi.fn(async () => new Response("to the hub"));
		const get = await api(live);
		const res = await get("/api/v1/games/744834/live");
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({
			error: "not_live",
			hint: "/api/v1/games/744834",
		});
		expect(live).not.toHaveBeenCalled();
	});

	it("refuses a plain GET (426), an unknown game (404) and a server without hubs (501), each pointing at the cached GET", async () =>
	{
		expect((await (await api())("/api/v1/games/745001/live", {})).status).toBe(426);
		expect((await (await api())("/api/v1/games/1/live")).status).toBe(404);
		const res = await (await api())("/api/v1/games/745001/live");
		expect(res.status).toBe(501);
		expect(await res.json()).toMatchObject({
			hint: "/api/v1/games/745001",
		});
	});
});

describe("liveForwarder", () =>
{
	it("forwards the upgrade to game-hub:<gamePk> as /connect, keeping since", async () =>
	{
		const seen: string[] = [];
		const namespace = {
			idFromName: (name: string) => name,
			get: (id: never) => ({
				fetch: async (input: string, init?: RequestInit) =>
				{
					seen.push(`${String(id)} ${input} ${new Headers(init?.headers).get("Upgrade")}`);
					return new Response(null);
				},
			}),
		};
		const forward = liveForwarder(namespace);
		await forward(745001, new Request("http://bt.test/api/v1/games/745001/live?since=2", {
			headers: upgrade,
		}));
		await forward(745001, new Request("http://bt.test/api/v1/games/745001/live", {
			headers: upgrade,
		}));
		expect(seen).toEqual([
			"game-hub:745001 https://game-hub/connect?gamePk=745001&since=2 websocket",
			"game-hub:745001 https://game-hub/connect?gamePk=745001 websocket",
		]);
		expect(createWorkerApp({
			GAME_HUB: namespace,
		}, (await migratedPglite()).db).context.live).toBeTypeOf("function");
	});
});
