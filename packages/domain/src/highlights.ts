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

/** The Videos room's sort choices: impact (the server's order, the default), then by publish time. */
export type HighlightSort = "impact" | "newest" | "oldest";

/**
 * The clips in `sort` order (owner, 2026-10-30: "Add a sort option to the left of the
 * grid/list option"). `impact` keeps the order given — the list arrives ranked by
 * `rankHighlightsByImpact` — and `newest` / `oldest` order by `date`, ties and undated
 * clips keeping their impact order (undated last).
 */
export function sortHighlights(highlights: readonly MediaHighlight[], sort: HighlightSort): MediaHighlight[]
{
	if (sort === "impact") return [...highlights];
	const sign = sort === "newest" ? -1 : 1;
	const time = (highlight: MediaHighlight) => (highlight.date ? Date.parse(highlight.date) : Number.NaN);
	return highlights.map((highlight, index) => ({
		highlight,
		index,
	})).sort((a, b) =>
	{
		const ta = time(a.highlight);
		const tb = time(b.highlight);
		if (Number.isNaN(ta) !== Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1;
		if (Number.isNaN(ta) || ta === tb) return a.index - b.index;
		return sign * (ta - tb);
	}).map(({ highlight }) => highlight);
}

/** The Videos room's groups, in the order they show (owner, 2026-10-30). */
export const HIGHLIGHT_GROUPS = ["pregame", "highlights", "statcast", "postgame"] as const;
export type HighlightGroup = (typeof HIGHLIGHT_GROUPS)[number];

/** Tags MLB puts on clips made after the final out: press conferences and postgame interviews. */
const POSTGAME_TAGS = new Set(["press-conference", "manager-postgame", "player-postgame", "postgame", "post-game"]);
/** Tags on the graphics and talk MLB publishes before first pitch: lineups, bullpen and bench, alignments. */
const PREGAME_TAGS = new Set(["darkroom-starting-lineup", "darkroom-bullpen", "darkroom-fielding-alignment", "manager-pregame", "pregame", "pre-game"]);

/**
 * Which group a clip falls in (owner, 2026-10-30: "The groups are: Pre-game, Game
 * highlights, Statcast, Post-Game"), from MLB's keywords, first match wins:
 * - `postgame`: the recap, the condensed game, press conferences and postgame interviews;
 * - `pregame`: lineups, bullpen / bench availability and fielding alignments — a
 *   data-visualization clip MLB did not tag `in-game-data-visualization` is made before
 *   the game, so it lands here too;
 * - `statcast`: the remaining stat / viz clips (`classifyHighlight`'s `statViz`: bat
 *   tracking, pitch breakdowns, home-run distance);
 * - `highlights`: everything else — play highlights, ABS challenges, in-game interviews.
 */
export function highlightGroup(highlight: Pick<MediaHighlight, "kind" | "tags" | "teamIds">): HighlightGroup
{
	const tags = highlight.tags ?? [];
	if (highlight.kind === "recap" || highlight.kind === "condensed" || tags.some((tag) => POSTGAME_TAGS.has(tag))) return "postgame";
	if (tags.some((tag) => PREGAME_TAGS.has(tag))) return "pregame";
	if (tags.includes("data-visualization") && !tags.includes("in-game-data-visualization")) return "pregame";
	if (classifyHighlight(highlight).statViz) return "statcast";
	return "highlights";
}

/**
 * The clips split into their groups, in `HIGHLIGHT_GROUPS` order, each keeping the
 * order given (the chosen sort). A group with no clips is left out: the groups reflect
 * what is there, not boxes to fill (owner, 2026-10-30: "More like groups than categories
 * (i.e. a reflection of what is there, not a set of boxes to put things in)").
 */
export function groupHighlights(highlights: readonly MediaHighlight[]): { group: HighlightGroup;
	highlights: MediaHighlight[]; }[]
{
	return HIGHLIGHT_GROUPS.map((group) => ({
		group,
		highlights: highlights.filter((highlight) => highlightGroup(highlight) === group),
	})).filter((entry) => entry.highlights.length > 0);
}

/**
 * Whole seconds as a clip clock: `0:12`, `3:06`, `1:02:05` past an hour. The video badge
 * (`clipDuration`) and the player's elapsed / total time (S70) both print through it, so
 * they read alike. Fractions are dropped (a playing video reports 12.7s as `0:12`);
 * anything not a finite, non-negative number reads `0:00`.
 */
export function clipClock(seconds: number): string
{
	const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
	const h = Math.floor(whole / 3600);
	const m = Math.floor(whole / 60) % 60;
	const s = whole % 60;
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
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
	return clipClock(h * 3600 + m * 60 + s);
}
