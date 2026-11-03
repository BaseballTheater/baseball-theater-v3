/**
 * MLB's GraphQL game content (`data-graph.mlb.com/graphql`, persisted query
 * `getGamesByGamePks`; S94): the game's videos as mlb.com's own pages get them — with
 * `playIdRef`, the pitch each clip shows, which the Stats API content feed gives only through
 * `guid` and not at all for ABS challenge clips — plus the game recap article and related
 * articles. It is an internal mlb.com source answering a persisted-query hash MLB can retire,
 * so BT treats it as optional and only adds its fields to the content feed's videos.
 *
 * Split by purpose: the tags MLB puts on any item, a video, an article, and the response's
 * game envelope. MLB sends `null` for an empty text field, so those are `| null`.
 */

/** A tag on a video or article: a taxonomy or article tag (`slug`, `title`), a game (`gamePk`) or a team (`team.id`). */
export interface GraphContentTag {
	slug?: string;
	type?: string;
	title?: string;
	gamePk?: number;
	team?: { id?: number;
		__typename?: string; };
	__typename?: string;
}

/** One way to play a video (`hlsCloud`, `mp4Avc`, …). */
export interface GraphContentPlayback {
	name?: string;
	url?: string;
	__typename?: string;
}

/** One video. `id` and `slug` are the content feed's own ids for it; `playIdRef` is the pitch's `playId`, or null. */
export interface GraphContentVideo {
	id: string;
	slug?: string;
	title?: string;
	headline?: string;
	blurb?: string;
	description?: string | null;
	accessibilityText?: string | null;
	duration?: string;
	guid?: string | null;
	playIdRef?: string | null;
	date?: string;
	contentDate?: string;
	preferredPlaybackScenarioURL?: string;
	playbacks?: GraphContentPlayback[];
	thumbnail?: { templateUrl?: string;
		__typename?: string; };
	tags?: GraphContentTag[];
	__typename?: string;
}

/** An mlb.com article: the recap or a related story. MLB gives its slug, not a URL. */
export interface GraphContentArticle {
	slug: string;
	headline?: string;
	blurb?: string;
	description?: string | null;
	contentDate?: string;
	templateUrl?: string;
	type?: string;
	tags?: GraphContentTag[];
	__typename?: string;
}

/** One game's content. */
export interface GraphContentGame {
	gamePk: number;
	gameDate?: string;
	content?: {
		videoContent?: GraphContentVideo[];
		recapArticle?: GraphContentArticle[];
		relatedArticles?: GraphContentArticle[];
		__typename?: string;
	} | null;
	__typename?: string;
}

/** `getGamesByGamePks`'s response: one entry per game asked for. */
export interface GraphContentResponse {
	data?: {
		getGamesByGamePks?: GraphContentGame[];
	};
}
