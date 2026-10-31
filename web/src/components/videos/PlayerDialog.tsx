import { Anchor, Modal } from "@mantine/core";
import { Link } from "react-router-dom";
import type { Video } from "./VideoCard.js";
import { VideoPlayer } from "./VideoPlayer.js";

/** The game a clip belongs to, as the dialog's link names it (`NYY @ BOS, Sep 21`). */
export type PlayerGame = {
	gamePk: number;
	label: string;
};

/**
 * The only modal player (S70; game-shell `video-player-dialog-*`, search-playing A2): the
 * `VideoPlayer` in a dialog over the dimmed page, closed by ✕, Esc or the scrim. The
 * Videos room, Search (S5) and the day digest (S71) all open this one.
 *
 * At top left it links to the clip's game whenever the clip carries one and isn't being
 * played from that game's own page (owner, 2026-10-21: "All videos which have enough
 * context to associate them to a game should show a link to the game unless they are
 * already being played from the game"): the caller passes `game` when it knows it and
 * `fromGamePk` when it is that game's page.
 */
export function PlayerDialog({
	video, onClose, game, fromGamePk,
}: { video: Video;
	onClose: () => void;
	game?: PlayerGame;
	fromGamePk?: number; })
{
	const link = game && game.gamePk !== fromGamePk ? game : null;
	return (
		<Modal
			opened
			onClose={onClose}
			centered
			size={560}
			radius={12}
			closeButtonProps={{
				"aria-label": "Close video",
			}}
			title={link ? (
				<Anchor component={Link} to={`/game/${link.gamePk}`} c="var(--bt-primary-light)" onClick={onClose}>
					Go to game: {link.label} →
				</Anchor>
			) : null}
			styles={{
				// The frames draw the page behind fully dimmed (Mantine's own overlay color can't take a CSS variable).
				overlay: {
					background: "var(--bt-dark)",
					opacity: 0.95,
				},
				content: {
					background: "var(--bt-raised)",
					border: "1px solid rgb(255 242 211 / 15%)",
				},
				header: {
					background: "var(--bt-raised)",
				},
			}}
		>
			<VideoPlayer video={video} autoPlay />
		</Modal>
	);
}
