import {
	describe, expect, it,
} from "vitest";
import {
	gameInfoLines, roomLabel, shortPlayerName,
} from "./format.js";

describe("roomLabel", () =>
{
	it("capitalizes the room for its tab", () =>
	{
		expect(roomLabel("videos")).toBe("Videos");
		expect(roomLabel("recap")).toBe("Recap");
	});
});

describe("shortPlayerName (S2)", () =>
{
	it("shortens the first name to an initial and keeps the rest", () =>
	{
		expect(shortPlayerName("Pete Crow-Armstrong")).toBe("P. Crow-Armstrong");
		expect(shortPlayerName("Ronald Acuña Jr.")).toBe("R. Acuña Jr.");
	});

	it("leaves a one-word name as it is", () =>
	{
		expect(shortPlayerName("Ichiro")).toBe("Ichiro");
	});
});

describe("gameInfoLines (S2)", () =>
{
	it("keeps the drawn labels in the drawn order, without MLB's closing period", () =>
	{
		expect(gameInfoLines([
			{
				label: "Att",
				value: "26,141.",
			},
			{
				label: "Umpires",
				value: "HP: Someone.",
			},
			{
				label: "Venue",
				value: "loanDepot park.",
			},
		])).toEqual([
			{
				label: "Venue",
				value: "loanDepot park",
			},
			{
				label: "Att",
				value: "26,141",
			},
		]);
	});
});
