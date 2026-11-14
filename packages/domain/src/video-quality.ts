import type { MediaHighlight } from "./types.js";

/**
 * One quality the player offers for a clip: what it is called in the picker, the URL it
 * plays, and whether it is an HLS stream (which only some browsers play without a library).
 */
export type VideoQuality = {
	/** MLB's playback name (`mp4Avc`, `highBit`, `hlsCloud`), or `default` for a clip with no renditions. */
	id: string;
	label: string;
	url: string;
	hls: boolean;
};

/**
 * What each of MLB's playback names is, in plain words. MLB's content API lists, for every
 * clip, `mp4Avc` (a 720p MP4 at about 4 Mbps), `highBit` (the same picture at about 16 Mbps)
 * and `hlsCloud` (an adaptive HLS stream; `HTTP_CLOUD_WIRED` and `HTTP_CLOUD_WIRED_60` are
 * the same URL under other names). Some clips (lineup and bullpen cards) also come cut for
 * a phone held upright, as `portrait_mp4Avc` and `portrait_hlsCloud`. A name not listed here
 * keeps MLB's own.
 */
const QUALITY_NAMES: Readonly<Record<string, string>> = {
	highBit: "High",
	mp4Avc: "Standard",
	hlsCloud: "Auto",
	HTTP_CLOUD_WIRED: "Auto",
	HTTP_CLOUD_WIRED_60: "Auto",
	portrait_mp4Avc: "Portrait",
	portrait_hlsCloud: "Portrait auto",
};

/** The order the picker lists them: sharpest first, the adaptive stream after the files, portrait cuts last. */
const QUALITY_ORDER = ["highBit", "mp4Avc", "hlsCloud", "HTTP_CLOUD_WIRED_60", "HTTP_CLOUD_WIRED", "portrait_mp4Avc", "portrait_hlsCloud"];

/** MLB's MP4 file names end `_<width>x<height>_<fps>_<kbps>K.mp4` (`…asset_1280x720_59_16000K.mp4`). */
const MP4_SHAPE = /_(\d+)x(\d+)_\d+_(\d+)K\.mp4$/;

/** `720p, 16 Mbps` from an MP4's file name, or null when the URL doesn't say. */
function mp4Detail(url: string): string | null
{
	const match = MP4_SHAPE.exec(url);
	if (!match) return null;
	const height = match[2]!;
	const mbps = Math.round(Number(match[3]) / 1000);
	return `${height}p, ${mbps} Mbps`;
}

/** True for an HLS playlist (`.m3u8`), which Safari plays natively and most other browsers don't. */
function isHls(url: string): boolean
{
	return /\.m3u8(\?|$)/.test(url);
}

/**
 * The qualities a clip can play in, for the player's quality picker (owner, 2026-11-12:
 * "video player needs a quality selector for the several qualities the api shows"): one per
 * rendition MLB lists, labelled by what it is (`High · 720p, 16 Mbps`, `Standard · 720p, 4 Mbps`,
 * `Auto (HLS)`), sharpest first. Nothing is invented: a quality shows only when MLB gave its
 * URL, and two names for one URL are one quality. A clip recorded before renditions were kept
 * has its one `playbackUrl`, as a single `default` quality; a clip with no URL has none.
 */
export function videoQualities(highlight: Pick<MediaHighlight, "playbackUrl" | "renditions">): VideoQuality[]
{
	const renditions = highlight.renditions ?? [];
	if (renditions.length === 0)
	{
		return highlight.playbackUrl ? [{
			id: "default",
			label: "Default",
			url: highlight.playbackUrl,
			hls: isHls(highlight.playbackUrl),
		}] : [];
	}
	const rank = (name: string) =>
	{
		const at = QUALITY_ORDER.indexOf(name);
		return at === -1 ? QUALITY_ORDER.length : at;
	};
	const seen = new Set<string>();
	return [...renditions]
		.sort((a, b) => rank(a.name) - rank(b.name))
		.filter((rendition) =>
		{
			if (seen.has(rendition.url)) return false;
			seen.add(rendition.url);
			return true;
		})
		.map((rendition) =>
		{
			const hls = isHls(rendition.url);
			const name = QUALITY_NAMES[rendition.name] ?? rendition.name;
			const detail = hls ? "HLS" : mp4Detail(rendition.url);
			return {
				id: rendition.name,
				label: hls ? `${name} (${detail})` : detail ? `${name} · ${detail}` : name,
				url: rendition.url,
				hls,
			};
		});
}

/**
 * The quality a clip starts in: the one whose URL is `playbackUrl` (BT's long-standing pick,
 * the standard MP4), else the first. Undefined when the clip has none.
 */
export function defaultVideoQuality(qualities: readonly VideoQuality[], playbackUrl: string | null): VideoQuality | undefined
{
	return qualities.find((quality) => quality.url === playbackUrl) ?? qualities[0];
}

/** True for a cut MLB made for a phone held upright (`portrait_mp4Avc`, `portrait_hlsCloud`). */
function isPortrait(quality: VideoQuality): boolean
{
	return quality.id.startsWith("portrait_");
}

/**
 * The clip as a file, for the player's Download, Copy link, Direct link and Share (owner,
 * 2026-11-12: "copy link, direct link, download, share"): the quality playing when it is an
 * MP4, else the sharpest MP4 of the same cut (portrait for a portrait stream, landscape
 * otherwise), since an HLS playlist is not a file anyone can save or open on its own.
 * Undefined when MLB gave no MP4 of that cut, or nothing is playing.
 */
export function fileQuality(qualities: readonly VideoQuality[], playing: VideoQuality | undefined): VideoQuality | undefined
{
	if (!playing) return undefined;
	if (!playing.hls) return playing;
	return qualities.find((quality) => !quality.hls && isPortrait(quality) === isPortrait(playing));
}
