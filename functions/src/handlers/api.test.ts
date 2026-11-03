import type {
	DayDigestResponse, ScoreboardDefaultDateResponse, StandingsResponse,
} from "@bt/domain";
import { createServer } from "node:http";
import {
	describe, expect, it,
} from "vitest";
import { toNodeListener } from "../adapters/node/http.js";
import { createDevAccountData, createDevAuth } from "../adapters/fixtures/auth.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository,
	InMemoryGameRepository,
	InMemoryScheduleRepository,
	InMemorySettingsRepository,
} from "../adapters/memory/repos.js";
import { handleApiRequest } from "./api.js";
import { ingestScheduleDay } from "../services/ingest.js";

/** A server over the fixtures; `now` fixes the ingest clock (S111's default date reads it). */
async function withServer(run: (base: string) => Promise<void>, now?: () => Date): Promise<void>
{
	const schedules = new InMemoryScheduleRepository();
	const games = new InMemoryGameRepository();
	const projections = new InMemoryGameProjectionRepository();
	const mlb = new FixtureMlbStatsClient();
	const ingest = {
		mlb,
		schedules,
		games,
		projections,
		...now && {
			now,
		},
	};
	await ingestScheduleDay(ingest, "2024-07-04");

	const auth = createDevAuth();
	const settings = new InMemorySettingsRepository();
	const server = createServer(toNodeListener((request) => handleApiRequest(request, {
		ingest,
		auth,
		settings,
		account: createDevAccountData({
			users: auth.users,
			settings,
		}),
	})));

	await new Promise<void>((resolve) => server.listen(0, resolve));
	const addr = server.address();
	if (!addr || typeof addr === "string") throw new Error("no port");
	const base = `http://127.0.0.1:${addr.port}`;
	try
	{
		await run(base);
	}
	finally
	{
		await new Promise<void>((resolve, reject) =>
			server.close((err) => (err ? reject(err) : resolve())),
		);
	}
}

describe("handleApiRequest", () =>
{
	it("serves schedule and game", async () =>
	{
		await withServer(async (base) =>
		{
			const schedule = await fetch(`${base}/api/v1/schedule?date=2024-07-04`);
			expect(schedule.status).toBe(200);
			const day = (await schedule.json()) as { games: unknown[] };
			expect(day.games.length).toBe(2);

			const game = await fetch(`${base}/api/v1/games/744834`);
			expect(game.status).toBe(200);
			const body = (await game.json()) as { gamePk: number;
				plays: unknown[] };
			expect(body.gamePk).toBe(744834);
			expect(body.plays.length).toBe(61);
		});
	});

	it("default date in season (S111): MLB's today, the Eastern date, cacheable for five minutes", async () =>
	{
		// 23:30 Eastern on 2026-09-05 is already 09-06 in UTC; MLB's day is still the 5th.
		await withServer(async (base) =>
		{
			const response = await fetch(`${base}/api/v1/scoreboard/default-date`);
			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("public, max-age=300");
			expect((await response.json()) as ScoreboardDefaultDateResponse).toEqual({
				date: "2026-09-05",
			});
		}, () => new Date("2026-09-06T03:30:00Z"));
	});

	it("default date in the off-season (S111): the last World Series game until spring", async () =>
	{
		// After 2026's five-game Series ended on 10-28 (MLB's calendar still said 10-31).
		await withServer(async (base) =>
		{
			const body = (await (await fetch(`${base}/api/v1/scoreboard/default-date`)).json()) as ScoreboardDefaultDateResponse;
			expect(body.date).toBe("2026-10-28");
		}, () => new Date("2026-11-02T17:00:00Z"));
		// January, before 2026's spring: still 2025's final (Game 7, 11-01).
		await withServer(async (base) =>
		{
			const body = (await (await fetch(`${base}/api/v1/scoreboard/default-date`)).json()) as ScoreboardDefaultDateResponse;
			expect(body.date).toBe("2025-11-01");
		}, () => new Date("2026-01-15T17:00:00Z"));
	});

	it("serves the standings (S4): the 2026-09-05 recording's six divisions, each team with a name and its record", async () =>
	{
		await withServer(async (base) =>
		{
			const response = await fetch(`${base}/api/v1/standings?date=2026-09-05`);
			expect(response.status).toBe(200);
			const standings = (await response.json()) as StandingsResponse;
			expect(standings.date).toBe("2026-09-05");
			expect(standings.divisions.length).toBeGreaterThanOrEqual(2);
			for (const division of standings.divisions)
			{
				expect(division.divisionId ?? division.name).not.toBeNull();
				expect(division.teams.length).toBeGreaterThan(0);
				for (const team of division.teams)
				{
					expect(typeof team.name).toBe("string");
					expect(typeof team.wins).toBe("number");
					expect(typeof team.losses).toBe("number");
				}
			}
			expect(standings.divisions[0]!.teams[0]).toMatchObject({
				name: "Tampa Bay Rays",
				gamesBack: null,
			});

			expect((await fetch(`${base}/api/v1/standings?date=July`)).status).toBe(400);
		});
	});

	it("serves the day digest (S71): every game's videos ranked together, the first to watch first", async () =>
	{
		await withServer(async (base) =>
		{
			const response = await fetch(`${base}/api/v1/digest?date=2024-07-04`);
			expect(response.status).toBe(200);
			const digest = (await response.json()) as DayDigestResponse;
			expect(digest.date).toBe("2024-07-04");
			// 744834 (NYM @ WSH) has three videos and 745001 (NYY @ BOS) one, so the digest holds four.
			expect(digest.items).toHaveLength(4);
			expect(digest.items.map((i) => i.rank)).toEqual([1, 2, 3, 4]);
			expect(digest.items.filter((i) => i.watchFirst)).toEqual([digest.items[0]]);
			expect(new Set(digest.items.map((i) => i.game.gamePk))).toEqual(new Set([744834, 745001]));
			expect(digest.items.find((i) => i.game.gamePk === 745001)!.game).toMatchObject({
				away: "NYY",
				home: "BOS",
			});

			expect((await fetch(`${base}/api/v1/digest`)).status).toBe(400);
			expect((await fetch(`${base}/api/v1/digest?date=July`)).status).toBe(400);
		});
	});
});
