import type { DayDigestResponse, ScheduleDay } from "@bt/domain";
import { dayDigest } from "@bt/domain";
import type { IngestDeps } from "./ingest.js";
import { getOrRefreshGame, getOrRefreshSchedule } from "./ingest.js";

/**
 * "Best of <date>" (S71): reads the day's schedule, then each of its games the way the
 * game route does (stored copy, refreshed when stale), and ranks their videos with
 * `dayDigest`. A game that can't be read is left out rather than failing the whole
 * digest; a day with no videos yet has an empty digest. Returns the schedule day too, so
 * the route can cache the digest as long as the day itself (ADR-021).
 */
export async function getDayDigest(deps: IngestDeps, date: string): Promise<{ day: ScheduleDay;
	digest: DayDigestResponse; }>
{
	const day = await getOrRefreshSchedule(deps, date);
	const games = await Promise.all(day.games.map((game) => getOrRefreshGame(deps, game.gamePk).catch(() => null)));
	return {
		day,
		digest: {
			date,
			items: dayDigest(games.filter((game) => game !== null)),
		},
	};
}
