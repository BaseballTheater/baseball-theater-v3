import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import {
	classifyHighlight, clipDuration, filterHighlights, groupHighlights, highlightGroup, sortHighlights,
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

describe("sortHighlights (S69)", () =>
{
	const clip = (id: string, date?: string) => ({
		id,
		title: id,
		date,
	}) as never;
	const clips = [clip("a", "2026-09-05T22:00:00Z"), clip("b"), clip("c", "2026-09-05T23:00:00Z"), clip("d", "2026-09-05T22:00:00Z")];
	const ids = (list: { id: string }[]) => list.map((h) => h.id);

	it("impact keeps the given (impact-ranked) order", () =>
	{
		expect(ids(sortHighlights(clips, "impact"))).toEqual(["a", "b", "c", "d"]);
	});

	it("newest / oldest order by date; ties keep impact order; undated clips go last", () =>
	{
		expect(ids(sortHighlights(clips, "newest"))).toEqual(["c", "a", "d", "b"]);
		expect(ids(sortHighlights(clips, "oldest"))).toEqual(["a", "d", "c", "b"]);
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

describe("groupHighlights (S69)", () =>
{
	it("puts each clip in Pre-game, Game highlights, Statcast or Post-game from MLB's keywords", () =>
	{
		const group = (title: string) => highlightGroup(VIDEOS.find((h) => h.title.startsWith(title))!);
		expect(group("Starting lineups")).toBe("pregame");
		expect(group("Bullpen availability for Chicago")).toBe("pregame");
		expect(group("Bench availability for Miami")).toBe("pregame");
		expect(group("Fielding alignment for Miami")).toBe("pregame");
		expect(group("Griffin Conine's two-run home run")).toBe("highlights");
		expect(group("Ball 1 overturned")).toBe("highlights");
		expect(group("Kyle Stowers' home run through bat tracking")).toBe("statcast");
		expect(group("Breaking down Javier Assad's pitches")).toBe("statcast");
		expect(group("Kyle Stowers' 442-foot home run")).toBe("statcast");
		expect(group("Condensed Game")).toBe("postgame");
		expect(group("Conforto clubs")).toBe("postgame");
		expect(group("Clayton McCullough discusses")).toBe("postgame");
		expect(highlightGroup({
			tags: ["manager-pregame"],
		})).toBe("pregame");
		expect(highlightGroup({})).toBe("highlights");
	});

	it("groups in order, each keeping the order given, and leaves out a group with no clips", () =>
	{
		const groups = groupHighlights(VIDEOS);
		expect(groups.map((g) => g.group)).toEqual(["pregame", "highlights", "statcast", "postgame"]);
		expect(groups.flatMap((g) => g.highlights)).toHaveLength(VIDEOS.length);
		for (const { highlights } of groups)
		{
			expect(titles(highlights)).toEqual(titles(VIDEOS).filter((title) => highlights.some((h) => h.title === title)));
		}
		const onlyHighlights = filterHighlights(VIDEOS, {
			query: "ABS challenge",
		});
		expect(groupHighlights(onlyHighlights).map((g) => g.group)).toEqual(["highlights"]);
		expect(groupHighlights([])).toEqual([]);
	});
});
