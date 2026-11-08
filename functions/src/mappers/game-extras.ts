/**
 * The one place a fetched game gets its optional MLB extras (S95; ADR-025): both MLB adapters
 * (HTTP and fixture) hand their game here with what they fetched beside it. It links each video
 * to its play (`videoPlayLinks`), ranks the videos by how much their play swung the game
 * (`rankHighlightsByImpact` with the play metrics, S98), and attaches S93's
 * play metrics and S94's video play refs and related articles, each only when there is one — so a
 * source that failed leaves its field off and the game is served as before.
 */
import type {
	AtBat, GameGraphContent, GamePlayMetrics, GameSnapshot, MediaHighlight, Unversioned,
} from "@bt/domain";
import { rankHighlightsByImpact, videoPlayLinks } from "@bt/domain";
import type { GameEditorial } from "@bt/ports";

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

/**
 * A whole game from its parts (S122): the live feed, the content endpoint's videos and recap,
 * and the two extras, each null when it failed or wasn't asked. `fetchGame` (both adapters)
 * and the backfill, which asks each source on its own, build a game here, so a game reads the
 * same whichever path stored it.
 */
export function assembleGame(
	feed: Unversioned<GameSnapshot>,
	editorial: GameEditorial | null,
	playMetrics: GamePlayMetrics | null,
	graph: GameGraphContent | null,
): Unversioned<GameSnapshot>
{
	return withGameExtras({
		...feed,
		highlights: editorial?.highlights ?? [],
		recap: editorial?.recap,
	}, playMetrics, graph);
}
