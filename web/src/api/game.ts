/**
 * The game resource (ADR-014): one descriptor, one hook, one named cache writer.
 *
 * The payload type is read back out of the published spec (S29, ADR-016): the
 * generated `components` schema for the route's response alias, so nothing here
 * re-states a server shape and `generated.types.test.ts` proves it matches the wire.
 */
import {
	queryOptions, useQuery, useQueryClient,
} from "@tanstack/react-query";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import { fetchGame } from "./client.js";
import { freshnessPolicy } from "./freshness.js";
import type { components } from "./generated/bt-api.v1.js";

export type GamePayload = components["schemas"]["GameSnapshotResponse"];

/** The cache key for one game. Only this module builds it — no raw arrays at call sites. */
export function gameKey(gamePk: number)
{
	return ["game", gamePk] as const;
}

/**
 * `streaming` (S19): the live stream keeps this game fresh (its socket, or its own
 * polling fallback), so the query doesn't refetch in the background as well.
 */
export function gameQueryOptions(gamePk: number, streaming = false)
{
	return queryOptions({
		queryKey: gameKey(gamePk),
		queryFn: (): Promise<GamePayload> => fetchGame(gamePk),
		staleTime: (query) => freshnessPolicy(query.state.data?.windowMode).staleTime,
		refetchInterval: (query) => streaming ? false : freshnessPolicy(query.state.data?.windowMode).refetchInterval,
	});
}

export function useGame(gamePk: number, streaming = false): UseQueryResult<GamePayload, Error>
{
	return useQuery(gameQueryOptions(gamePk, streaming));
}

/** The game as the cache holds it now, without subscribing (S19 decides from it whether to stream). */
export function useCachedGame(gamePk: number): GamePayload | undefined
{
	return useQueryClient().getQueryData(gameKey(gamePk));
}

/**
 * Write a game into the cache in place (ADR-014 rule 10). Every reader of this
 * `gamePk` re-renders with the new payload and nothing remounts — what S19's live
 * stream calls for each newer version BT pushes.
 */
export function writeGame(client: QueryClient, game: GamePayload): void
{
	// The descriptor's key carries the payload type, so a wrong-typed write is a type error.
	client.setQueryData(gameQueryOptions(game.gamePk).queryKey, game);
}

/** The same writer bound to the mounted client, for components that patch on their own. */
export function useWriteGame(): (game: GamePayload) => void
{
	const client = useQueryClient();
	return (game) => writeGame(client, game);
}
