import { useSettings } from "../../settings/store.js";
import { LazyPlayerDialog } from "./LazyPlayerDialog.js";
import type { PlayerGame } from "./PlayerDialog.js";
import { PlayerStage } from "./PlayerStage.js";
import type { Video } from "./VideoCard.js";
import type { PlayLink } from "./playLink.js";

/**
 * Puts the player where the reader's Video Player setting says (S70): `PlayerDialog`
 * over the page (the default, and what signed-out readers get, since their settings are
 * the house defaults) or `PlayerStage` where the host is rendered. It reads the setting
 * from the store, so changing it in Settings moves the player without a reload.
 *
 * `video` is the clip the reader chose, or null; the stage falls back to `first` so it is
 * never empty, while the dialog only opens on a choice. `scoresHidden` (the game page's
 * `useScoresHidden`) goes to whichever one shows, for the recap clip's title (S75).
 */
export function PlayerHost({
	video, first, onClose, game, fromGamePk, scoresHidden, playLink,
}: { video: Video | null;
	first: Video | undefined;
	onClose: () => void;
	game?: PlayerGame;
	fromGamePk?: number;
	scoresHidden?: boolean;
	/** The playing clip's play link (S97), for the dialog's top-left slot. */
	playLink?: PlayLink | null; })
{
	const { videoPlayer } = useSettings();
	if (videoPlayer === "stage")
	{
		const shown = video ?? first;
		return shown ? <PlayerStage video={shown} autoPlay={video !== null} scoresHidden={scoresHidden} /> : null;
	}
	return video ? <LazyPlayerDialog video={video} onClose={onClose} game={game} fromGamePk={fromGamePk} scoresHidden={scoresHidden} playLink={playLink} /> : null;
}
