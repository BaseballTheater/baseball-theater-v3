/**
 * The day digest resource (ADR-014; S71): one descriptor and one hook. The payload carries
 * no `windowMode`, so it takes the cached freshness policy: a digest changes only as games
 * gain videos, and a reload or a new day asks again.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { fetchDigest } from "./client.js";
import { freshnessPolicy } from "./freshness.js";
import type { components } from "./generated/bt-api.v1.js";

export type DayDigestPayload = components["schemas"]["DayDigestResponse"];

/** The cache key for one day's digest. Only this module builds it. */
export function digestKey(date: string)
{
	return ["digest", date] as const;
}

export function digestQueryOptions(date: string)
{
	return queryOptions({
		queryKey: digestKey(date),
		queryFn: (): Promise<DayDigestPayload> => fetchDigest(date),
		staleTime: freshnessPolicy(undefined).staleTime,
	});
}

export function useDayDigest(date: string): UseQueryResult<DayDigestPayload, Error>
{
	return useQuery(digestQueryOptions(date));
}
