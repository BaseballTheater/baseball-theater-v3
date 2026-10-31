/**
 * S18: the `game-hub:<gamePk>` Durable Object inside workerd with real WebSockets: only
 * newer versions reach a viewer, and `?since` decides what a viewer gets on connect.
 * Game 999 has nothing stored, so a hub starts empty. Run with
 * `pnpm --filter @bt/functions test:workerd`.
 */
import { env } from "cloudflare:test";
import {
	describe, expect, it,
} from "vitest";

type Socket = { accept(): void;
	close(): void;
	addEventListener(type: "message", listener: (event: { data: string }) => void): void; };

const hub = (name: string) => env.GAME_HUB.get(env.GAME_HUB.idFromName(name));

/** Connects a viewer to `name` and collects the versions it receives. */
async function viewer(name: string, since?: number)
{
	const res = await hub(name).fetch(`https://game-hub/connect?gamePk=999${since === undefined ? "" : `&since=${since}`}`, {
		headers: {
			Upgrade: "websocket",
		},
	});
	expect(res.status).toBe(101);
	const socket = (res as Response & { webSocket: Socket }).webSocket;
	const got: number[] = [];
	socket.addEventListener("message", (event) => void got.push((JSON.parse(event.data) as { version: number }).version));
	socket.accept();
	return {
		got,
		socket,
	};
}

const publish = (name: string, version: number) => hub(name).fetch("https://game-hub/publish", {
	method: "POST",
	body: JSON.stringify({
		gamePk: 999,
		version,
	}),
});

/** Lets queued socket messages arrive. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("GameHubObject on workerd (S18)", () =>
{
	it("publishing v1, v1, v2 reaches a connected viewer as exactly v1 and v2", async () =>
	{
		const v = await viewer("game-hub:999:a");
		for (const version of [1, 1, 2]) expect((await publish("game-hub:999:a", version)).status).toBe(204);
		await settle();
		expect(v.got).toEqual([1, 2]);
		v.socket.close();
	});

	it("after v2, a viewer connecting with ?since=1 gets v2's full state; with ?since=2, nothing", async () =>
	{
		await publish("game-hub:999:b", 1);
		await publish("game-hub:999:b", 2);
		const behind = await viewer("game-hub:999:b", 1);
		const current = await viewer("game-hub:999:b", 2);
		await settle();
		expect(behind.got).toEqual([2]);
		expect(current.got).toEqual([]);
		behind.socket.close();
		current.socket.close();
	});
});
