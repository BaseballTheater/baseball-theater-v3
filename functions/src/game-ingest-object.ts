/**
 * The `game-ingest:<gamePk>` Durable Object (S48; ADR-020 layer 1): a thin shell that
 * gives `GameIngest` (services/game-ingest.ts) its storage and alarm. The cron reaches it
 * through `ensureGameIngest`; a hub (S18) registers, renews and unregisters its lease
 * through `fetch`. It reads and writes Postgres through the isolate's composition
 * (`workerApp`), each call and alarm on its own connection (`inDatabaseScope`, S51).
 */
import type { GameSnapshot } from "@bt/domain";
import { inDatabaseScope } from "./adapters/postgres/connect.js";
import type { HyperdriveBinding } from "./adapters/postgres/connect.js";
import type { AlarmStore } from "./services/game-ingest.js";
import { hubPublisher } from "./game-hub-object.js";
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
 * Where there is no `GAME_HUB` binding (Node, tests) there is nowhere to deliver to:
 * registered hubs are "published" to here, keeping the write-then-publish order and the
 * lease bookkeeping real while delivery is a no-op. The Worker uses `hubPublisher` (S18).
 */
export async function stubHubPublisher(_hubId: string, _snapshot: GameSnapshot): Promise<void>
{
	// No hubs to reach without the binding.
}

export class GameIngestObject
{
	private readonly ingest: GameIngest;
	private readonly hyperdrive: HyperdriveBinding | undefined;

	constructor(state: GameIngestState, env: WorkerEnv)
	{
		this.ingest = new GameIngest(state.storage, workerApp(env).ingest, env.GAME_HUB ? hubPublisher(env.GAME_HUB) : stubHubPublisher);
		this.hyperdrive = env.HYPERDRIVE;
	}

	/**
	 * `POST /ensure?gamePk=` starts polling (idempotent); `POST /hubs/register`,
	 * `/hubs/renew` and `/hubs/unregister` with `?hub=` manage a hub's lease.
	 */
	fetch(request: Request): Promise<Response>
	{
		return inDatabaseScope(this.hyperdrive, () => this.route(request));
	}

	private async route(request: Request): Promise<Response>
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
		return inDatabaseScope(this.hyperdrive, () => this.ingest.alarm(new Date()));
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
