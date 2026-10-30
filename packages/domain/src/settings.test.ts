import {
	describe, expect, it,
} from "vitest";
import {
	DEFAULT_SETTINGS, GAME_ROW_SLOTS, OPENS_FIRST_ROOMS, parseAccountSettings,
} from "./settings.js";
import { MLB_TEAMS } from "./teams.js";

describe("MLB_TEAMS", () =>
{
	it("lists the 30 clubs once each", () =>
	{
		expect(MLB_TEAMS).toHaveLength(30);
		expect(new Set(MLB_TEAMS.map((t) => t.id)).size).toBe(30);
		expect(new Set(MLB_TEAMS.map((t) => t.abbreviation)).size).toBe(30);
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
			version: 2,
		});
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
