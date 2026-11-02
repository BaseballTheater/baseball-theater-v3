/**
 * The standings resource (ADR-014; S4): one descriptor and one hook. The payload says
 * `cache` (standings move once a game ends), so it takes the cached freshness policy.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { fetchStandings } from "./client.js";
import { freshnessPolicy } from "./freshness.js";
import type { components } from "./generated/bt-api.v1.js";

export type StandingsPayload = components["schemas"]["StandingsResponse"];

/** The cache key for the standings as of `date` (`"today"` when the server picks the day). Only this module builds it. */
export function standingsKey(date: string | undefined)
{
	return ["standings", date ?? "today"] as const;
}

export function standingsQueryOptions(date: string | undefined)
{
	return queryOptions({
		queryKey: standingsKey(date),
		queryFn: (): Promise<StandingsPayload> => fetchStandings(date),
		staleTime: (query) => freshnessPolicy(query.state.data?.windowMode).staleTime,
	});
}

export function useStandings(date?: string): UseQueryResult<StandingsPayload, Error>
{
	return useQuery(standingsQueryOptions(date));
}
