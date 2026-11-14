import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseGameContentResponse } from "@bt/mlb-api";
import {
	describe, expect, it,
} from "vitest";
import {
	articleParagraphs, mapContentHighlights, mapRecap, pickPlaybackUrl, pickRenditions,
} from "./content.js";

const content = parseGameContentResponse(
	JSON.parse(
		readFileSync(
			fileURLToPath(
				new URL("../../../fixtures/raw/content-823823.json", import.meta.url),
			),
			"utf8",
		),
	),
);

describe("mapContentHighlights", () =>
{
	const highlights = mapContentHighlights(content);

	it("maps the fixture's highlight reel", () =>
	{
		expect(highlights.length).toBeGreaterThan(0);
	});

	it("gives every highlight an id, a title and a playback url", () =>
	{
		for (const highlight of highlights)
		{
			expect(highlight.id).toBeTruthy();
			expect(highlight.title).toBeTruthy();
			expect(highlight.playbackUrl).toBeTruthy();
		}
	});

	it("renditions: every video MLB lists, each URL once, no trickplay strip (owner, 2026-11-12: quality selector)", () =>
	{
		for (const highlight of highlights)
		{
			const urls = highlight.renditions!.map((rendition) => rendition.url);
			expect(new Set(urls).size).toBe(urls.length);
			expect(urls.every((url) => /\.(mp4|m3u8)$/.test(url))).toBe(true);
			expect(urls).toContain(highlight.playbackUrl);
		}
		const first = content.highlights!.highlights!.items[0]!;
		expect(pickRenditions(first).map((rendition) => rendition.name)).toEqual(["hlsCloud", "mp4Avc", "highBit"]);
	});

	it("keywords: kind, date, team ids and tags come from MLB's keywords (S69)", () =>
	{
		const recap = highlights.find((h) => h.title === "Conforto clubs Cubs' 200th homer in close win")!;
		expect(recap).toMatchObject({
			kind: "recap",
			date: "2026-09-06T00:21:36.579Z",
			teamIds: [146, 112],
		});
		expect(recap.tags).toContain("game-recap");
		expect(highlights.find((h) => h.title.startsWith("Condensed Game"))?.kind).toBe("condensed");
		const homer = highlights.find((h) => h.title === "Michael Conforto hits Cubs' 200th home run (14)")!;
		expect(homer.kind).toBe("highlight");
		expect(homer.teamIds).toEqual([112]);
		const viz = highlights.find((h) => h.title === "Breaking down Kyle Stowers' home run")!;
		expect(viz.kind).toBe("video");
		expect(viz.tags).toContain("data-visualization");
		// Bench reports carry no team_id keyword: no teams, not a guess.
		expect(highlights.find((h) => h.title.startsWith("Bench availability for Miami"))?.teamIds).toEqual([]);
	});

	it("keywords: an item with none is a plain video with no teams or tags", () =>
	{
		const [bare] = mapContentHighlights({
			highlights: {
				highlights: {
					items: [{
						title: "t",
						blurb: "",
						playbacks: [],
					}],
				},
			},
		} as never);
		expect(bare).toMatchObject({
			kind: "video",
			date: null,
			teamIds: [],
			tags: [],
		});
	});
});

describe("pickPlaybackUrl", () =>
{
	it("prefers the highest-fidelity mp4 over the hls stream", () =>
	{
		const url = pickPlaybackUrl({
			id: "x",
			title: "t",
			blurb: "b",
			playbacks: [
				{
					name: "hlsCloud",
					url: "https://example.test/stream.m3u8",
				},
				{
					name: "mp4Avc",
					url: "https://example.test/video.mp4",
				},
			],
		});

		expect(url).toBe("https://example.test/video.mp4");
	});

	it("falls back to hls when no mp4 is offered", () =>
	{
		const url = pickPlaybackUrl({
			id: "x",
			title: "t",
			blurb: "b",
			playbacks: [{
				name: "hlsCloud",
				url: "https://example.test/stream.m3u8",
			}],
		});

		expect(url).toBe("https://example.test/stream.m3u8");
	});
});

describe("mapRecap (S10)", () =>
{
	it("recap: the recorded recap becomes a headline and plain paragraphs, with no markup or embedded players", () =>
	{
		const recap = mapRecap(content)!;
		expect(recap.headline).toBe("Zeferjahn records 1st Cubs save, Conforto notches club's 200th HR in win over Marlins");
		expect(recap.text).toMatch(/^MIAMI – Between the eighth and ninth innings of Chicago’s 6-5 win over the Marlins/);
		expect(recap.text).not.toMatch(/<|iframe|\*\*|forge-entity/);
		expect(recap.text).toContain("\n\n1. Zeferjahn comes through in big spot\n\n");
	});

	it("recap: no headline or no words is no recap; a blurb stands in for a missing body", () =>
	{
		expect(mapRecap({})).toBeUndefined();
		expect(mapRecap({
			editorial: {
				recap: {
					mlb: {
						headline: "Headline only",
					},
				},
			},
		})).toBeUndefined();
		expect(mapRecap({
			editorial: {
				recap: {
					mlb: {
						headline: "H",
						blurb: "A short blurb.",
					},
				},
			},
		})).toEqual({
			headline: "H",
			text: "A short blurb.",
		});
	});

	it("articleParagraphs decodes entities and splits on blank lines", () =>
	{
		expect(articleParagraphs("<p>A &amp; B&nbsp;C\n\nD &lt;E&gt; &quot;F&quot; &#39;G&#39;</p><p></p>")).toEqual(["A & B C", "D <E> \"F\" 'G'"]);
		expect(articleParagraphs("<p>a \\[this\\] park\n\n* A related story</p>")).toEqual(["a [this] park", "A related story"]);
	});
});
