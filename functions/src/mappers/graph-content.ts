/**
 * Pure upstream → BT mapper for MLB's GraphQL game content (S94): each video's `playIdRef`
 * as a `VideoPlayRef` (keyed by the video's id, which is the content feed's id for the same
 * clip, so it joins `MediaHighlight.id`), and the related articles' headline, blurb and slug.
 * The content feed stays the source of videos; this only adds what it lacks. `null` when the
 * response has no content for `gamePk` or nothing to add, so the caller leaves both fields off.
 */
import type { GameGraphContent } from "@bt/domain";
import type { GraphContentResponse } from "@bt/mlb-api";

export function mapGraphContent(response: GraphContentResponse, gamePk: number): GameGraphContent | null
{
	const content = response.data?.getGamesByGamePks?.find((game) => game.gamePk === gamePk)?.content;
	const videoPlayRefs = (content?.videoContent ?? []).flatMap((video) => (video.playIdRef ? [{
		videoId: video.id,
		playId: video.playIdRef,
	}] : []));
	const relatedArticles = (content?.relatedArticles ?? []).flatMap((article) => (article.headline ? [{
		slug: article.slug,
		headline: article.headline,
		blurb: article.blurb || null,
	}] : []));
	if (videoPlayRefs.length === 0 && relatedArticles.length === 0) return null;
	return {
		videoPlayRefs,
		relatedArticles,
	};
}
