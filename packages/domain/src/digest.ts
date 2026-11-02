import { rankHighlightsByImpact } from "./impact.js";
import type { GameSnapshot, MediaHighlight } from "./types.js";

/** What the digest needs from each of the day's games: its id, day, teams and videos. */
export type DigestGame = Pick<GameSnapshot, "gamePk" | "officialDate" | "teams" | "highlights">;

/** The game a digest clip comes from, enough for the player's "Go to game: NYY @ BOS, Sep 21" link. */
export type DigestClipGame = {
	gamePk: number;
	officialDate: string;
	away: string;
	home: string;
};

/** One clip in the day digest: its place, whether to watch it first, the clip and its game. */
export type DigestItem = {
	/** 1 for the top clip. */
	rank: number;
	/** Only the top clip (the frames' `WATCH FIRST`). */
	watchFirst: boolean;
	highlight: MediaHighlight;
	game: DigestClipGame;
};

/**
 * How many clips the digest shows. The ratified frames draw two items on a three-game day
 * and no decision states a count; five is the agent's choice (S71), to be confirmed by the
 * owner's design match.
 */
export const DIGEST_SIZE = 5;

/**
 * "Best of <date>" (S71): the day's highlights across every game, ranked by the existing
 * per-game impact rule applied across the day (owner, 2026-10-19), `rankHighlightsByImpact`,
 * so the scoreboard and a game's Videos room agree on what matters. The top `limit` are
 * kept, numbered from 1, and the first is the one to watch first. A clip that appears in
 * two games' lists (same id) is kept once, with the first game that lists it.
 */
export function dayDigest(games: readonly DigestGame[], limit = DIGEST_SIZE): DigestItem[]
{
	const gameOf = new Map<string, DigestClipGame>();
	const clips: MediaHighlight[] = [];
	for (const game of games)
	{
		for (const highlight of game.highlights)
		{
			if (gameOf.has(highlight.id)) continue;
			gameOf.set(highlight.id, {
				gamePk: game.gamePk,
				officialDate: game.officialDate,
				away: game.teams.away.abbreviation,
				home: game.teams.home.abbreviation,
			});
			clips.push(highlight);
		}
	}
	return rankHighlightsByImpact(clips).slice(0, limit).map((highlight, index) => ({
		rank: index + 1,
		watchFirst: index === 0,
		highlight,
		game: gameOf.get(highlight.id)!,
	}));
}
