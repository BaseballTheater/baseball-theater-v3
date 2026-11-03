/**
 * The HTTP MLB client against the committed recordings (S2): each method asks for
 * the URL it should and maps the answer, with an injected `fetch` that serves
 * `fixtures/raw/` by URL path — no network. The live path's own mapping is proven by
 * `services/fixture-823823.test.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import { HttpMlbStatsClient } from "./mlb.js";

const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/raw");

/** Recording file by URL path; anything else answers 404. */
const BY_PATH: [RegExp, string][] = [
	[/\/feed\/live\/timestamps$/, "timestamps-823823.json"],
	[/\/feed\/live\/diffPatch$/, "diffpatch-823823.json"],
	[/\/api\/v1\/standings$/, "standings-2026-09-05.json"],
	[/\/api\/v1\/people$/, "people-823823.json"],
	[/\/api\/v1\/schedule$/, "schedule-2026-09-05.json"],
	[/\/bdfed\/playMetrics\/823823$/, "playmetrics-823823.json"],
	[/\/api\/v1\/seasons\/2026$/, "seasons-2026.json"],
];

function client(): { mlb: HttpMlbStatsClient;
	urls: string[]; }
{
	const urls: string[] = [];
	const mlb = new HttpMlbStatsClient({
		now: () => new Date("2026-09-05T23:00:00.000Z"),
		fetchImpl: async (input) =>
		{
			const url = new URL(String(input));
			urls.push(url.toString());
			// The World Series is the schedule path asked by game type and season (S111).
			const file = url.searchParams.get("gameType") === "W"
				? `worldseries-${url.searchParams.get("season")}.json`
				: BY_PATH.find(([re]) => re.test(url.pathname))?.[1];
			return file ? new Response(readFileSync(path.join(RAW, file))) : new Response("{}", {
				status: 404,
			});
		},
	});
	return {
		mlb,
		urls,
	};
}

describe("HttpMlbStatsClient (S2)", () =>
{
	it("fetchSchedule and fetchStandings map the recorded day", async () =>
	{
		const { mlb } = client();
		const day = await mlb.fetchSchedule("2026-09-05");
		expect(day.games.some((g) => g.gamePk === 823823)).toBe(true);
		const standings = await mlb.fetchStandings("2026-09-05");
		expect(standings.divisions).toHaveLength(6);
		expect(standings.windowMode).toBe("active");
	});

	it("fetchPlayers asks for this season's stats, and asks nothing for no ids", async () =>
	{
		const { mlb, urls } = client();
		expect(await mlb.fetchPlayers([])).toEqual([]);
		expect(urls).toEqual([]);
		const players = await mlb.fetchPlayers([691718]);
		expect(players.length).toBeGreaterThan(0);
		expect(decodeURIComponent(urls[0]!)).toContain("season=2026");
	});

	it("fetchGameTimestamps and fetchGameDiffPatch read the recorded feed history", async () =>
	{
		const { mlb, urls } = client();
		expect((await mlb.fetchGameTimestamps(823823)).length).toBeGreaterThan(0);
		const patch = await mlb.fetchGameDiffPatch(823823, "20260905_170118", "20260905_194407");
		expect(patch.length).toBeGreaterThan(0);
		expect(urls.at(-1)).toContain("startTimecode=20260905_170118&endTimecode=20260905_194407");
	});

	it("content is best-effort: a failed content request is no highlights; any other failure throws with the URL", async () =>
	{
		const { mlb } = client();
		expect(await mlb.fetchGameContent(823823)).toEqual([]);
		await expect(mlb.fetchGame(823823)).rejects.toThrow(/MLB Stats API 404 for .*\/feed\/live/);
	});

	it("fetchPlayMetrics asks MLB's bdfed feed with every category and maps the recording (S93)", async () =>
	{
		const { mlb, urls } = client();
		const metrics = await mlb.fetchPlayMetrics(823823);
		expect(urls).toEqual(["https://bdfed.stitch.mlbinfra.com/bdfed/playMetrics/823823?keyMoments=true&scoringPlays=true&homeRuns=true&strikeouts=true&hardHits=true&highLeverage=false&leadChange=true&winProb=true&absChallenge=true"]);
		expect(metrics?.atBats).toHaveLength(85);
		expect(await mlb.fetchPlayMetrics(1)).toBeNull();
	});

	it("fetchGameGraphContent asks data-graph's persisted query with MLB's client headers and maps the recording (S94)", async () =>
	{
		const asked: { url: URL;
			headers: Headers; }[] = [];
		const mlb = new HttpMlbStatsClient({
			fetchImpl: async (input, init) =>
			{
				const url = new URL(String(input));
				const headers = new Headers(init?.headers);
				asked.push({
					url,
					headers,
				});
				const ok = url.searchParams.get("variables")?.includes("[823823]") && headers.get("x-client-name") === "mlb";
				return ok ? new Response(readFileSync(path.join(RAW, "graphql-content-823823.json"))) : new Response("", {
					status: 400,
				});
			},
		});
		const graph = await mlb.fetchGameGraphContent(823823);
		const { url, headers } = asked[0]!;
		expect(`${url.origin}${url.pathname}`).toBe("https://data-graph.mlb.com/graphql/");
		expect(url.searchParams.get("operationName")).toBe("getGamesByGamePks");
		expect(JSON.parse(url.searchParams.get("extensions")!).persistedQuery.sha256Hash).toBe("e12a5c2692406844d5f15f52ce7754208f53da81867de7d3e9e773611f4a040a");
		expect(JSON.parse(url.searchParams.get("variables")!)).toMatchObject({
			gamePks: [823823],
			locale: "EN_US",
		});
		expect(headers.get("x-client-name")).toBe("mlb");
		expect(headers.get("content-type")).toBe("application/json");
		expect(graph?.videoPlayRefs).toHaveLength(18);
		// The gateway's 400 for anything it won't answer is a null, not a throw.
		expect(await mlb.fetchGameGraphContent(1)).toBeNull();
	});

	it("season calendar: the recorded 2026 calendar with its World Series final; null when unpublished", async () =>
	{
		const { mlb, urls } = client();
		expect(await mlb.fetchSeasonCalendar(2026)).toEqual({
			season: 2026,
			springStartDate: "2026-02-20",
			lastGameDate: "2026-10-28",
		});
		expect(urls).toEqual([
			"https://statsapi.mlb.com/api/v1/seasons/2026?sportId=1",
			"https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=W&season=2026",
		]);
		// No recording for 2031: the calendar answers 404, so the season is unknown.
		expect(await mlb.fetchSeasonCalendar(2031)).toBeNull();
	});
});
