import {
	Anchor, Box, Group, Modal, UnstyledButton,
} from "@mantine/core";
import { Link } from "react-router-dom";
import { highlightTitle } from "@bt/domain";
import type { Video } from "./VideoCard.js";
import type { PlayLink } from "./playLink.js";
import { VideoPlayer } from "./VideoPlayer.js";

/** The game a clip belongs to, as the dialog's link names it (`NYY @ BOS, Sep 21`). */
export type PlayerGame = {
	gamePk: number;
	label: string;
};

/**
 * The only modal player (S70; game-shell A4, standings-search-settings A6): the
 * `VideoPlayer` floating, with no card, over the fully dimmed page. "Close ✕" sits in the
 * overlay at top right (owner, 2026-10-31: "a floating video with a “Close” button in the
 * dimmed overlay, no borders, so there’s more real estate to show a playlist in the
 * future"); Esc and a press on the empty overlay close it too. The Videos room, Search
 * (S5) and the day digest (S71) all open this one.
 *
 * At top left it links to the clip's game whenever the clip carries one and isn't being
 * played from that game's own page (owner, 2026-10-21: "All videos which have enough
 * context to associate them to a game should show a link to the game unless they are
 * already being played from the game"): the caller passes `game` when it knows it and
 * `fromGamePk` when it is that game's page; there the slot shows the clip's play link instead
 * (S97; game-shell A5), when it has one.
 *
 * With scores hidden the recap clip is titled "Recap (score hidden)" (`highlightTitle`,
 * S75); only the game page passes `scoresHidden`, so Search and the digest keep MLB's title.
 *
 * The content fills the screen so the Close row and the player share one focus trap; it
 * is transparent, so the overlay behind it is the dimmed page the frames draw.
 */
export function PlayerDialog({
	video, onClose, game, fromGamePk, scoresHidden = false, playLink,
}: { video: Video;
	onClose: () => void;
	game?: PlayerGame;
	fromGamePk?: number;
	scoresHidden?: boolean;
	/** The clip's play link (S97; game-shell A5): shown top left when no game link holds that slot. */
	playLink?: PlayLink | null; })
{
	const title = highlightTitle(video, scoresHidden);
	const link = game && game.gamePk !== fromGamePk ? game : null;
	return (
		<Modal
			opened
			onClose={onClose}
			fullScreen
			withCloseButton={false}
			aria-label={title}
			styles={{
				// The frames draw the page behind fully dimmed (Mantine's own overlay color can't take a CSS variable).
				overlay: {
					background: "var(--bt-dark)",
					opacity: 1,
				},
				content: {
					background: "transparent",
					boxShadow: "none",
				},
				body: {
					height: "100%",
					padding: 16,
					display: "flex",
					flexDirection: "column",
				},
			}}
		>
			<Group justify="space-between" wrap="nowrap" gap="md">
				{link ? (
					<Anchor component={Link} to={`/game/${link.gamePk}`} c="var(--bt-primary-light)" onClick={onClose}>
						Go to game: {link.label} →
					</Anchor>
				) : playLink ? (
					<Anchor component={Link} to={playLink.to} c="var(--bt-primary-light)" onClick={onClose} data-testid="player-play-link">
						{playLink.label}
					</Anchor>
				) : <span />}
				<UnstyledButton onClick={onClose} aria-label="Close video" c="var(--bt-light)" className="bt-hover" px={8} py={4} mx={-8} my={-4} style={{
					flexShrink: 0,
					borderRadius: 8,
				}}
				>
					Close ✕
				</UnstyledButton>
			</Group>
			<Box
				data-testid="player-backdrop"
				onClick={(event) =>
				{
					if (event.target === event.currentTarget) onClose();
				}}
				style={{
					flex: 1,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				{/* `.bt-player-frame` (styles.css): as wide as the screen allows, up to 1280px, while the clip,
				    its controls and the disclaimer still fit the screen's height (owner, 2026-11-12: "video
				    player on desktop needs to play videos larger, taking more of the screen"). */}
				<Box className="bt-player-frame">
					<VideoPlayer video={video} title={title} autoPlay />
				</Box>
			</Box>
		</Modal>
	);
}
