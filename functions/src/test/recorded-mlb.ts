/**
 * `HttpMlbStatsClient` on the committed recordings (S112): an injected fetch stand-in serves
 * `fixtures/raw/` by URL — 823823's feed, content, play metrics and GraphQL content, each
 * recorded day's schedule, the seasons and World Series — and answers MLB's empty day for a
 * date without a recording and 404 for anything else. No test that uses it touches the network.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

/** The recorded answer for a URL: a file under fixtures/raw, MLB's empty day, or a 404. */
function recorded(url: URL): string | null
{
	if (url.hostname === "data-graph.mlb.com") return "graphql-content-823823.json";
	if (url.pathname.endsWith("/bdfed/playMetrics/823823")) return "playmetrics-823823.json";
	if (url.searchParams.get("gameType") === "W") return `worldseries-${url.searchParams.get("season")}.json`;
	const season = /\/api\/v1\/seasons\/(\d{4})$/.exec(url.pathname);
	if (season) return `seasons-${season[1]}.json`;
	if (url.pathname === "/api/v1/schedule") return `schedule-${url.searchParams.get("date")}.json`;
	if (url.pathname === "/api/v1.1/game/823823/feed/live") return "live-823823.json";
	if (url.pathname === "/api/v1/game/823823/content") return "content-823823.json";
	return null;
}

/** HttpMlbStatsClient on the recordings, logging every URL it asks for (the clock: 2026-11-04). */
export function recordedClient(): { mlb: HttpMlbStatsClient;
	asked: string[]; }
{
	const asked: string[] = [];
	const mlb = new HttpMlbStatsClient({
		now: () => new Date("2026-11-04T12:00:00.000Z"),
		fetchImpl: async (input) =>
		{
			const url = new URL(String(input));
			asked.push(url.toString());
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
