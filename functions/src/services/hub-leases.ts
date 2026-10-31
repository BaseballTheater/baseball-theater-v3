/**
 * The hubs a game's ingest object publishes to (S48; ADR-020 layer 1). A hub (S18) that
 * has viewers for the game registers here and renews its lease while it does; a hub that
 * goes quiet lapses on its own, so a crashed hub is never published to for long. Kept in
 * the ingest object's Durable Object storage, so the registry survives the object being
 * evicted between alarms.
 */

/** The part of Durable Object storage BT's ingest uses (`state.storage`); a Map-backed fake in tests. */
export interface DurableStore
{
	get<T>(key: string): Promise<T | undefined>;
	put<T>(key: string, value: T): Promise<void>;
	delete(key: string): Promise<boolean>;
}

/** How long a registration or renewal holds without another renewal. */
export const HUB_LEASE_MS = 60 * 1000;

/** Publishes that may fail in a row before the hub is dropped (ADR-020). */
export const MAX_PUBLISH_FAILURES = 3;

type Lease = {
	expiresAt: number;
	/** Publishes that failed since the last one that worked. */
	failures: number;
};

type Leases = Record<string, Lease>;

const KEY = "hubLeases";

export class HubLeases
{
	constructor(private readonly store: DurableStore) {}

	private async read(): Promise<Leases>
	{
		return await this.store.get<Leases>(KEY) ?? {};
	}

	private write(leases: Leases): Promise<void>
	{
		return this.store.put(KEY, leases);
	}

	/** Adds `hubId` (or restarts its lease), with no failures counted. */
	async register(hubId: string, now: Date, leaseMs: number = HUB_LEASE_MS): Promise<void>
	{
		const leases = await this.read();
		leases[hubId] = {
			expiresAt: now.getTime() + leaseMs,
			failures: 0,
		};
		await this.write(leases);
	}

	/** Extends a live lease; false when `hubId` isn't registered (or has lapsed), and it must register again. */
	async renew(hubId: string, now: Date, leaseMs: number = HUB_LEASE_MS): Promise<boolean>
	{
		const leases = await this.read();
		const lease = leases[hubId];
		if (!lease || lease.expiresAt <= now.getTime()) return false;
		lease.expiresAt = now.getTime() + leaseMs;
		await this.write(leases);
		return true;
	}

	async unregister(hubId: string): Promise<void>
	{
		const leases = await this.read();
		delete leases[hubId];
		await this.write(leases);
	}

	/** The hubs to publish to at `now`; lapsed leases are dropped from storage on the way. */
	async live(now: Date): Promise<string[]>
	{
		const leases = await this.read();
		const expired = Object.keys(leases).filter((id) => leases[id]!.expiresAt <= now.getTime());
		for (const id of expired) delete leases[id];
		if (expired.length > 0) await this.write(leases);
		return Object.keys(leases);
	}

	/**
	 * Records one publish to `hubId`: a success clears its failures; the
	 * `MAX_PUBLISH_FAILURES`th failure in a row drops it.
	 */
	async recordPublish(hubId: string, ok: boolean): Promise<void>
	{
		const leases = await this.read();
		const lease = leases[hubId];
		if (!lease) return;
		lease.failures = ok ? 0 : lease.failures + 1;
		if (lease.failures >= MAX_PUBLISH_FAILURES) delete leases[hubId];
		await this.write(leases);
	}
}
