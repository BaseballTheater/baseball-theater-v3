/**
 * `HttpMlbStatsClient` on the committed recordings (S112): an injected fetch stand-in serves
 * `fixtures/raw/` by URL — 823823's feed, content, play metrics and GraphQL content, each
 * recorded day's schedule, the seasons and World Series, and the standings (a day's, a season's
 * final and spring tables, S128) — and answers MLB's empty day or empty table for one without a
 * recording and 404 for anything else. A schedule range (`startDate`/`endDate`, S124) is answered
 * as MLB answers one: the recorded days in the range, each under `dates`, and none for the rest. `override` answers a URL first, for a test's own case. No
 * test that uses it touches the network.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { datesBetween } from "@bt/domain";
import { HttpMlbStatsClient } from "../adapters/http/mlb.js";

const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/raw");
const EMPTY_DAY = JSON.stringify({
	copyright: "",
	totalItems: 0,
	totalEvents: 0,
	totalGames: 0,
	totalGamesInProgress: 0,
	dates: [],
});
/** MLB's answer for standings it has none of (checked 2026-11-07: any date outside the regular season). */
const EMPTY_STANDINGS = JSON.stringify({
	copyright: "",
	records: [],
});

/** The recorded answer for a URL: a file under fixtures/raw, MLB's empty day, or a 404. */
function recorded(url: URL): string | null
{
	if (url.hostname === "data-graph.mlb.com") return "graphql-content-823823.json";
	if (url.pathname.endsWith("/bdfed/playMetrics/823823")) return "playmetrics-823823.json";
	if (url.searchParams.get("gameType") === "W") return `worldseries-${url.searchParams.get("season")}.json`;
	const season = /\/api\/v1\/seasons\/(\d{4})$/.exec(url.pathname);
	if (season) return `seasons-${season[1]}.json`;
	if (url.pathname === "/api/v1/schedule") return `schedule-${url.searchParams.get("date")}.json`;
	if (url.pathname === "/api/v1/standings")
	{
		const season = url.searchParams.get("season");
		if (url.searchParams.get("standingsTypes") === "springTraining") return `standings-${season}-spring.json`;
		return url.searchParams.has("date") ? `standings-${url.searchParams.get("date")}.json` : `standings-${season}-final.json`;
	}
	if (url.pathname === "/api/v1.1/game/823823/feed/live") return "live-823823.json";
	if (url.pathname === "/api/v1/game/823823/content") return "content-823823.json";
	return null;
}

/** One range answer (S124) built from the recorded days in it: MLB lists only days that have games. */
function recordedRange(startDate: string, endDate: string): string
{
	const dates = datesBetween(startDate, endDate).flatMap((date) =>
	{
		try
		{
			return (JSON.parse(readFileSync(path.join(RAW, `schedule-${date}.json`), "utf8")) as { dates: unknown[] }).dates;
		}
		catch
		{
			return [];
		}
	});
	return JSON.stringify({
		...JSON.parse(EMPTY_DAY) as object,
		dates,
	});
}

/** HttpMlbStatsClient on the recordings, logging every URL it asks for (the clock: 2026-11-04). */
export function recordedClient(override?: (url: URL) => Response | undefined): { mlb: HttpMlbStatsClient;
	asked: string[]; }
{
	const asked: string[] = [];
	const mlb = new HttpMlbStatsClient({
		now: () => new Date("2026-11-04T12:00:00.000Z"),
		fetchImpl: async (input) =>
		{
			const url = new URL(String(input));
			asked.push(url.toString());
			const answer = override?.(url);
			if (answer) return answer;
			const [startDate, endDate] = [url.searchParams.get("startDate"), url.searchParams.get("endDate")];
			if (url.pathname === "/api/v1/schedule" && startDate && endDate) return new Response(recordedRange(startDate, endDate));
			const file = recorded(url);
			if (file)
			{
				try
				{
					return new Response(readFileSync(path.join(RAW, file)));
				}
				catch
				{
					if (url.pathname === "/api/v1/schedule") return new Response(EMPTY_DAY);
					if (url.pathname === "/api/v1/standings") return new Response(EMPTY_STANDINGS);
				}
			}
			return new Response("{}", {
				status: 404,
			});
		},
	});
	return {
		mlb,
		asked,
	};
}
