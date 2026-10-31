/**
 * S18: the `game-hub:<gamePk>` Durable Object in Node, over fake state and stand-ins for
 * the runtime's WebSocket pieces (the workerd test runs the real ones): hibernation
 * sockets, one-way, newer versions only, cold start from the repository, and the lease
 * with the game's ingest object.
 */
import type { GameSnapshot } from "@bt/domain";
import {
	beforeAll, describe, expect, it, vi,
} from "vitest";
import type { HubSocket } from "./adapters/cloudflare/websocket.js";
import {
	GameHubObject, gameHubName, hubPublisher,
} from "./game-hub-object.js";
import { FakeDurableStorage } from "./services/fake-durable-storage.js";
import { workerApp } from "./worker-app.js";

vi.mock("./adapters/cloudflare/websocket.js", () => ({
	openSocketPair: () =>
	{
		const server = {
			sent: [] as string[],
			send(message: string)
			{
				this.sent.push(message);
			},
			close: () => undefined,
		};
		return {
			client: {
				send: () => undefined,
				close: () => undefined,
			},
			server,
		};
	},
	upgradeResponse: () => new Response("upgraded", {
		status: 200,
	}),
	pingAutoResponse: () => "ping→pong",
}));

type TestSocket = HubSocket & { sent: string[] };

/** Fake Durable Object state that records what the hub asks of the runtime. */
function hubState()
{
	const sockets: TestSocket[] = [];
	return {
		storage: new FakeDurableStorage(),
		sockets,
		autoResponse: undefined as unknown,
		acceptWebSocket(socket: HubSocket)
		{
			sockets.push(socket as TestSocket);
		},
		getWebSockets: () => [...sockets],
		setWebSocketAutoResponse(pair: unknown)
		{
			this.autoResponse = pair;
		},
	};
}

/** A stand-in for `env.GAME_INGEST` that records the hub's lease calls. */
function ingestStub(renewStatus = 204)
{
	const calls: string[] = [];
	return {
		calls,
		namespace: {
			idFromName: (name: string) => name,
			get: (id: never) => ({
				fetch: async (input: string) =>
				{
					const { pathname, searchParams } = new URL(input);
					calls.push(`${String(id)} ${pathname} ${searchParams.get("hub")}`);
					return new Response(null, {
						status: pathname.endsWith("renew") ? renewStatus : 204,
					});
				},
			}),
		},
	};
}

const connect = (hub: GameHubObject, query: string) => hub.fetch(new Request(`https://game-hub/connect?${query}`, {
	headers: {
		Upgrade: "websocket",
	},
}));
const publish = (hub: GameHubObject, game: Pick<GameSnapshot, "gamePk" | "version">) => hub.fetch(new Request("https://game-hub/publish", {
	method: "POST",
	body: JSON.stringify(game),
}));
const versions = (socket: TestSocket | undefined) => (socket?.sent ?? []).map((m) => (JSON.parse(m) as GameSnapshot).version);

beforeAll(async () =>
{
	await workerApp({}).ready;
});

