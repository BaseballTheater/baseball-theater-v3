import type { AtBat } from "@bt/domain";
import { atBatInningLabel, atBatOfPlay } from "@bt/domain";
import type { Video } from "./VideoCard.js";

/** Where a video's play link goes and what it says (game-shell A5). */
export type PlayLink = {
	label: string;
	to: string;
};

/**
 * A video's link to its play (S97; game-shell A5): `Play · Top 6th →`, opening the game's Plays
 * room on that play (`?play=<playId>`, game-rooms A6). Null for a video with no play, or one
 * whose pitch isn't in the game's plays. The one place the card and the player get it.
 */
export function videoPlayLink(video: Pick<Video, "playId">, game: { gamePk: number;
	plays: readonly AtBat[]; }): PlayLink | null
{
	const atBat = atBatOfPlay(game.plays, video.playId);
	if (!atBat || !video.playId) return null;
	return {
		label: `Play · ${atBatInningLabel(atBat)} →`,
		to: `/game/${game.gamePk}/plays?play=${encodeURIComponent(video.playId)}`,
	};
}
