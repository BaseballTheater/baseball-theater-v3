import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import { COVERAGE_IGNORE } from "./coverage-ignore.js";
import { leafPaths, uncoveredPaths } from "./coverage.js";
import {
	parseGameContentResponse,
	parseGameTimestamps,
	parseLiveFeedResponse,
	parsePeopleResponse,
	parsePlayMetricsResponse,
	parseScheduleResponse,
	parseSeasonsResponse,
	parseStandingsResponse,
} from "./parse.js";
import { parseRecordedReplayWalk } from "./replay.js";

const rawDir = fileURLToPath(new URL("../../../fixtures/raw/", import.meta.url));

function readRaw(name: string): unknown
{
	return JSON.parse(readFileSync(rawDir + name, "utf8"));
}

/**
 * Every `fixtures/raw/*.json`, with the parser that owns it. Most are a single
 * raw upstream response; `diffpatch-823823.json` is the recorded replay walk (a
 * derived envelope, one entry per adjacent timecode pair), field-gated here the
 * same way so a new op field or envelope key cannot slip in unmodeled (S22).
 */
const fixtures: ReadonlyArray<[string, (input: unknown) => unknown]> = [
	["schedule-2026-09-05.json", parseScheduleResponse],
	["live-823823.json", parseLiveFeedResponse],
	["live-823823-base.json", parseLiveFeedResponse],
	["content-823823.json", parseGameContentResponse],
	["playmetrics-823823.json", parsePlayMetricsResponse],
	["timestamps-823823.json", parseGameTimestamps],
	["standings-2026-09-05.json", parseStandingsResponse],
	["seasons-2025.json", parseSeasonsResponse],
	["seasons-2026.json", parseSeasonsResponse],
	["worldseries-2025.json", parseScheduleResponse],
	["worldseries-2026.json", parseScheduleResponse],
	["people-823823.json", parsePeopleResponse],
	["diffpatch-823823.json", parseRecordedReplayWalk],
];

describe("leafPaths", () =>
{
	it("normalizes array indices and id-keyed map keys", () =>
	{
		const paths = leafPaths({
			dates: [{
				games: [{
					gamePk: 1,
				}, {
					gamePk: 2,
					link: "/x",
				}],
			}],
			players: {
				ID660271: {
					fullName: "a",
				},
				ID808982: {
					jerseyNumber: "7",
				},
			},
		});

		expect(paths).toEqual([
			"dates[].games[].gamePk",
			"dates[].games[].link",
			"players.{id}.fullName",
			"players.{id}.jerseyNumber",
		]);
	});

	it("treats an empty object or array as a leaf of its own", () =>
	{
		expect(leafPaths({
			a: {},
			b: [],
			c: {
				d: null,
			},
		})).toEqual(["a", "b[]", "c.d"]);
	});
});

describe("uncoveredPaths", () =>
{
	it("reports what the parsed value dropped", () =>
	{
		expect(uncoveredPaths({
			a: 1,
			b: {
				c: 2,
			},
		}, {
			a: 1,
		})).toEqual(["b.c"]);
	});

	it("subtracts the allowlist", () =>
	{
		expect(uncoveredPaths({
			a: 1,
			b: 2,
		}, {}, ["b"])).toEqual(["a"]);
	});
});

describe("fixture field coverage", () =>
{
	it.each(fixtures)("models every recorded path in %s", (name, parse) =>
	{
		const raw = readRaw(name);
		const uncovered = uncoveredPaths(raw, parse(raw), COVERAGE_IGNORE);

		expect(uncovered).toEqual([]);
	});

	it("keeps the allowlist small and every entry explained", () =>
	{
		const source = readFileSync(
			fileURLToPath(new URL("./coverage-ignore.ts", import.meta.url)),
			"utf8",
		);
		const entries = source.match(/^\s*"[^"]+",/gm) ?? [];
		const explained = source.match(/^\s*"[^"]+",\s*\/\/\s*reason:/gm) ?? [];

		expect(entries.length).toBe(COVERAGE_IGNORE.length);
		expect(explained.length).toBe(entries.length);
		expect(COVERAGE_IGNORE.length).toBeLessThanOrEqual(25);
	});
});
