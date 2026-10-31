/**
 * Following a watched game live (S19; ADR-020's client layer, ADR-022, ADR-014): one
 * WebSocket to `GET /api/v1/games/:gamePk/live` for a game in its window. Every payload
 * is the game's full stored state with its `version`; only a newer one reaches the cache,
 * and only through the game resource's writer (`writeGame`), so readers patch in place
 * and nothing remounts. A skipped version (v2 then v4) means an update went missing on
 * the way, so the game is refetched instead.
 *
 * When the socket closes the stream reconnects with exponential backoff and jitter,
 * asking `?since=<last version>` so the hub sends the full state only if it moved on.
 * After `maxFailures` closes in a row it gives up on the socket and polls the cached
 * `GET /api/v1/games/:gamePk` instead, until the tab becomes visible again or the browser
 * comes back online, when it tries the socket afresh. While the stream runs, the game
 * query's own background refetch is off (`useGame(gamePk, true)`): the stream is the one
 * source of freshness.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { writeGame } from "./game.js";
import type { LiveGameStream } from "./live-stream.js";

/**
 * Streams `gamePk` while `inWindow` (the cached payload's `windowMode` is `"active"`):
 * the stream loads on first use (`live-stream.ts`), the socket opens when `inWindow`
 * becomes true and closes when it turns false, the game changes or the page unmounts.
 * Payloads reach the cache only through `writeGame`. Returns whether the stream is in
 * charge, so the game query can stop its own refetching.
 */
export function useLiveGame(gamePk: number, inWindow: boolean): boolean
{
	const client = useQueryClient();
	useEffect(() =>
	{
		if (!inWindow) return undefined;
		let stream: LiveGameStream | undefined;
		let left = false;
		void import("./live-stream.js").then(({ LiveGameStream: Stream }) =>
		{
			if (left) return;
			stream = new Stream({
				gamePk,
				client,
				write: (game) => writeGame(client, game),
			});
			stream.start();
		});
		return () =>
		{
			left = true;
			stream?.stop();
		};
	}, [gamePk, inWindow, client]);
	return inWindow;
}
