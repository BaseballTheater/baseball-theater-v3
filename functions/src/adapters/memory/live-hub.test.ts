/** S18: the in-memory LiveGameHub — newer versions only, full state on connect when behind. */
import type { GameSnapshot } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import { InMemoryLiveGameHub } from "./live-hub.js";
import { InMemoryGameRepository } from "./repos.js";

const snap = (version: number) => ({
	gamePk: 999,
	version,
}) as unknown as GameSnapshot;

function viewer()
{
	const got: number[] = [];
	return {
		got,
		send: (message: string) => void got.push((JSON.parse(message) as GameSnapshot).version),
	};
}

describe("InMemoryLiveGameHub", () =>
{
	it("a connected viewer gets each newer version once; a repeat or older one is dropped; disconnecting stops delivery", async () =>
	{
		const hub = new InMemoryLiveGameHub(new InMemoryGameRepository());
		const v = viewer();
		const disconnect = await hub.connect(999, v);
		await hub.publish(999, snap(1));
		await hub.publish(999, snap(1));
		await hub.publish(999, snap(2));
		await hub.publish(999, snap(1));
		expect(v.got).toEqual([1, 2]);
		disconnect();
		await hub.publish(999, snap(3));
		expect(v.got).toEqual([1, 2]);
	});

	it("a viewer behind gets the full current state on connect; one already current gets nothing", async () =>
	{
		const hub = new InMemoryLiveGameHub(new InMemoryGameRepository());
		await hub.publish(999, snap(2));
		const behind = viewer();
		const fresh = viewer();
		const none = viewer();
		await hub.connect(999, behind, 1);
		await hub.connect(999, fresh, 2);
		await hub.connect(999, none);
		expect(behind.got).toEqual([2]);
		expect(fresh.got).toEqual([]);
		expect(none.got).toEqual([2]);
	});
});
