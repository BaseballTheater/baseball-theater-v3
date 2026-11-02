/**
 * The schedule-day resource (ADR-014): one descriptor, one hook, one named cache
 * writer. Payload type generated from the published spec, like `game.ts`.
 */
import {
	queryOptions, useQuery, useQueryClient,
} from "@tanstack/react-query";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import { fetchSchedule } from "./client.js";
import { freshnessPolicy, whileVisible } from "./freshness.js";
import type { components } from "./generated/bt-api.v1.js";

export type ScheduleDayPayload = components["schemas"]["ScheduleDayResponse"];

/** The cache key for one day. Only this module builds it. */
export function scheduleKey(date: string)
{
	return ["schedule", date] as const;
}

export function scheduleQueryOptions(date: string)
{
	return queryOptions({
		queryKey: scheduleKey(date),
		queryFn: (): Promise<ScheduleDayPayload> => fetchSchedule(date),
		staleTime: (query) => freshnessPolicy(query.state.data?.windowMode).staleTime,
		// Re-ask an in-window day on the live cadence while visible (S20); paused when hidden.
		refetchInterval: (query) => whileVisible(freshnessPolicy(query.state.data?.windowMode).refetchInterval),
	});
}

export function useScheduleDay(date: string): UseQueryResult<ScheduleDayPayload, Error>
{
	return useQuery(scheduleQueryOptions(date));
}

/** Write a day into the cache in place (a day fetched elsewhere, e.g. by a test or a prefetch). */
export function writeScheduleDay(client: QueryClient, day: ScheduleDayPayload): void
{
	// The descriptor's key carries the payload type, so a wrong-typed write is a type error.
	client.setQueryData(scheduleQueryOptions(day.date).queryKey, day);
}

/** The same writer bound to the mounted client. */
export function useWriteScheduleDay(): (day: ScheduleDayPayload) => void
{
	const client = useQueryClient();
	return (day) => writeScheduleDay(client, day);
}
