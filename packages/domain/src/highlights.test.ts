import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import {
	classifyHighlight, clipDuration, filterHighlights,
} from "./highlights.js";
import { rankHighlightsByImpact } from "./impact.js";
import type { MediaHighlight } from "./types.js";

/** 823823's 40 videos as BT serves them: mapped from the recording, impact-ranked. */
const VIDEOS = rankHighlightsByImpact((JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/game-823823.json", import.meta.url)), "utf8")) as {
	highlights: MediaHighlight[];
}).highlights);

const titles = (list: MediaHighlight[]) => list.map((h) => h.title);

describe("classifyHighlight (S69)", () =>
{
	it("reads the featured teams and whether a clip is stat / viz from MLB's keywords", () =>
	{
		expect(classifyHighlight({
			teamIds: [146],
			tags: ["darkroom-bat-track", "home-run"],
		})).toEqual({
			teamIds: [146],
			statViz: true,
		});
		expect(classifyHighlight({
			teamIds: [112],
			tags: ["data-visualization"],
		}).statViz).toBe(true);
		expect(classifyHighlight({
			teamIds: [112, 146],
			tags: ["highlight", "home-run"],
		}).statViz).toBe(false);
	});

	it("an older recording without keywords belongs to no facet", () =>
	{
		expect(classifyHighlight({})).toEqual({
			teamIds: [],
			statViz: false,
		});
	});
});

describe("filterHighlights (S69)", () =>
{
	it("search: matches the title or the blurb, case-insensitively; blank keeps all", () =>
	{
		expect(titles(filterHighlights(VIDEOS, {
			query: "  ABS CHALLENGE ",
		}))).toHaveLength(5);
		expect(filterHighlights(VIDEOS, {
			query: "   ",
		})).toHaveLength(40);
		const blurbOnly = [{
			...VIDEOS[0]!,
			title: "Untitled",
			blurb: "A diving catch in the gap",
		}];
		expect(filterHighlights(blurbOnly, {
			query: "diving",
		})).toHaveLength(1);
	});

	it("featured team keeps clips that feature the team; stat / viz keeps viz clips; both combine", () =>
	{
		const cubs = filterHighlights(VIDEOS, {
			teamId: 112,
		});
		expect(cubs.every((h) => h.teamIds?.includes(112))).toBe(true);
		expect(cubs.length).toBeGreaterThan(0);
		const viz = filterHighlights(VIDEOS, {
			statViz: true,
		});
		expect(titles(viz)).toContain("Breaking down Kyle Stowers' home run");
		expect(titles(viz)).not.toContain("Michael Conforto hits Cubs' 200th home run (14)");
		expect(titles(filterHighlights(VIDEOS, {
			teamId: 112,
			statViz: true,
			query: "conforto",
		}))).toEqual(["Measuring the stats on Michael Conforto's home run"]);
	});

	it("impact: filtering never reorders — results keep the impact ranking", () =>
	{
		const filtered = filterHighlights(VIDEOS, {
			teamId: 146,
		});
		const positions = filtered.map((h) => VIDEOS.indexOf(h));
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
		expect(filtered[0]).toBe(VIDEOS.find((h) => h.teamIds?.includes(146)));
	});
});

describe("clipDuration (S69)", () =>
{
	it("MLB's HH:MM:SS as the badge prints it", () =>
	{
		expect(clipDuration("00:00:29")).toBe("0:29");
		expect(clipDuration("00:03:06")).toBe("3:06");
		expect(clipDuration("00:12:12")).toBe("12:12");
		expect(clipDuration("01:02:05")).toBe("1:02:05");
	});

	it("null for anything that is not a duration", () =>
	{
		expect(clipDuration(null)).toBeNull();
		expect(clipDuration(undefined)).toBeNull();
		expect(clipDuration("0:29")).toBeNull();
	});
});
