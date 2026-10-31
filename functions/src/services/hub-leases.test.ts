/** S48: hub leases in the ingest object's storage (ADR-020). */
import {
	describe, expect, it,
} from "vitest";
import { FakeDurableStorage } from "./fake-durable-storage.js";
import {
	HUB_LEASE_MS, HubLeases, MAX_PUBLISH_FAILURES,
} from "./hub-leases.js";

const T0 = new Date("2026-10-30T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("HubLeases", () =>
{
	it("register: a registered hub is live, and the registry is in storage, so a new instance over it sees it", async () =>
	{
		const storage = new FakeDurableStorage();
		await new HubLeases(storage).register("hub-a", T0);
		expect(await new HubLeases(storage).live(T0)).toEqual(["hub-a"]);
	});

	it("renew: extends a live lease past its first expiry; a lapsed or unknown hub must register again", async () =>
	{
		const leases = new HubLeases(new FakeDurableStorage());
		await leases.register("hub-a", T0);
		expect(await leases.renew("hub-a", at(HUB_LEASE_MS - 1))).toBe(true);
		expect(await leases.live(at(HUB_LEASE_MS + 1))).toEqual(["hub-a"]);
		expect(await leases.renew("hub-a", at(3 * HUB_LEASE_MS))).toBe(false);
		expect(await leases.renew("nobody", T0)).toBe(false);
	});

	it("unregister: the hub is gone at once", async () =>
	{
		const leases = new HubLeases(new FakeDurableStorage());
		await leases.register("hub-a", T0);
		await leases.register("hub-b", T0);
		await leases.unregister("hub-a");
		expect(await leases.live(T0)).toEqual(["hub-b"]);
	});

	it("expired: a lease not renewed in time is dropped from storage", async () =>
	{
		const storage = new FakeDurableStorage();
		const leases = new HubLeases(storage);
		await leases.register("hub-a", T0);
		await leases.register("hub-b", at(HUB_LEASE_MS / 2));
		expect(await leases.live(at(HUB_LEASE_MS))).toEqual(["hub-b"]);
		expect(Object.keys(storage.values.get("hubLeases") as object)).toEqual(["hub-b"]);
	});

	it("three failed publishes in a row drop a hub; a success in between resets the count", async () =>
	{
		const leases = new HubLeases(new FakeDurableStorage());
		await leases.register("hub-a", T0);
		await leases.recordPublish("hub-a", false);
		await leases.recordPublish("hub-a", false);
		await leases.recordPublish("hub-a", true);
		await leases.recordPublish("hub-a", false);
		await leases.recordPublish("hub-a", false);
		expect(await leases.live(T0)).toEqual(["hub-a"]);
		await leases.recordPublish("hub-a", false);
		expect(MAX_PUBLISH_FAILURES).toBe(3);
		expect(await leases.live(T0)).toEqual([]);
		await leases.recordPublish("hub-a", false);
		expect(await leases.live(T0)).toEqual([]);
	});
});