describe("GameHubObject", () =>
{
	it("hibernation: sockets are accepted through acceptWebSocket, and pings are answered by the runtime's auto-response", async () =>
	{
		const state = hubState();
		const hub = new GameHubObject(state, {});
		expect(state.autoResponse).toBe("ping→pong");
		expect((await connect(hub, "gamePk=999")).status).toBe(200);
		expect(state.sockets).toHaveLength(1);
	});

	it("client messages are ignored: nothing is sent and nothing stored", async () =>
	{
		const state = hubState();
		const hub = new GameHubObject(state, {});
		await connect(hub, "gamePk=999");
		expect(hub.webSocketMessage()).toBeUndefined();
		expect(state.sockets[0]?.sent).toEqual([]);
	});

	it("passes each newer version to every viewer once; a repeat is dropped", async () =>
	{
		const state = hubState();
		const hub = new GameHubObject(state, {});
		await connect(hub, "gamePk=999");
		await connect(hub, "gamePk=999");
		for (const version of [1, 1, 2]) expect((await publish(hub, {
			gamePk: 999,
			version,
		})).status).toBe(204);
		expect(state.sockets.map(versions)).toEqual([[1, 2], [1, 2]]);
		expect((await hub.fetch(new Request("https://game-hub/elsewhere"))).status).toBe(404);
	});

	it("a freshly started hub loads the latest state through the repository and sends it on connect; ?since at that version gets nothing", async () =>
	{
		const stored = await workerApp({}).ingest.games.getByPk(745001);
		expect(stored).not.toBeNull();
		const first = hubState();
		await connect(new GameHubObject(first, {}), "gamePk=745001");
		expect(versions(first.sockets[0])).toEqual([stored!.version]);
		const current = hubState();
		await connect(new GameHubObject(current, {}), `gamePk=745001&since=${stored!.version}`);
		expect(versions(current.sockets[0])).toEqual([]);
	});

	it("the first viewer registers the hub with its game's ingest object and arms the renewal; a second viewer doesn't register again", async () =>
	{
		const ingest = ingestStub();
		const state = hubState();
		const hub = new GameHubObject(state, {
			GAME_INGEST: ingest.namespace,
		});
		await connect(hub, "gamePk=999");
		await connect(hub, "gamePk=999");
		expect(ingest.calls).toEqual(["game-ingest:999 /hubs/register game-hub:999"]);
		expect(state.storage.alarmAt).not.toBeNull();
	});

	it("the alarm renews the lease while viewers remain, and registers again when the lease had lapsed; with no viewers it does nothing", async () =>
	{
		const lapsed = ingestStub(410);
		const state = hubState();
		const hub = new GameHubObject(state, {
			GAME_INGEST: lapsed.namespace,
		});
		await hub.alarm();
		await connect(hub, "gamePk=999");
		await hub.alarm();
		expect(lapsed.calls).toEqual([
			"game-ingest:999 /hubs/register game-hub:999",
			"game-ingest:999 /hubs/renew game-hub:999",
			"game-ingest:999 /hubs/register game-hub:999",
		]);
		state.sockets.length = 0;
		await hub.alarm();
		expect(lapsed.calls).toHaveLength(3);
	});

	it("the last disconnect unregisters the hub and stops renewing; an earlier one doesn't", async () =>
	{
		const ingest = ingestStub();
		const state = hubState();
		const hub = new GameHubObject(state, {
			GAME_INGEST: ingest.namespace,
		});
		await connect(hub, "gamePk=999");
		await connect(hub, "gamePk=999");
		const [a, b] = state.sockets;
		await hub.webSocketClose(a!);
		expect(ingest.calls).toHaveLength(1);
		state.sockets.splice(0, 1);
		await hub.webSocketClose(b!);
		expect(ingest.calls.at(-1)).toBe("game-ingest:999 /hubs/unregister game-hub:999");
		expect(state.storage.alarmAt).toBeNull();
		// Without a binding there is no lease to give up.
		const bare = hubState();
		const alone = new GameHubObject(bare, {});
		await connect(alone, "gamePk=999");
		await alone.webSocketClose(bare.sockets[0]!);
	});
});

describe("hubPublisher", () =>
{
	it("posts the snapshot to the hub named, and rejects on a failed answer", async () =>
	{
		const posted: string[] = [];
		const namespace = (status: number) => ({
			idFromName: (name: string) => name,
			get: (id: never) => ({
				fetch: async (input: string, init?: RequestInit) =>
				{
					posted.push(`${String(id)} ${input} ${String(init?.body)}`);
					return new Response(null, {
						status,
					});
				},
			}),
		});
		const game = {
			gamePk: 999,
			version: 3,
		} as GameSnapshot;
		await hubPublisher(namespace(204))(gameHubName(999), game);
		expect(posted).toEqual([`game-hub:999 https://game-hub/publish ${JSON.stringify(game)}`]);
		await expect(hubPublisher(namespace(500))("game-hub:999", game)).rejects.toThrow("game-hub:999: 500");
	});
});
