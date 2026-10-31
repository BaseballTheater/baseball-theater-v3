import type { GameSnapshot } from "@bt/domain";

/** One watching browser, as the hub sees it: something to send a message to. */
export interface LiveViewer
{
	send(message: string): void;
}

/**
 * Pushes a game's saved changes to everyone watching it (S18; ADR-020 layer 2, ADR-022).
 * Ingest publishes a game after writing it; the hub passes on only a version newer than
 * the last it sent, and a viewer that connects behind (`since`, the version it already
 * has) first gets the full current state. One-way: viewers never send anything that
 * matters. The Worker's implementation is the `game-hub` Durable Object; the in-memory
 * one serves Node and tests.
 */
export interface LiveGameHub
{
	/** Offers a stored snapshot; viewers get it only if it is newer than what they were sent. */
	publish(gamePk: number, game: GameSnapshot): Promise<void>;
	/** Adds a viewer of `gamePk`; resolves to the function that removes it. */
	connect(gamePk: number, viewer: LiveViewer, since?: number): Promise<() => void>;
}
