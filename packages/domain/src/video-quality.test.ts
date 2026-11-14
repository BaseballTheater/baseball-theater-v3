import {
	describe, expect, it,
} from "vitest";
import {
	defaultVideoQuality, fileQuality, videoQualities,
} from "./video-quality.js";

const BASE = "https://mlb-cuts-diamond.mlb.com/FORGE/2026/2026-09/05/68e1ef46-6669f6b0-5b1ac736-csvm-diamondgcp-asset";
const HLS = `${BASE}.m3u8`;
const MP4 = `${BASE}_1280x720_59_4000K.mp4`;
const HIGH = `${BASE}_1280x720_59_16000K.mp4`;

/** The renditions MLB lists for a 2026 clip (`fixtures/raw/content-823823.json`), trickplay already dropped by the mapper. */
const MLB_RENDITIONS = [
	{
		name: "hlsCloud",
		url: HLS,
	},
	{
		name: "HTTP_CLOUD_WIRED",
		url: HLS,
	},
	{
		name: "HTTP_CLOUD_WIRED_60",
		url: HLS,
	},
	{
		name: "mp4Avc",
		url: MP4,
	},
	{
		name: "highBit",
		url: HIGH,
	},
];

describe("videoQualities", () =>
{
	it("one quality per distinct URL MLB lists, sharpest first, labelled from the file name", () =>
	{
		expect(videoQualities({
			playbackUrl: MP4,
			renditions: MLB_RENDITIONS,
		})).toEqual([
			{
				id: "highBit",
				label: "High · 720p, 16 Mbps",
				url: HIGH,
				hls: false,
			},
			{
				id: "mp4Avc",
				label: "Standard · 720p, 4 Mbps",
				url: MP4,
				hls: false,
			},
			{
				id: "hlsCloud",
				label: "Auto (HLS)",
				url: HLS,
				hls: true,
			},
		]);
	});

	it("portrait cuts (lineup and bullpen cards) list after the landscape ones, named for what they are", () =>
	{
		expect(videoQualities({
			playbackUrl: "https://darkroom-clips.mlb.com/a.mp4",
			renditions: [{
				name: "mp4Avc",
				url: "https://darkroom-clips.mlb.com/a.mp4",
			}, {
				name: "hlsCloud",
				url: "https://darkroom-clips.mlb.com/a.m3u8",
			}, {
				name: "portrait_mp4Avc",
				url: "https://darkroom-clips.mlb.com/b.mp4",
			}, {
				name: "portrait_hlsCloud",
				url: "https://darkroom-clips.mlb.com/b.m3u8",
			}],
		}).map((quality) => quality.label)).toEqual(["Standard", "Auto (HLS)", "Portrait", "Portrait auto (HLS)"]);
	});

	it("a name BT doesn't know keeps MLB's name, after the known ones; an MP4 whose name doesn't say its size has no detail", () =>
	{
		expect(videoQualities({
			playbackUrl: null,
			renditions: [{
				name: "mobile",
				url: "https://example.test/clip.mp4",
			}, {
				name: "mp4Avc",
				url: MP4,
			}],
		}).map((quality) => quality.label)).toEqual(["Standard · 720p, 4 Mbps", "mobile"]);
	});

	it("a clip recorded before renditions were kept plays its one URL as Default; no URL, no qualities", () =>
	{
		expect(videoQualities({
			playbackUrl: MP4,
		})).toEqual([{
			id: "default",
			label: "Default",
			url: MP4,
			hls: false,
		}]);
		expect(videoQualities({
			playbackUrl: HLS,
			renditions: [],
		})[0]?.hls).toBe(true);
		expect(videoQualities({
			playbackUrl: null,
		})).toEqual([]);
	});
});

describe("defaultVideoQuality", () =>
{
	it("starts on the quality BT has always played (playbackUrl), else the first, else none", () =>
	{
		const qualities = videoQualities({
			playbackUrl: MP4,
			renditions: MLB_RENDITIONS,
		});
		expect(defaultVideoQuality(qualities, MP4)?.id).toBe("mp4Avc");
		expect(defaultVideoQuality(qualities, "https://elsewhere.test/x.mp4")?.id).toBe("highBit");
		expect(defaultVideoQuality([], MP4)).toBeUndefined();
	});
});

describe("fileQuality", () =>
{
	const landscape = videoQualities({
		playbackUrl: MP4,
		renditions: MLB_RENDITIONS,
	});
	const cuts = videoQualities({
		playbackUrl: null,
		renditions: [{
			name: "hlsCloud",
			url: "https://darkroom-clips.mlb.com/a.m3u8",
		}, {
			name: "mp4Avc",
			url: "https://darkroom-clips.mlb.com/a.mp4",
		}, {
			name: "portrait_hlsCloud",
			url: "https://darkroom-clips.mlb.com/b.m3u8",
		}, {
			name: "portrait_mp4Avc",
			url: "https://darkroom-clips.mlb.com/b.mp4",
		}],
	});
	const byId = (list: typeof cuts, id: string) => list.find((quality) => quality.id === id)!;

	it("an MP4 playing is its own file", () =>
	{
		expect(fileQuality(landscape, byId(landscape, "mp4Avc"))?.url).toBe(MP4);
		expect(fileQuality(cuts, byId(cuts, "portrait_mp4Avc"))?.url).toBe("https://darkroom-clips.mlb.com/b.mp4");
	});

	it("a stream playing gives the sharpest MP4 of its own cut: portrait for portrait, landscape otherwise", () =>
	{
		expect(fileQuality(landscape, byId(landscape, "hlsCloud"))?.url).toBe(HIGH);
		expect(fileQuality(cuts, byId(cuts, "portrait_hlsCloud"))?.url).toBe("https://darkroom-clips.mlb.com/b.mp4");
		expect(fileQuality(cuts, byId(cuts, "hlsCloud"))?.url).toBe("https://darkroom-clips.mlb.com/a.mp4");
	});

	it("no MP4 of the cut, or nothing playing: none", () =>
	{
		const streamOnly = videoQualities({
			playbackUrl: HLS,
			renditions: [],
		});
		expect(fileQuality(streamOnly, streamOnly[0])).toBeUndefined();
		const portraitStreamOnly = cuts.filter((quality) => quality.id !== "portrait_mp4Avc");
		expect(fileQuality(portraitStreamOnly, byId(cuts, "portrait_hlsCloud"))).toBeUndefined();
		expect(fileQuality(landscape, undefined)).toBeUndefined();
	});
});
