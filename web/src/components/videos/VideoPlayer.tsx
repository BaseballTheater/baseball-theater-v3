import {
	Box, Group, Stack, Text, UnstyledButton,
} from "@mantine/core";
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-react";
import { clipClock } from "@bt/domain";
import {
	useEffect, useRef, useState,
} from "react";
import type { Video } from "./VideoCard.js";

/**
 * VISUAL-DESIGN §6: under the player, always, verbatim. It lives here and nowhere else, so
 * the dialog and the stage can't drift apart (game-shell DESIGN, S36's choice).
 */
const DISCLAIMER = "This video is provided by MLBAM and MLB.com and has no affiliation with or connection to Baseball Theater. It has been displayed on your device via a public API provided by Major League Baseball.";

/** True when a key press belongs to whatever has focus (typing, a button), not to the player. */
function ownsSpace(target: HTMLElement): boolean
{
	return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(target.tagName) || target.getAttribute("role") === "button";
}

/** Plays a paused clip and pauses a playing one; a refused play (no source, autoplay rules) is ignored. */
function toggleVideo(element: HTMLVideoElement | null): void
{
	if (!element) return;
	if (element.paused) void element.play().catch(() => undefined);
	else element.pause();
}

/**
 * The one video player (S70; game-shell `video-player` frames): the clip, a Primary play /
 * pause control, the progress bar and `elapsed / total` (`clipClock`), the title, and the
 * MLBAM disclaimer. `PlayerDialog` and `PlayerStage` host it; neither repeats any of it.
 * Space plays and pauses (VISUAL-DESIGN §6) unless focus is on something Space already
 * means something to, such as the search box or a button. `autoPlay` starts the clip when
 * the reader chose it; the stage's first clip waits for a press.
 */
export function VideoPlayer({
	video, title = video.title, autoPlay = false,
}: { video: Video;
	/** The title under the clip; the game page passes `highlightTitle`'s (S75). */
	title?: string;
	autoPlay?: boolean; })
{
	const ref = useRef<HTMLVideoElement>(null);
	const [playing, setPlaying] = useState(false);
	const [elapsed, setElapsed] = useState(0);
	const [total, setTotal] = useState(0);

	const toggle = () => toggleVideo(ref.current);

	useEffect(() =>
	{
		function onKey(event: KeyboardEvent): void
		{
			if (event.code !== "Space" || ownsSpace(event.target as HTMLElement)) return;
			event.preventDefault();
			toggleVideo(ref.current);
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);

	const Icon = playing ? IconPlayerPauseFilled : IconPlayerPlayFilled;
	return (
		<Stack gap={10} data-testid="video-player">
			<Box
				component="video"
				ref={ref}
				src={video.playbackUrl ?? undefined}
				poster={video.imageUrl ?? undefined}
				autoPlay={autoPlay}
				// Without these iOS takes a playing clip fullscreen; the prefixed one is for
				// older iOS and in-app web views that still read it.
				playsInline
				webkit-playsinline="true"
				preload="metadata"
				onClick={toggle}
				onPlay={() => setPlaying(true)}
				onPause={() => setPlaying(false)}
				onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
				onLoadedMetadata={(event) => setTotal(event.currentTarget.duration)}
				style={{
					display: "block",
					width: "100%",
					aspectRatio: "16 / 9",
					objectFit: "cover",
					borderRadius: 8,
					background: "var(--bt-raised)",
				}}
			/>
			<Group gap={10} wrap="nowrap">
				<UnstyledButton onClick={toggle} aria-label={playing ? "Pause" : "Play"} c="var(--bt-primary-light)" style={{
					display: "flex",
				}}
				>
					<Icon size={14} />
				</UnstyledButton>
				<Box
					role="progressbar"
					aria-label="Progress"
					aria-valuemin={0}
					aria-valuemax={Math.round(total)}
					aria-valuenow={Math.round(elapsed)}
					style={{
						flex: 1,
						height: 4,
						borderRadius: 2,
						background: "rgb(255 242 211 / 15%)",
						overflow: "hidden",
					}}
				>
					<Box h="100%" w={total > 0 ? `${(elapsed / total) * 100}%` : 0} bg="var(--bt-primary-light)" />
				</Box>
				<Text size="xs" c="var(--bt-muted)" style={{
					flexShrink: 0,
				}}
				>
					{clipClock(elapsed)} / {clipClock(total)}
				</Text>
			</Group>
			<Text size="sm" fw={500}>{title}</Text>
			<Stack gap={2}>
				<Text fz={10} fw={700} tt="uppercase" c="var(--bt-muted)">Disclaimer:</Text>
				<Text fz={10} lh={1.4} c="var(--bt-muted)">{DISCLAIMER}</Text>
			</Stack>
		</Stack>
	);
}
