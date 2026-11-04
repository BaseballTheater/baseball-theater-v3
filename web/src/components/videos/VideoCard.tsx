import {
	Anchor, Box, Group, Image, Stack, Text, UnstyledButton,
} from "@mantine/core";
import { Link } from "react-router-dom";
import type { HighlightKind } from "@bt/domain";
import { clipDuration, highlightTitle } from "@bt/domain";
import type { GamePayload } from "../../api/game.js";
import { formatDate } from "../../format/datetime.js";
import type { PlayLink } from "./playLink.js";

export type Video = GamePayload["highlights"][number];

/** The meta line's first word (`Highlight · Sep 5, 2026`). */
const KIND_LABELS: Readonly<Record<HighlightKind, string>> = {
	highlight: "Highlight",
	recap: "Recap",
	condensed: "Condensed game",
	video: "Video",
};

/** Light on Dark at 50% behind the duration (owner, 2026-10-14: "Light on Dark 50%"). */
const OVERLAY = "rgb(16 16 15 / 50%)";

/**
 * A clip's 16:9 still (6px radius) with the duration at the bottom right. No play mark on any
 * thumbnail (game-shell A5; owner, 2026-11-04: "No thumbnails should have a play icon").
 * `bare` drops the duration too, for a row that writes it beside the still instead (the day
 * digest, S71).
 */
export function VideoStill({
	video, width, bare = false,
}: { video: Video;
	width: number | "100%";
	bare?: boolean; })
{
	const duration = bare ? null : clipDuration(video.duration);
	return (
		<Box pos="relative" w={width} style={{
			flexShrink: 0,
			aspectRatio: "16 / 9",
			borderRadius: 6,
			overflow: "hidden",
			background: "var(--bt-raised)",
		}}
		>
			{video.imageUrl ? <Image src={video.imageUrl} alt="" h="100%" w="100%" fit="cover" loading="lazy" /> : null}
			{duration ? (
				<Text
					pos="absolute"
					bottom={6}
					right={6}
					px={5}
					fz={11}
					fw={700}
					data-testid="video-duration"
					style={{
						borderRadius: 4,
						background: OVERLAY,
						color: "var(--bt-light)",
					}}
				>
					{duration}
				</Text>
			) : null}
		</Box>
	);
}

/**
 * One video (S69; game-shell Videos frames): the still with its duration, the title and
 * a `Highlight · Sep 5, 2026` meta line. One component for both modes — a grid cell
 * (still above the text) and a list row (a small still beside it). The whole card is
 * the button: choosing it calls `onPlay` with the video; the player is S70's. A video with a
 * play gets `playLink` (S97; game-shell A5): `Play · Top 6th →` on its own line under the
 * meta line, a sibling of the button (a link inside it would also start the clip). Its title is
 * `highlightTitle`'s: the game page passes `scoresHidden`, so there the recap clip reads
 * "Recap (score hidden)" (S75); Search and the digest pass none and keep MLB's title.
 */
export function VideoCard({
	video, layout, onPlay, scoresHidden = false, playLink,
}: { video: Video;
	layout: "grid" | "list";
	onPlay: (video: Video) => void;
	scoresHidden?: boolean;
	playLink?: PlayLink | null; })
{
	const title = highlightTitle(video, scoresHidden);
	const meta = [video.kind ? KIND_LABELS[video.kind] : null, video.date ? formatDate(video.date) : null].filter(Boolean).join(" · ");
	const text = (
		<Stack gap={2} style={{
			minWidth: 0,
		}}
		>
			<Text fw={700} lh={1.3} lineClamp={2}>{title}</Text>
			{meta ? <Text size="sm" c="var(--bt-muted)">{meta}</Text> : null}
		</Stack>
	);
	const button = (
		<UnstyledButton
			data-testid="video-card"
			data-layout={layout}
			aria-label={`Play ${title}`}
			onClick={() => onPlay(video)}
			style={{
				display: "block",
				width: "100%",
				color: "inherit",
				// A button centers its content; pin it to the top so a one-line title's still lines up with its row.
				alignSelf: "start",
			}}
		>
			{layout === "grid" ? (
				<Stack gap={8}>
					<VideoStill video={video} width="100%" />
					{text}
				</Stack>
			) : (
				<Group gap={12} wrap="nowrap" align="center">
					<VideoStill video={video} width={112} />
					{text}
				</Group>
			)}
		</UnstyledButton>
	);
	if (!playLink) return button;
	return (
		<Stack gap={2} style={{
			alignSelf: "start",
			minWidth: 0,
		}}
		>
			{button}
			<Anchor component={Link} to={playLink.to} fz={layout === "grid" ? 13 : 12} c="var(--bt-primary-light)" data-testid="play-link" pl={layout === "list" ? 124 : 0}>
				{playLink.label}
			</Anchor>
		</Stack>
	);
}
