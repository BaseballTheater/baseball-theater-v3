import {
	describe, expect, it,
} from "vitest";
import {
	DEFAULT_SETTINGS, GAME_ROW_SLOTS, OPENS_FIRST_ROOMS, parseAccountSettings, VIDEO_PLAYERS,
} from "./settings.js";
import { MLB_TEAMS } from "./teams.js";

describe("MLB_TEAMS", () =>
{
	it("lists the 30 clubs once each", () =>
	{
		expect(MLB_TEAMS).toHaveLength(30);
		expect(new Set(MLB_TEAMS.map((t) => t.id)).size).toBe(30);
		expect(new Set(MLB_TEAMS.map((t) => t.abbreviation)).size).toBe(30);
		expect(new Set(MLB_TEAMS.map((t) => t.fullName)).size).toBe(30);
	});

	it("each club's full name ends with its club name, the city before it (the Athletics have no city)", () =>
	{
		for (const team of MLB_TEAMS)
		{
			if (team.id === 109) expect(team.fullName).toBe("Arizona Diamondbacks");
			else expect(team.fullName.endsWith(team.name), team.fullName).toBe(true);
		}
		expect(MLB_TEAMS.find((t) => t.id === 112)?.fullName).toBe("Chicago Cubs");
		expect(MLB_TEAMS.find((t) => t.id === 133)?.fullName).toBe("Athletics");
	});
});

describe("parseAccountSettings", () =>
{
	it("accepts a well-formed document and the house defaults", () =>
	{
		expect(OPENS_FIRST_ROOMS).toEqual(["videos", "live", "box"]);
		expect(parseAccountSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
		expect(parseAccountSettings({
			favoriteTeamIds: [147, 111],
			opensFirst: "live",
			gameRowSlot: "roomMenu",
			version: 3,
			extra: "dropped",
		})).toEqual({
			favoriteTeamIds: [147, 111],
			opensFirst: "live",
			gameRowSlot: "roomMenu",
			collapseNonFavorites: false,
			hideScores: false,
			videoPlayer: "dialog",
			version: 3,
		});
	});

	it("gameRowSlot: Status is the default, and a document saved before S67 (no gameRowSlot) reads as it", () =>
	{
		expect(GAME_ROW_SLOTS).toEqual(["status", "roomMenu"]);
		expect(DEFAULT_SETTINGS.gameRowSlot).toBe("status");
		expect(parseAccountSettings({
			favoriteTeamIds: [],
			opensFirst: "box",
			version: 2,
		})).toEqual({
			favoriteTeamIds: [],
			opensFirst: "box",
			gameRowSlot: "status",
			collapseNonFavorites: false,
			hideScores: false,
			videoPlayer: "dialog",
			version: 2,
		});
	});

	it("collapseNonFavorites and hideScores: off by default, kept when given, booleans only (S68)", () =>
	{
		expect(DEFAULT_SETTINGS).toMatchObject({
			collapseNonFavorites: false,
			hideScores: false,
		});
		expect(parseAccountSettings({
			favoriteTeamIds: [],
			opensFirst: "box",
			collapseNonFavorites: true,
			hideScores: true,
			version: 2,
		})).toMatchObject({
			collapseNonFavorites: true,
			hideScores: true,
		});
		expect(parseAccountSettings({
			favoriteTeamIds: [],
			opensFirst: "box",
			hideScores: "yes",
			version: 2,
		})).toBeNull();
	});

	it("video player: Dialog is the default, a document saved before S70 reads as it, Stage is kept, anything else is rejected (S70)", () =>
	{
		expect(VIDEO_PLAYERS).toEqual(["dialog", "stage"]);
		expect(DEFAULT_SETTINGS.videoPlayer).toBe("dialog");
		const before = {
			favoriteTeamIds: [],
			opensFirst: "box",
			version: 2,
		};
		expect(parseAccountSettings(before)?.videoPlayer).toBe("dialog");
		expect(parseAccountSettings({
			...before,
			videoPlayer: "stage",
		})?.videoPlayer).toBe("stage");
		expect(parseAccountSettings({
			...before,
			videoPlayer: "popup",
		})).toBeNull();
	});

	it("rejects anything malformed", () =>
	{
		const good = {
			favoriteTeamIds: [147],
			opensFirst: "box",
			version: 1,
		};
		for (const bad of [
			null,
			"settings",
			{
				...good,
				favoriteTeamIds: "147",
			},
			{
				...good,
				favoriteTeamIds: [1],
			},
			{
				...good,
				favoriteTeamIds: [147, 147],
			},
			{
				...good,
				opensFirst: "plays",
			},
			{
				...good,
				gameRowSlot: "winProbability",
			},
			{
				...good,
				version: -1,
			},
			{
				...good,
				version: 1.5,
			},
			{
				favoriteTeamIds: [147],
				opensFirst: "box",
			},
		])
		{
			expect(parseAccountSettings(bad)).toBeNull();
		}
	});
});
