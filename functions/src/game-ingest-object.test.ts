/**
 * S48: the `game-ingest:<gamePk>` Durable Object shell in Node, over fake storage (the
 * workerd test runs the real one): its routes reach `GameIngest`, and its alarm polls.
 */
import {
	describe, expect, it,
} from "vitest";
import {
	ensureGameIngest, GameIngestObject, stubHubPublisher,
} from "./game-ingest-object.js";
import { FakeDurableStorage } from "./services/fake-durable-storage.js";

function object()
{
	const storage = new FakeDurableStorage();
	return {
		storage,
		object: new GameIngestObject({
			storage,
		}, {}),
	};
}

const post = (path: string) => new Request(`https://game-ingest${path}`, {
	method: "POST",
});

describe("GameIngestObject", () =>
{
	it("POST /ensure arms one alarm however often it is called, and rejects a missing gamePk", async () =>
	{
		const { object: o, storage } = object();
		expect(await (await o.fetch(post("/ensure?gamePk=745001"))).json()).toEqual({
			armed: true,
		});
		expect(await (await o.fetch(post("/ensure?gamePk=745001"))).json()).toEqual({
			armed: false,
		});
		expect(storage.armed).toHaveLength(1);
		expect((await o.fetch(post("/ensure"))).status).toBe(400);
	});

	it("hub routes register, renew and unregister a lease; anything else is 404", async () =>
	{
		const { object: o } = object();
		expect((await o.fetch(post("/hubs/register?hub=hub-a"))).status).toBe(204);
		expect((await o.fetch(post("/hubs/renew?hub=hub-a"))).status).toBe(204);
		expect((await o.fetch(post("/hubs/unregister?hub=hub-a"))).status).toBe(204);
		expect((await o.fetch(post("/hubs/renew?hub=hub-a"))).status).toBe(410);
		expect((await o.fetch(post("/hubs/register"))).status).toBe(404);
		expect((await o.fetch(post("/elsewhere"))).status).toBe(404);
	});

	it("its alarm polls the game and arms the next one; the stub publisher accepts anything", async () =>
	{
		const { object: o, storage } = object();
		await o.fetch(post("/hubs/register?hub=hub-a"));
		await o.fetch(post("/ensure?gamePk=745001"));
		await o.alarm();
		expect(storage.armed).toHaveLength(2);
		await expect(stubHubPublisher("hub-a", {} as never)).resolves.toBeUndefined();
	});
});

describe("ensureGameIngest", () =>
{
	it("posts /ensure to the object named for the game, and throws on a failed answer", async () =>
	{
		const calls: string[] = [];
		const namespace = (status: number) => ({
			idFromName: (name: string) => name,
			get: (id: never) => ({
				fetch: async (input: string) =>
				{
					calls.push(`${String(id)} ${input}`);
					return new Response(null, {
						status,
					});
				},
			}),
		});
		await ensureGameIngest(namespace(200), 745001);
		expect(calls).toEqual(["game-ingest:745001 https://game-ingest/ensure?gamePk=745001"]);
		await expect(ensureGameIngest(namespace(500), 745001)).rejects.toThrow("game-ingest 745001: 500");
	});
});
