/**
 * The scoreboard's default day (S111): asked of the server, which knows MLB's calendar.
 * If the server can't answer, the scoreboard opens on MLB's today rather than nothing.
 */
import { useQuery } from "@tanstack/react-query";
import { mlbToday } from "@bt/domain";
import { fetchScoreboardDefaultDate } from "./client.js";

/** The cache key for the default day. Only this module builds it. */
export function scoreboardDefaultDateKey()
{
	return ["scoreboard", "default-date"] as const;
}

/**
 * The day to open, or `undefined` while it loads. On failure, MLB's today
 * (`America/New_York`, from `mlbToday`). The server caches it for five minutes;
 * so does the query.
 */
export function useScoreboardDefaultDate(): string | undefined
{
	const { data, isError } = useQuery({
		queryKey: scoreboardDefaultDateKey(),
		queryFn: fetchScoreboardDefaultDate,
		staleTime: 5 * 60 * 1000,
	});
	if (data) return data.date;
	return isError ? mlbToday(new Date()) : undefined;
}
