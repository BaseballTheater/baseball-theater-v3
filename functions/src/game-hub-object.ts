/**
 * The `game-hub:<gamePk>` Durable Object (S18; ADR-020 layer 2): it holds the game's
 * viewers' WebSockets through the Hibernation API — so an idle hub costs nothing between
 * updates, and the runtime answers pings itself — and passes on what the game's ingest
 * object (S48) publishes, newer versions only (`LiveHubState`, ADR-022). One-way: what
 * viewers send is ignored.
 *
 * While it has viewers it holds a lease with the ingest object: the first viewer
 * registers it, an alarm renews it every half lease, and the last disconnect unregisters
 * it. One hub per game (ADR-020's regional hubs are a later routing change).
 */
import type { GameSnapshot } from "@bt/domain";
import type { HubSocket } from "./adapters/cloudflare/websocket.js";
import {
	openSocketPair, pingAutoResponse, upgradeResponse,
} from "./adapters/cloudflare/websocket.js";
import type { GameIngestNamespace } from "./game-ingest-object.js";
import type { AlarmStore } from "./services/game-ingest.js";
import { gameIngestName } from "./services/game-ingest.js";
import { HUB_LEASE_MS } from "./services/hub-leases.js";
import { LiveHubState, liveMessage } from "./services/live-hub.js";
import type { WorkerEnv } from "./worker-app.js";
import { workerApp } from "./worker-app.js";

/** The part of the Durable Object state the hub uses. */
export type GameHubState = {
	storage: AlarmStore;
	acceptWebSocket(socket: HubSocket): void;
	getWebSockets(): HubSocket[];
	setWebSocketAutoResponse(pair: unknown): void;
};

/** The hub's name: one per game, so ingest and every viewer reach the same instance. */
export function gameHubName(gamePk: number): string
{
	return `game-hub:${gamePk}`;
}

/** The hub's side of S48's lease routes on the game's ingest object. */
export type IngestLease = (action: "register" | "renew" | "unregister", gamePk: number, hubId: string) => Promise<Response>;

/** Calls `game-ingest:<gamePk>`'s `/hubs/<action>` through the `GAME_INGEST` binding. */
export function ingestLease(namespace: GameIngestNamespace): IngestLease
{
	return (action, gamePk, hubId) => namespace
		.get(namespace.idFromName(gameIngestName(gamePk)) as never)
		.fetch(`https://game-ingest/hubs/${action}?hub=${encodeURIComponent(hubId)}`, {
			method: "POST",
		});
}

const GAME_KEY = "gamePk";

export class GameHubObject
{
	private readonly hub: LiveHubState;
	private readonly lease: IngestLease | null;

	constructor(private readonly state: GameHubState, env: WorkerEnv)
	{
		state.setWebSocketAutoResponse(pingAutoResponse());
		const app = workerApp(env);
		this.hub = new LiveHubState(async () =>
		{
			const gamePk = await state.storage.get<number>(GAME_KEY);
			return gamePk === undefined ? null : app.ingest.games.getByPk(gamePk);
		});
		this.lease = env.GAME_INGEST ? ingestLease(env.GAME_INGEST) : null;
	}

	/**
	 * `GET /connect?gamePk=&since=` (a WebSocket upgrade, forwarded by the live route)
	 * adds a viewer; `POST /publish` (from the ingest object) offers a snapshot.
	 */
	async fetch(request: Request): Promise<Response>
	{
		const url = new URL(request.url);
		if (url.pathname === "/publish" && request.method === "POST")
		{
			const game = await request.json() as GameSnapshot;
			await this.state.storage.put(GAME_KEY, game.gamePk);
			if (await this.hub.accept(game))
			{
				for (const socket of this.state.getWebSockets()) socket.send(liveMessage(game));
			}
			return new Response(null, {
				status: 204,
			});
		}
		if (url.pathname === "/connect" && request.headers.get("Upgrade") === "websocket")
		{
			const gamePk = Number(url.searchParams.get("gamePk"));
			const since = url.searchParams.get("since");
			await this.state.storage.put(GAME_KEY, gamePk);
			const { client, server } = openSocketPair();
			this.state.acceptWebSocket(server);
			const current = await this.hub.onConnect(since === null ? undefined : Number(since));
			if (current) server.send(liveMessage(current));
			if (this.state.getWebSockets().length === 1) await this.register(gamePk);
			return upgradeResponse(client);
		}
		return new Response("not found", {
			status: 404,
		});
	}

	/** One-way: a viewer has nothing to say to the hub (pings are answered by the runtime). */
	webSocketMessage(): void
	{
		// Ignored by design (ADR-020).
	}

	/** When the last viewer leaves, the hub gives up its lease and stops renewing. */
	async webSocketClose(socket: HubSocket): Promise<void>
	{
		if (this.state.getWebSockets().some((open) => open !== socket)) return;
		const gamePk = await this.state.storage.get<number>(GAME_KEY);
		await this.state.storage.deleteAlarm();
		if (gamePk !== undefined && this.lease) await this.lease("unregister", gamePk, gameHubName(gamePk));
	}

	/** Renews the lease while viewers remain, registering again if it lapsed. */
	async alarm(): Promise<void>
	{
		const gamePk = await this.state.storage.get<number>(GAME_KEY);
		if (gamePk === undefined || !this.lease || this.state.getWebSockets().length === 0) return;
		const renewed = await this.lease("renew", gamePk, gameHubName(gamePk));
		if (!renewed.ok) await this.lease("register", gamePk, gameHubName(gamePk));
		await this.state.storage.setAlarm(Date.now() + HUB_LEASE_MS / 2);
	}

	private async register(gamePk: number): Promise<void>
	{
		if (!this.lease) return;
		await this.lease("register", gamePk, gameHubName(gamePk));
		await this.state.storage.setAlarm(Date.now() + HUB_LEASE_MS / 2);
	}
}

/** The binding as `env.GAME_HUB` exposes it (`wrangler.jsonc` `durable_objects`). */
export type GameHubNamespace = GameIngestNamespace;

/**
 * Publishes to a hub by name through the `GAME_HUB` binding: what the ingest object uses
 * once hubs exist (it replaces S48's stub). Rejects on a failed answer, which counts
 * toward dropping the hub (S48's three strikes).
 */
export function hubPublisher(namespace: GameHubNamespace)
{
	return async (hubId: string, game: GameSnapshot): Promise<void> =>
	{
		const response = await namespace.get(namespace.idFromName(hubId) as never).fetch("https://game-hub/publish", {
			method: "POST",
			body: JSON.stringify(game),
		});
		if (!response.ok) throw new Error(`${hubId}: ${response.status}`);
	};
}
