/**
 * S93: MLB's play-metrics feed for 823823 (`fixtures/raw/playmetrics-823823.json`, recorded
 * once from `bdfed.stitch.mlbinfra.com`), projected into BT's `GameSnapshot.playMetrics`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlayMetricsResponse } from "@bt/mlb-api";
import {
	describe, expect, it,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { HttpMlbStatsClient } from "../adapters/http/mlb.js";
import { mapPlayMetrics } from "./play-metrics.js";

const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/raw/playmetrics-823823.json");
const metrics = mapPlayMetrics(parsePlayMetricsResponse(JSON.parse(readFileSync(RAW, "utf8"))))!;
const indices = (pick: (a: (typeof metrics.atBats)[number]) => boolean) => metrics.atBats.filter(pick).map((a) => a.atBatIndex);

describe("play metrics (S93)", () =>
{
	it("ABS: 823823's ABS-challenge at-bats are 34, 39, 69, 82 and 83", () =>
	{
		expect(indices((a) => a.absChallenge)).toEqual([34, 39, 69, 82, 83]);
	});

	it("key moments: the 14 at-bats MLB marks, the lead change and the home runs", () =>
	{
		expect(indices((a) => a.keyMoment)).toEqual([15, 21, 41, 46, 53, 64, 67, 68, 72, 73, 74, 75, 82, 84]);
		expect(indices((a) => a.leadChange)).toEqual([15]);
		expect(indices((a) => a.homeRun)).toEqual([15, 46, 64]);
		expect(indices((a) => a.scoring)).toEqual([15, 21, 30, 35, 36, 41, 46, 53, 64]);
		expect(indices((a) => a.strikeout)).toContain(82);
		expect(indices((a) => a.highLeverage)).toContain(82);
		expect(indices((a) => a.hardHit)).toContain(7);
	});

	it("win probability: per at-bat, both teams' chance after it and what it added, plus contact", () =>
	{
		expect(metrics.atBats).toHaveLength(85);
		expect(metrics.atBats.map((a) => a.atBatIndex)).toEqual([...Array(85).keys()]);
		const ab82 = metrics.atBats[82]!;
		expect(ab82).toMatchObject({
			homeWinProbability: 4.7,
			awayWinProbability: 95.3,
			homeWinProbabilityAdded: -6.8,
			awayWinProbabilityAdded: 6.8,
			hitData: {
				launchSpeed: null,
				launchAngle: null,
				totalDistance: null,
			},
		});
		const homer = metrics.atBats[15]!;
		expect(homer.hitData.launchSpeed).toBeGreaterThan(90);
		expect(homer.hitData.totalDistance).toBeGreaterThan(300);
	});

	it("fixture: the fixture client reads the recording, and 823823's game carries it", async () =>
	{
		const fixtures = new FixtureMlbStatsClient();
		expect(await fixtures.fetchPlayMetrics(823823)).toEqual(metrics);
		expect((await fixtures.fetchGame(823823)).playMetrics).toEqual(metrics);
	});

	it("optional: no recording, a failing feed or an empty one leaves playMetrics absent and the game served as before", async () =>
	{
		const fixtures = new FixtureMlbStatsClient();
		expect(await fixtures.fetchPlayMetrics(744834)).toBeNull();
		expect(await fixtures.fetchGame(744834)).not.toHaveProperty("playMetrics");
		expect(mapPlayMetrics({})).toBeNull();
		expect(mapPlayMetrics({
			allPlayMetrics: [],
		})).toBeNull();

		const live = readFileSync(path.resolve(path.dirname(RAW), "live-823823.json"));
		const failing = new HttpMlbStatsClient({
			fetchImpl: async (input) =>
			{
				const url = String(input);
				if (url.includes("/feed/live")) return new Response(live);
				return new Response("{}", {
					status: url.includes("bdfed") ? 503 : 404,
				});
			},
		});
		const game = await failing.fetchGame(823823);
		expect(game.gamePk).toBe(823823);
		expect(game).not.toHaveProperty("playMetrics");
	});

	it("a feed MLB returns with missing figures maps them to null and false, not a throw", () =>
	{
		expect(mapPlayMetrics({
			allPlayMetrics: [{
				atBatIndex: 3,
			}],
		})).toEqual({
			atBats: [{
				atBatIndex: 3,
				homeWinProbability: null,
				awayWinProbability: null,
				homeWinProbabilityAdded: null,
				awayWinProbabilityAdded: null,
				keyMoment: false,
				leadChange: false,
				scoring: false,
				homeRun: false,
				hardHit: false,
				strikeout: false,
				highLeverage: false,
				absChallenge: false,
				hitData: {
					launchSpeed: null,
					launchAngle: null,
					totalDistance: null,
				},
			}],
		});
	});
});
