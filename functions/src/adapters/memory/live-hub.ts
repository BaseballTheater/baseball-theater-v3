import type { GameSnapshot } from "@bt/domain";
import type {
	GameRepository, LiveGameHub, LiveViewer,
} from "@bt/ports";
import { LiveHubState, liveMessage } from "../../services/live-hub.js";

/**
 * `LiveGameHub` in memory (S18): one `LiveHubState` and viewer set per game, for Node and
 * tests. The Worker's hub is the `game-hub` Durable Object, which applies the same state.
 */
export class InMemoryLiveGameHub implements LiveGameHub
{
	private readonly hubs = new Map<number, { state: LiveHubState;
		viewers: Set<LiveViewer>; }>();

	constructor(private readonly games: GameRepository) {}

	private hub(gamePk: number)
	{
		let hub = this.hubs.get(gamePk);
		if (!hub)
		{
			hub = {
				state: new LiveHubState(() => this.games.getByPk(gamePk)),
				viewers: new Set(),
			};
			this.hubs.set(gamePk, hub);
		}
		return hub;
	}

	async publish(gamePk: number, game: GameSnapshot): Promise<void>
	{
		const hub = this.hub(gamePk);
		if (!await hub.state.accept(game)) return;
		for (const viewer of hub.viewers) viewer.send(liveMessage(game));
	}

	async connect(gamePk: number, viewer: LiveViewer, since?: number): Promise<() => void>
	{
		const hub = this.hub(gamePk);
		hub.viewers.add(viewer);
		const current = await hub.state.onConnect(since);
		if (current) viewer.send(liveMessage(current));
		return () => void hub.viewers.delete(viewer);
	}
}
