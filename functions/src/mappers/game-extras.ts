/**
 * The one place a fetched game gets its optional MLB extras (S95; ADR-025): both MLB adapters
 * (HTTP and fixture) hand their game here with what they fetched beside it. It links each video
 * to its play (`videoPlayLinks`), ranks the videos by how much their play swung the game
 * (`rankHighlightsByImpact` with the play metrics, S98), and attaches S93's
 * play metrics and S94's video play refs and related articles, each only when there is one — so a
 * source that failed leaves its field off and the game is served as before.
 */
import type {
	AtBat, GameGraphContent, GamePlayMetrics, MediaHighlight,
} from "@bt/domain";
import { rankHighlightsByImpact, videoPlayLinks } from "@bt/domain";

export function withGameExtras<T extends { plays: AtBat[];
	highlights: MediaHighlight[]; }>(game: T, playMetrics: GamePlayMetrics | null, graph: GameGraphContent | null): T
{
	const linked = videoPlayLinks(game.highlights, game.plays, graph?.videoPlayRefs, playMetrics ?? undefined);
	return {
		...game,
		// S98: ranked by the win probability each clip's play added, with the metrics in hand here.
		highlights: rankHighlightsByImpact(linked, {
			plays: game.plays,
			...playMetrics && {
				playMetrics,
			},
		}),
		...playMetrics && {
			playMetrics,
		},
		...graph?.videoPlayRefs.length && {
			videoPlayRefs: graph.videoPlayRefs,
		},
		...graph?.relatedArticles.length && {
			relatedArticles: graph.relatedArticles,
		},
	};
}
