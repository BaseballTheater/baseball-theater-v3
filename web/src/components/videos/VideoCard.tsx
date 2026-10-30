import {
	Box, Group, Image, Stack, Text, UnstyledButton,
} from "@mantine/core";
import { IconPlayerPlay } from "@tabler/icons-react";
import type { HighlightKind } from "@bt/domain";
import { clipDuration } from "@bt/domain";
import type { GamePayload } from "../../api/game.js";
import { formatDate } from "../../format/datetime.js";

export type Video = GamePayload["highlights"][number];

/** The meta line's first word (`Highlight · Sep 5, 2026`). */
const KIND_LABELS: Readonly<Record<HighlightKind, string>> = {
	highlight: "Highlight",
	recap: "Recap",
	condensed: "Condensed game",
	video: "Video",
};

/** Light on Dark at 50% over the still (owner, 2026-10-14: "Light on Dark 50%"). */
const OVERLAY = "rgb(16 16 15 / 50%)";

/** The 16:9 still with the play mark centered and the duration at the bottom right. */
function Still({ video, width }: { video: Video;
	width: number | "100%"; })
{
	const duration = clipDuration(video.duration);
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
			<Box
				pos="absolute"
				top="50%"
				left="50%"
				w={width === "100%" ? 40 : 32}
				h={width === "100%" ? 40 : 32}
				aria-hidden
				style={{
					transform: "translate(-50%, -50%)",
					borderRadius: "50%",
					background: OVERLAY,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					color: "var(--bt-light)",
				}}
			>
				<IconPlayerPlay size={width === "100%" ? 20 : 16} />
			</Box>
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
 * the button: choosing it calls `onPlay` with the video; the player is S70's.
 */
export function VideoCard({
	video, layout, onPlay,
}: { video: Video;
	layout: "grid" | "list";
	onPlay: (video: Video) => void; })
{
	const meta = [video.kind ? KIND_LABELS[video.kind] : null, video.date ? formatDate(video.date) : null].filter(Boolean).join(" · ");
	const text = (
		<Stack gap={2} style={{
			minWidth: 0,
		}}
		>
			<Text fw={700} lh={1.3} lineClamp={2}>{video.title}</Text>
			{meta ? <Text size="sm" c="var(--bt-muted)">{meta}</Text> : null}
		</Stack>
	);
	return (
		<UnstyledButton
			data-testid="video-card"
			data-layout={layout}
			aria-label={`Play ${video.title}`}
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
					<Still video={video} width="100%" />
					{text}
				</Stack>
			) : (
				<Group gap={12} wrap="nowrap" align="center">
					<Still video={video} width={112} />
					{text}
				</Group>
			)}
		</UnstyledButton>
	);
}
