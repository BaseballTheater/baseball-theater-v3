/**
 * One game's ingest (S48; ADR-020 layer 1, ADR-002 cadence): what the
 * `game-ingest:<gamePk>` Durable Object does, as a plain module so it is tested in Node
 * (where the coverage floors live) and the object stays a thin shell over it.
 *
 * The cron makes sure one object runs per in-window game (`ensureRunning`, idempotent:
 * one alarm however often it is called). Each alarm polls MLB through `MlbStatsClient`,
 * writes the game through the same versioned store every ingest path uses (an unchanged
 * payload writes nothing, ADR-022), and **only then** publishes to the hubs leased in
 * its storage, so a viewer is never told about a change the store doesn't hold. When the
 * game leaves its window, the last poll publishes the final state and no alarm is set.
 */
import type { CadenceParams, GameSnapshot } from "@bt/domain";
import { DEFAULT_CADENCE, isGameInActiveWindow } from "@bt/domain";
import type { DurableStore } from "./hub-leases.js";
import { HubLeases } from "./hub-leases.js";
import type { IngestDeps } from "./ingest.js";
import { ingestGame, refreshTodaysWindow } from "./ingest.js";

/** Durable Object storage with its alarm (`state.storage`). */
export interface AlarmStore extends DurableStore
{
	getAlarm(): Promise<number | null>;
	setAlarm(scheduledTime: number): Promise<void>;
	deleteAlarm(): Promise<void>;
}

/** Sends a stored snapshot to one hub (S18 builds the real hub); rejects when the hub can't take it. */
export type HubPublisher = (hubId: string, snapshot: GameSnapshot) => Promise<void>;

/** The object's name: one per game, so every cron run reaches the same instance. */
export function gameIngestName(gamePk: number): string
{
	return `game-ingest:${gamePk}`;
}

const GAME_KEY = "gamePk";
/** When this object was last armed or polled (epoch ms). */
const ACTIVE_KEY = "activeAt";

export class GameIngest
{
	readonly hubs: HubLeases;

	constructor(
		private readonly storage: AlarmStore,
		private readonly deps: IngestDeps,
		private readonly publish: HubPublisher,
		private readonly params: CadenceParams = DEFAULT_CADENCE,
	)
	{
		this.hubs = new HubLeases(storage);
	}

	/**
	 * Makes sure this object polls `gamePk`: arms an alarm for `now` unless it is already
	 * running — an alarm is set, or it was armed or polled within the last two intervals.
	 * The second test matters because the runtime reports no alarm from the moment one is
	 * due until its handler re-arms. True when it armed one. Safe on every cron run: a
	 * Durable Object has one alarm, so arming again can never start a second poll chain,
	 * and an object whose alarms stopped is restarted.
	 */
	async ensureRunning(gamePk: number, now: Date): Promise<boolean>
	{
		await this.storage.put(GAME_KEY, gamePk);
		const activeAt = await this.storage.get<number>(ACTIVE_KEY);
		const recent = activeAt !== undefined && now.getTime() - activeAt < 2 * this.params.intervalMs;
		if (recent || await this.storage.getAlarm() !== null) return false;
		await this.storage.put(ACTIVE_KEY, now.getTime());
		await this.storage.setAlarm(now.getTime());
		return true;
	}

	/**
	 * One poll. A failed MLB call keeps the cadence (the next alarm retries); otherwise the
	 * game is written, then published if it changed, or as the final state once it is out
	 * of its window, when the alarm stops.
	 */
	async alarm(now: Date): Promise<void>
	{
		const gamePk = await this.storage.get<number>(GAME_KEY);
		if (gamePk === undefined) return;
		await this.storage.put(ACTIVE_KEY, now.getTime());
		let fetched;
		try
		{
			fetched = await this.deps.mlb.fetchGame(gamePk);
		}
		catch
		{
			await this.storage.setAlarm(now.getTime() + this.params.intervalMs);
			return;
		}
		const inWindow = isGameInActiveWindow(fetched, now, this.params);
		const { snapshot, changed } = await ingestGame(this.deps, {
			...fetched,
			fetchedAt: now.toISOString(),
			windowMode: inWindow ? "active" : "cache",
		});
		if (changed || !inWindow) await this.publishToHubs(snapshot, now);
		if (inWindow)
		{
			await this.storage.setAlarm(now.getTime() + this.params.intervalMs);
			return;
		}
		await this.storage.deleteAlarm();
		await this.storage.delete(GAME_KEY);
		await this.storage.delete(ACTIVE_KEY);
	}

	private async publishToHubs(snapshot: GameSnapshot, now: Date): Promise<void>
	{
		for (const hubId of await this.hubs.live(now))
		{
			let ok = true;
			try
			{
				await this.publish(hubId, snapshot);
			}
			catch
			{
				ok = false;
			}
			await this.hubs.recordPublish(hubId, ok);
		}
	}
}

/**
 * The cron's part (ADR-020): reads today's schedule (stored, as the tick always did) and
 * ensures an ingest object for each game in its window, and none for the rest. Returns
 * the games it ensured.
 */
export async function ensureIngestRunning(
	deps: IngestDeps,
	ensure: (gamePk: number) => Promise<unknown>,
	now: Date = deps.now?.() ?? new Date(),
	params: CadenceParams = DEFAULT_CADENCE,
): Promise<number[]>
{
	const { active } = await refreshTodaysWindow(deps, now, params);
	const ensured: number[] = [];
	for (const game of active)
	{
		try
		{
			await ensure(game.gamePk);
			ensured.push(game.gamePk);
		}
		catch
		{
			// One object that won't start must not keep the others from starting.
		}
	}
	return ensured;
}
