/**
 * The Videos room's search and quick filters (S69; game-shell Videos frames). The
 * first facets are **Featured team** and **Stat / viz** (owner, 2026-10-13); both read
 * the keywords MLB tags each video with (`MediaHighlight.teamIds` / `tags`). Filtering
 * never reorders: the list arrives impact-ranked (`rankHighlightsByImpact`) and stays so.
 */
import type { MediaHighlight } from "./types.js";

/** Taxonomy tags that mark a stat or data-visualization clip (VISUAL-DESIGN §Videos "Stat-focused / viz"). */
const STAT_VIZ_TAGS = new Set(["data-visualization", "in-game-data-visualization", "player-tracking"]);

export type HighlightClass = {
	/** The teams the clip features; empty when MLB tagged none. */
	teamIds: readonly number[];
	/** A stat-focused or visualization clip: a viz tag or one of MLB's `darkroom-*` graphics. */
	statViz: boolean;
};

/** Which quick-filter facets a clip belongs to. Older recordings without keywords belong to none. */
export function classifyHighlight(highlight: Pick<MediaHighlight, "teamIds" | "tags">): HighlightClass
{
	const tags = highlight.tags ?? [];
	return {
		teamIds: highlight.teamIds ?? [],
		statViz: tags.some((tag) => STAT_VIZ_TAGS.has(tag) || tag.startsWith("darkroom-")),
	};
}

export type HighlightFilter = {
	/** Search text, matched case-insensitively against the title and blurb; blank matches all. */
	query?: string;
	/** Featured team: keep clips that feature this team id. */
	teamId?: number | null;
	/** Stat / viz: keep only stat and visualization clips. */
	statViz?: boolean;
};

/** The clips that match every part of `filter`, in the order given (impact order stays). */
export function filterHighlights(highlights: readonly MediaHighlight[], filter: HighlightFilter): MediaHighlight[]
{
	const query = filter.query?.trim().toLowerCase() ?? "";
	return highlights.filter((highlight) =>
	{
		if (query && !`${highlight.title}\n${highlight.blurb ?? ""}`.toLowerCase().includes(query)) return false;
		const facets = classifyHighlight(highlight);
		if (filter.teamId != null && !facets.teamIds.includes(filter.teamId)) return false;
		if (filter.statViz && !facets.statViz) return false;
		return true;
	});
}

/**
 * MLB's `HH:MM:SS` duration as the video badge prints it (game-shell frames): `0:29`,
 * `3:06`, `12:12`, and `1:02:05` past an hour. `null` for anything not a duration.
 */
export function clipDuration(duration: string | null | undefined): string | null
{
	const match = /^(\d+):(\d{2}):(\d{2})$/.exec(duration ?? "");
	if (!match) return null;
	const [, h, m, s] = match.map(Number) as [number, number, number, number];
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
