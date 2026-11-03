/**
 * S95 on 823823: the content mapper reads MLB's `guid`, and `withGameExtras` (both adapters'
 * one assembly step) links each video to its play through `videoPlayLinks`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseGameContentResponse, parseLiveFeedResponse } from "@bt/mlb-api";
import {
	describe, expect, it,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { mapContentHighlights } from "./content.js";

const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/raw");
const raw = (name: string) => JSON.parse(readFileSync(path.join(RAW, name), "utf8"));
const feed = parseLiveFeedResponse(raw("live-823823.json"));
const atBatOfPitch = new Map(feed.liveData.plays.allPlays.flatMap((play, index) => play.playEvents.filter((e) => e.isPitch && e.playId).map((e) => [e.playId!, index] as const)));

describe("video play links (S95)", () =>
{
	it("guid: the content mapper takes each video's play from MLB's guid; 15 of 823823's videos get one, each a pitch in the live feed", () =>
	{
		const videos = mapContentHighlights(parseGameContentResponse(raw("content-823823.json")));
		const withPlay = videos.filter((v) => v.playId);
		expect(withPlay).toHaveLength(15);
		for (const video of withPlay) expect(atBatOfPitch.has(video.playId!)).toBe(true);
	});

	it("823823: 20 of 40 videos link — the 15 guid clips and all 5 ABS clips; graphics, recap, condensed game and pre-game link to none", async () =>
	{
		const game = await new FixtureMlbStatsClient().fetchGame(823823);
		expect(game.highlights).toHaveLength(40);
		const linked = game.highlights.filter((h) => h.playId);
		expect(linked).toHaveLength(20);
		const abs = Object.fromEntries(game.highlights.filter((h) => h.tags?.includes("abs")).map((h) => [h.title, [atBatOfPitch.get(h.playId!), h.playLink]]));
		expect(abs).toEqual({
			"Walk confirmed after ABS challenge": [34, "mlb"],
			"Ball 1 overturned after ABS challenge": [39, "challenge"],
			"Pete Crow-Armstrong strikes out after ABS challenge": [69, "mlb"],
			"Strike 1 confirmed after ABS challenge": [82, "challenge"],
			"Griffin Conine walks after ABS challenge": [83, "mlb"],
		});
		expect(linked.filter((h) => h.playLink === "mlb")).toHaveLength(18);
		const unlinked = game.highlights.filter((h) => !h.playId);
		for (const h of unlinked)
		{
			expect(h).not.toHaveProperty("playLink");
			expect(h.tags ?? []).not.toContain("abs");
		}
		expect(unlinked.some((h) => h.kind === "recap")).toBe(true);
		expect(unlinked.some((h) => h.kind === "condensed")).toBe(true);
	});

	it("823823: the five ABS challenges are stored on their at-bats with team and outcome", async () =>
	{
		const game = await new FixtureMlbStatsClient().fetchGame(823823);
		expect(game.plays.filter((a) => a.challenge).map((a) => [a.about.atBatIndex, a.challenge!.teamId, a.challenge!.overturned])).toEqual([
			[34, 112, false],
			[39, 146, true],
			[69, 146, true],
			[82, 146, false],
			[83, 146, true],
		]);
	});
});
