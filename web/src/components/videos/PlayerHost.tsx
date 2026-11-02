import { useSettings } from "../../settings/store.js";
import { LazyPlayerDialog } from "./LazyPlayerDialog.js";
import type { PlayerGame } from "./PlayerDialog.js";
import { PlayerStage } from "./PlayerStage.js";
import type { Video } from "./VideoCard.js";

/**
 * Puts the player where the reader's Video Player setting says (S70): `PlayerDialog`
 * over the page (the default, and what signed-out readers get, since their settings are
 * the house defaults) or `PlayerStage` where the host is rendered. It reads the setting
 * from the store, so changing it in Settings moves the player without a reload.
 *
 * `video` is the clip the reader chose, or null; the stage falls back to `first` so it is
 * never empty, while the dialog only opens on a choice.
 */
export function PlayerHost({
	video, first, onClose, game, fromGamePk,
}: { video: Video | null;
	first: Video | undefined;
	onClose: () => void;
	game?: PlayerGame;
	fromGamePk?: number; })
{
	const { videoPlayer } = useSettings();
	if (videoPlayer === "stage")
	{
		const shown = video ?? first;
		return shown ? <PlayerStage video={shown} autoPlay={video !== null} /> : null;
	}
	return video ? <LazyPlayerDialog video={video} onClose={onClose} game={game} fromGamePk={fromGamePk} /> : null;
}
