import { Box } from "@mantine/core";
import type { Video } from "./VideoCard.js";
import { VideoPlayer } from "./VideoPlayer.js";

/**
 * The persistent player (S70; game-shell `video-player-stage-*`): the `VideoPlayer` fixed
 * at the top of the Videos room, above the list, for readers who choose Stage in
 * Settings → Game Detail → Video Player. It shows the chosen clip, playing, or until one
 * is chosen the room's first, waiting. Keyed by clip so a new choice starts fresh.
 */
export function PlayerStage({ video, autoPlay }: { video: Video;
	autoPlay: boolean; })
{
	return (
		<Box component="section" aria-label="Video player">
			<VideoPlayer key={video.id} video={video} autoPlay={autoPlay} />
		</Box>
	);
}
