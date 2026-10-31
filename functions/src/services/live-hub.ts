/**
 * What one game's hub knows (S18; ADR-022): the latest snapshot it has passed on. Shared
 * by the `game-hub` Durable Object and the in-memory `LiveGameHub`, so both apply the same
 * rules — only a newer version goes out (`applyIfNewer`), and a viewer connecting behind
 * gets the full current state.
 *
 * A hub that has just started (or woke from hibernation, which drops memory) knows
 * nothing, so its first question loads the latest stored state through the repository
 * port: a viewer who connects then still gets the game.
 */
import type { GameSnapshot } from "@bt/domain";
import { applyIfNewer } from "@bt/domain";

export class LiveHubState
{
	private latest: GameSnapshot | null = null;
	private loaded = false;

	constructor(private readonly load: () => Promise<GameSnapshot | null>) {}

	private async current(): Promise<GameSnapshot | null>
	{
		if (!this.loaded)
		{
			this.latest = this.latest ?? await this.load();
			this.loaded = true;
		}
		return this.latest;
	}

	/** Takes a published snapshot; true when it is newer than anything before, so viewers should get it. */
	async accept(game: GameSnapshot): Promise<boolean>
	{
		const before = await this.current();
		this.latest = applyIfNewer(before, game);
		return this.latest !== before;
	}

	/** What a viewer who has `since` (or nothing) gets on connect: the current state if it is newer, else nothing. */
	async onConnect(since?: number): Promise<GameSnapshot | null>
	{
		const latest = await this.current();
		return latest && (since === undefined || latest.version > since) ? latest : null;
	}
}

/** The one message a viewer receives: the full snapshot, which carries its `version`. */
export function liveMessage(game: GameSnapshot): string
{
	return JSON.stringify(game);
}
