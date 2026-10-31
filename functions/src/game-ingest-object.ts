/**
 * The `game-ingest:<gamePk>` Durable Object (S48; ADR-020 layer 1): a thin shell that
 * gives `GameIngest` (services/game-ingest.ts) its storage and alarm. The cron reaches it
 * through `ensureGameIngest`; a hub (S18) registers, renews and unregisters its lease
 * through `fetch`. It reads and writes through the isolate's composition (`workerApp`),
 * so until Postgres (S50) its writes land in that isolate's in-memory store.
 */
import type { GameSnapshot } from "@bt/domain";
import type { AlarmStore } from "./services/game-ingest.js";
import { GameIngest, gameIngestName } from "./services/game-ingest.js";
import type { WorkerEnv } from "./worker-app.js";
import { workerApp } from "./worker-app.js";

/** The part of the Durable Object state this class uses. */
export type GameIngestState = { storage: AlarmStore };

/** The binding as `env.GAME_INGEST` exposes it (`wrangler.jsonc` `durable_objects`). */
export type GameIngestNamespace = {
	idFromName(name: string): unknown;
	get(id: never): { fetch(input: string, init?: RequestInit): Promise<Response> };
};

/**
 * Until S18 builds the hub objects there is nowhere to deliver to: registered hubs are
 * recorded and "published" to here, which keeps the write-then-publish order and the
 * lease bookkeeping real while the delivery itself is a no-op.
 */
export async function stubHubPublisher(_hubId: string, _snapshot: GameSnapshot): Promise<void>
{
	// S18 replaces this with a call to the hub object.
}

export class GameIngestObject
{
	private readonly ingest: GameIngest;

	/**
	 * Uses the isolate's ingest deps but not its seeded fixture day (`app.ready`): ingest
	 * needs nothing seeded, and waiting on it would open a gap before `GameIngest` marks a
	 * poll running, in which a second ensure could arm a second alarm.
	 */
	constructor(state: GameIngestState, env: WorkerEnv)
	{
		this.ingest = new GameIngest(state.storage, workerApp(env).ingest, stubHubPublisher);
	}

	/**
	 * `POST /ensure?gamePk=` starts polling (idempotent); `POST /hubs/register`,
	 * `/hubs/renew` and `/hubs/unregister` with `?hub=` manage a hub's lease.
	 */
	async fetch(request: Request): Promise<Response>
	{
		const url = new URL(request.url);
		const now = new Date();
		const hub = url.searchParams.get("hub");
		switch (url.pathname)
		{
			case "/ensure":
			{
				const gamePk = Number(url.searchParams.get("gamePk"));
				if (!Number.isInteger(gamePk) || gamePk <= 0) return new Response("gamePk required", {
					status: 400,
				});
				return Response.json({
					armed: await this.ingest.ensureRunning(gamePk, now),
				});
			}
			case "/hubs/register":
				if (!hub) break;
				await this.ingest.hubs.register(hub, now);
				return new Response(null, {
					status: 204,
				});
			case "/hubs/renew":
				if (!hub) break;
				return new Response(null, {
					status: await this.ingest.hubs.renew(hub, now) ? 204 : 410,
				});
			case "/hubs/unregister":
				if (!hub) break;
				await this.ingest.hubs.unregister(hub);
				return new Response(null, {
					status: 204,
				});
		}
		return new Response("not found", {
			status: 404,
		});
	}

	alarm(): Promise<void>
	{
		return this.ingest.alarm(new Date());
	}
}

/** Asks `gamePk`'s ingest object to run (the cron's call, once per in-window game per run). */
export async function ensureGameIngest(namespace: GameIngestNamespace, gamePk: number): Promise<void>
{
	const stub = namespace.get(namespace.idFromName(gameIngestName(gamePk)) as never);
	const response = await stub.fetch(`https://game-ingest/ensure?gamePk=${gamePk}`, {
		method: "POST",
	});
	if (!response.ok) throw new Error(`game-ingest ${gamePk}: ${response.status}`);
}
