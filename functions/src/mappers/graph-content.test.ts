/**
 * S94: MLB's GraphQL game content for 823823 (`fixtures/raw/graphql-content-823823.json`,
 * recorded once from `data-graph.mlb.com`), projected into `GameSnapshot.videoPlayRefs` and
 * `relatedArticles`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseGraphContentResponse, parseLiveFeedResponse } from "@bt/mlb-api";
import {
	describe, expect, it,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { HttpMlbStatsClient } from "../adapters/http/mlb.js";
import { mapGraphContent } from "./graph-content.js";

const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/raw");
const raw = (name: string) => JSON.parse(readFileSync(path.join(RAW, name), "utf8"));
const graph = mapGraphContent(parseGraphContentResponse(raw("graphql-content-823823.json")), 823823)!;

describe("GraphQL game content (S94)", () =>
{
	it("play refs: 18 of 823823's 25 videos carry one, each a real pitch playId in the live feed", () =>
	{
		expect(graph.videoPlayRefs).toHaveLength(18);
		const feed = parseLiveFeedResponse(raw("live-823823.json"));
		const pitches = new Set(feed.liveData.plays.allPlays.flatMap((play) => play.playEvents.filter((e) => e.isPitch).map((e) => e.playId)));
		for (const ref of graph.videoPlayRefs) expect(pitches).toContain(ref.playId);
	});

	it("play refs: keyed by the video's id, so every one joins a video in the content feed", async () =>
	{
		const game = await new FixtureMlbStatsClient().fetchGame(823823);
		const ids = new Set(game.highlights.map((h) => h.id));
		for (const ref of graph.videoPlayRefs) expect(ids).toContain(ref.videoId);
		// Three of the five ABS challenge clips, which the content feed links to no play.
		const abs = game.highlights.filter((h) => h.tags?.some((t) => t.includes("abs")) && graph.videoPlayRefs.some((r) => r.videoId === h.id));
		expect(abs.length).toBeGreaterThanOrEqual(3);
	});

	it("articles: related articles keep headline, blurb and slug (MLB gives no URL)", () =>
	{
		expect(graph.relatedArticles).toHaveLength(1);
		expect(graph.relatedArticles[0]).toMatchObject({
			slug: "griffin-conine-father-son-duo-home-runs",
			headline: "Like father, like son: Conines join exclusive company with HR feat",
		});
		expect(graph.relatedArticles[0]!.blurb).toMatch(/^MIAMI – /);
	});

	it("fixture: the fixture client reads the recording, and 823823's game carries both fields", async () =>
	{
		const fixtures = new FixtureMlbStatsClient();
		expect(await fixtures.fetchGameGraphContent(823823)).toEqual(graph);
		const game = await fixtures.fetchGame(823823);
		expect(game.videoPlayRefs).toEqual(graph.videoPlayRefs);
		expect(game.relatedArticles).toEqual(graph.relatedArticles);
	});

	it("optional: no recording, an empty answer or a failed call leaves both fields off and the game served", async () =>
	{
		const fixtures = new FixtureMlbStatsClient();
		expect(await fixtures.fetchGameGraphContent(744834)).toBeNull();
		const other = await fixtures.fetchGame(744834);
		expect(other).not.toHaveProperty("videoPlayRefs");
		expect(other).not.toHaveProperty("relatedArticles");
		expect(mapGraphContent({}, 823823)).toBeNull();
		expect(mapGraphContent({
			data: {
				getGamesByGamePks: [],
			},
		}, 823823)).toBeNull();

		const live = readFileSync(path.join(RAW, "live-823823.json"));
		const failing = new HttpMlbStatsClient({
			fetchImpl: async (input) =>
			{
				const url = String(input);
				if (url.includes("/feed/live")) return new Response(live);
				return new Response("", {
					status: url.includes("data-graph") ? 400 : 404,
				});
			},
		});
		const game = await failing.fetchGame(823823);
		expect(game.gamePk).toBe(823823);
		expect(game).not.toHaveProperty("videoPlayRefs");
		expect(game).not.toHaveProperty("relatedArticles");
	});
});
