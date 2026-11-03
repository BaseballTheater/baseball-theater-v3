import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import {
	parseGameContentResponse,
	parseGraphContentResponse,
	parseLiveFeedResponse,
	parsePlayMetricsResponse,
	parseScheduleResponse,
	parseSeasonsResponse,
} from "./parse.js";

const rawDir = fileURLToPath(new URL("../../../fixtures/raw/", import.meta.url));

function readRaw(name: string): unknown
{
	return JSON.parse(readFileSync(rawDir + name, "utf8"));
}

function first<T>(items: readonly T[], what: string): T
{
	const value = items[0];
	if (value === undefined) throw new Error(`expected at least one ${what}`);
	return value;
}

describe("parseScheduleResponse", () =>
{
	it("parses the recorded schedule-2026-09-05.json payload", () =>
	{
		const parsed = parseScheduleResponse(readRaw("schedule-2026-09-05.json"));
		const date = first(parsed.dates, "date");

		expect(date.date).toBe("2026-09-05");
		expect(date.games).toHaveLength(15);

		const game = first(date.games, "game");
		expect(game.gamePk).toBeGreaterThan(0);
		expect(game.status.abstractGameState).toBeTruthy();
		expect(game.teams.away.team.id).toBeGreaterThan(0);
		expect(game.teams.home.team.abbreviation).toMatch(/^[A-Z]{2,3}$/);
	});

	it("throws when a required field is missing", () =>
	{
		expect(() => parseScheduleResponse({
			dates: [{
				date: "2026-09-05",
			}],
		})).toThrow();
	});
});

describe("parseLiveFeedResponse", () =>
{
	it("parses the recorded live-823823.json payload", () =>
	{
		const parsed = parseLiveFeedResponse(readRaw("live-823823.json"));

		expect(parsed.gamePk).toBe(823823);
		expect(parsed.gameData.status.detailedState).toBe("Final");
		expect(parsed.gameData.teams.away.abbreviation).toBe("CHC");
		expect(parsed.gameData.teams.home.abbreviation).toBe("MIA");
		expect(parsed.gameData.venue.name).toBe("loanDepot park");
		expect(parsed.liveData.plays.allPlays).toHaveLength(85);
		expect(parsed.liveData.linescore.innings.length).toBeGreaterThanOrEqual(9);
	});

	it("keeps Statcast plate coordinates on pitch events", () =>
	{
		const parsed = parseLiveFeedResponse(readRaw("live-823823.json"));
		const pitches = parsed.liveData.plays.allPlays
			.flatMap((play) => play.playEvents)
			.filter((event) => event.pitchData?.coordinates?.pX !== undefined);

		expect(pitches).toHaveLength(339);

		const pitch = first(pitches, "pitch");
		expect(typeof pitch.pitchData?.coordinates?.pZ).toBe("number");
		expect(pitch.pitchData?.strikeZoneTop).toBeGreaterThan(0);
	});

	it("throws when liveData is missing", () =>
	{
		expect(() => parseLiveFeedResponse({
			gamePk: 823823,
			gameData: {},
		})).toThrow();
	});
});

describe("parseGameContentResponse", () =>
{
	it("parses the recorded content-823823.json payload", () =>
	{
		const parsed = parseGameContentResponse(readRaw("content-823823.json"));
		const items = parsed.highlights?.highlights?.items ?? [];

		expect(items).toHaveLength(40);

		const item = first(items, "highlight");
		expect(item.title).toBeTruthy();
		expect(item.blurb).toBeTruthy();
		expect(first(item.playbacks, "playback").url).toMatch(/^https?:\/\//);
		expect(parsed.editorial?.recap?.mlb?.blurb).toBeTruthy();
	});

	it("throws when a highlight is missing its playbacks", () =>
	{
		expect(() =>
			parseGameContentResponse({
				highlights: {
					highlights: {
						items: [{
							title: "t",
							blurb: "b",
						}],
					},
				},
			}),
		).toThrow();
	});
});

describe("parsePlayMetricsResponse (S93)", () =>
{
	it("graphql content: parses the recorded 823823 getGamesByGamePks response, its videos and articles (S94)", () =>
	{
		const parsed = parseGraphContentResponse(readRaw("graphql-content-823823.json"));
		const game = parsed.data!.getGamesByGamePks![0]!;
		expect(game.gamePk).toBe(823823);
		const videos = game.content!.videoContent!;
		expect(videos).toHaveLength(25);
		expect(videos.filter((v) => v.playIdRef)).toHaveLength(18);
		expect(game.content!.recapArticle).toHaveLength(1);
		expect(game.content!.relatedArticles![0]!.slug).toBe("griffin-conine-father-son-duo-home-runs");
	});

	it("graphql content: a video without its id is rejected (S94)", () =>
	{
		expect(() => parseGraphContentResponse({
			data: {
				getGamesByGamePks: [{
					gamePk: 1,
					content: {
						videoContent: [{
							title: "no id",
						}],
					},
				}],
			},
		})).toThrow();
	});

	it("play metrics: parses the recorded 823823 feed, its index lists and every at-bat", () =>
	{
		const parsed = parsePlayMetricsResponse(readRaw("playmetrics-823823.json"));
		expect(parsed.keyMoments).toEqual([15, 21, 41, 46, 53, 64, 67, 68, 72, 73, 74, 75, 82, 84]);
		expect(parsed.absChallenge).toEqual([34, 39, 69, 82, 83]);
		expect(parsed.allPlayMetrics).toHaveLength(85);
		const ab82 = parsed.allPlayMetrics![82]!;
		expect(ab82.atBatIndex).toBe(82);
		expect(ab82.isAbsChallenge).toBe(true);
		expect(ab82.homeTeamWinProbability).toBe(4.7);
		expect(ab82.playEvents!.length).toBeGreaterThan(0);
	});

	it("play metrics: an at-bat without its index is rejected", () =>
	{
		expect(() => parsePlayMetricsResponse({
			allPlayMetrics: [{
				when: "top 1",
			}],
		})).toThrow();
	});
});

describe("parseSeasonsResponse (S111)", () =>
{
	it("seasons: parses the recorded 2026 calendar", () =>
	{
		const [season] = parseSeasonsResponse(readRaw("seasons-2026.json")).seasons;
		expect(season?.seasonId).toBe("2026");
		expect(season?.springStartDate).toBe("2026-02-20");
		expect(season?.postSeasonEndDate).toBe("2026-10-31");
	});

	it("seasons: an unpublished season is an empty list", () =>
	{
		expect(parseSeasonsResponse({
			seasons: [],
		}).seasons).toEqual([]);
	});

	it("seasons: a date that is not a calendar day is rejected", () =>
	{
		expect(() => parseSeasonsResponse({
			seasons: [{
				seasonId: "2026",
				springStartDate: "Feb 20",
			}],
		})).toThrow();
	});
});
