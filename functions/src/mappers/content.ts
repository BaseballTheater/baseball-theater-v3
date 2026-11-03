/**
 * Pure upstream → BT mapper for game content.
 *
 * Highlights come from the content endpoint (`/api/v1/game/{gamePk}/content`),
 * which is the only payload carrying playback URLs; the live feed hydrate does
 * not include them.
 */
import type {
	GameRecap, HighlightKind, MediaHighlight,
} from "@bt/domain";
import type { ContentHighlightItem, GameContentResponse } from "@bt/mlb-api";
import { isGameRecapHighlight } from "@bt/domain";

/** Prefers the highest-fidelity MP4, falling back to the HLS cloud stream. */
export function pickPlaybackUrl(item: ContentHighlightItem): string | null
{
	const mp4 = item.playbacks.find((playback) => playback.name.startsWith("mp4Avc"));
	const hls = item.playbacks.find((playback) => playback.name === "hlsCloud");
	return mp4?.url ?? hls?.url ?? item.playbacks[0]?.url ?? item.mediaPlaybackUrl ?? null;
}

function pickImageUrl(item: ContentHighlightItem): string | null
{
	const cut = item.image?.cuts?.find((entry) => entry.src);
	return cut?.src ?? item.image?.templateUrl ?? null;
}

/** Keyword types whose values are MLB's content taxonomy (S69 `tags`). */
const TAG_TYPES = new Set(["taxonomy", "mlbtax"]);

/**
 * A video's kind from its keywords (S69): the recap is `isGameRecapHighlight`'s, the one
 * recap rule (S75; ADR-025), asked of every keyword value; MLB's own `mlbtax` marks the
 * condensed game; a `highlight` / `in-game-highlight` tag marks a play highlight; the rest
 * (interviews, lineups, analysis) are plain videos.
 */
function highlightKind(tags: readonly string[], keywords: readonly string[]): HighlightKind
{
	if (isGameRecapHighlight({
		tags: keywords,
	})) return "recap";
	if (tags.includes("condensed_game")) return "condensed";
	if (tags.includes("highlight") || tags.includes("in-game-highlight")) return "highlight";
	return "video";
}

export function mapHighlightItem(item: ContentHighlightItem): MediaHighlight
{
	const keywords = item.keywordsAll ?? [];
	const tags = [...new Set(keywords.filter((k) => TAG_TYPES.has(k.type ?? "")).map((k) => k.value ?? ""))].filter(Boolean);
	const teamIds = [...new Set(keywords.filter((k) => k.type === "team_id").map((k) => Number(k.value)))].filter(Number.isInteger);
	return {
		id: item.id ?? item.slug ?? item.title,
		// MLB's own link to the pitch the clip shows (S95); `videoPlayLinks` checks it names one.
		playId: item.guid ?? null,
		title: item.title,
		blurb: item.blurb || item.description || null,
		duration: item.duration ?? null,
		imageUrl: pickImageUrl(item),
		playbackUrl: pickPlaybackUrl(item),
		kind: highlightKind(tags, keywords.map((k) => k.value ?? "")),
		date: item.date ?? null,
		teamIds,
		tags,
	};
}

export function mapContentHighlights(content: GameContentResponse): MediaHighlight[]
{
	const items = content.highlights?.highlights?.items ?? [];
	return items.map(mapHighlightItem);
}

const ENTITIES: Readonly<Record<string, string>> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": "\"",
	"&#39;": "'",
	"&nbsp;": " ",
};

/**
 * An MLB article body as plain paragraphs (S10). The body is HTML `<p>` blocks
 * holding Markdown-ish text (`**bold**` subheads, `1\.` escapes, blank-line breaks),
 * with player tags, links and embedded story players (`<iframe>`). Players are
 * dropped; every tag is stripped to its text; paragraphs split on `</p>` and blank
 * lines. BT never renders MLB's HTML.
 */
export function articleParagraphs(body: string): string[]
{
	return body
		.replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
		.split(/<\/p>|\n\s*\n/)
		.map((block) => block
			.replace(/<[^>]+>/g, "")
			.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
			.replace(/\*\*/g, "")
			.replace(/\\([^\w\s])/g, "$1")
			.replace(/\s+/g, " ")
			.trim()
			.replace(/^[*-] /, ""))
		.filter((paragraph) => paragraph.length > 0);
}

/**
 * MLB's editorial recap for the Recap room (S10): its headline and the article as
 * plain paragraphs separated by blank lines, falling back to the blurb when there is
 * no body. `undefined` when MLB has published no recap (the room isn't offered).
 */
export function mapRecap(content: GameContentResponse): GameRecap | undefined
{
	const article = content.editorial?.recap?.mlb;
	const paragraphs = article?.body ? articleParagraphs(article.body) : [article?.blurb ?? ""].filter(Boolean);
	if (!article?.headline || paragraphs.length === 0) return undefined;
	return {
		headline: article.headline,
		text: paragraphs.join("\n\n"),
	};
}
