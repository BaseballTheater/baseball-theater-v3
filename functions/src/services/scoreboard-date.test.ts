/**
 * The scoreboard's default day (S111) when MLB can't give a season calendar (S128): since
 * `fetchSeasonCalendar` rejects on a failed request, `calendarsAround` is what turns that into
 * "left out". The client is `HttpMlbStatsClient` on the recordings (`recordedClient`), with the
 * failing calendar answered 500 by an override.
 */
import {
	describe, expect, it,
} from "vitest";
import {
	InMemoryGameProjectionRepository,
	InMemoryGameRepository,
	InMemoryScheduleRepository,
} from "../adapters/memory/repos.js";
import { recordedClient } from "../test/recorded-mlb.js";
import type { IngestDeps } from "./ingest.js";
import { getDefaultScoreboardDate } from "./scoreboard-date.js";

/** The recordings, with every `seasons/<year>` request for one of `years` answering 500. */
function failingSeasons(years: readonly number[]): IngestDeps["mlb"]
{
	return recordedClient((url) =>
	{
		const season = /\/api\/v1\/seasons\/(\d{4})$/.exec(url.pathname);
		return season && years.includes(Number(season[1])) ? new Response("{}", {
			status: 500,
		}) : undefined;
	}).mlb;
}

function deps(mlb: IngestDeps["mlb"], now: string): IngestDeps
{
	return {
		mlb,
		schedules: new InMemoryScheduleRepository(),
		games: new InMemoryGameRepository(),
		projections: new InMemoryGameProjectionRepository(),
		now: () => new Date(now),
	};
}

describe("getDefaultScoreboardDate with an unreachable season calendar (S111, S128)", () =>
{
	it("with no calendar MLB can give, it is MLB's today", async () =>
	{
		// 2026-11-02 is in the off-season, so with the calendars it would be 2026's final (10-28).
		expect(await getDefaultScoreboardDate(deps(failingSeasons([2025, 2026]), "2026-11-02T17:00:00Z"))).toEqual({
			date: "2026-11-02",
		});
	});

	it("with only the day's own year unreachable, a January day stays on the year before's final", async () =>
	{
		// 2026's calendar is left out, so no next season is known: S111 AC 1 keeps 2025's final (Game 7, 11-01).
		expect(await getDefaultScoreboardDate(deps(failingSeasons([2026]), "2026-01-15T17:00:00Z"))).toEqual({
			date: "2025-11-01",
		});
	});
});
