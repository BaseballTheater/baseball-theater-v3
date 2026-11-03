/**
 * The Recap room's heading (S75; game-rooms A3 `recap-hidden-mobile`). MLB's headline
 * usually tells the result ("Conforto clubs Cubs' 200th homer in close win"), so with Hide
 * Scores on the room is headed "Recap" and the article reads on below it unchanged — someone
 * who opens the recap wants the story (owner: "if they’re looking at game details they
 * clearly want the info"); the headline is what they'd see before choosing to read.
 */
import type { GameRecap } from "./types.js";

/** "Recap" with scores hidden, MLB's headline otherwise. */
export function recapHeading(recap: Pick<GameRecap, "headline">, scoresHidden: boolean): string
{
	return scoresHidden ? "Recap" : recap.headline;
}
