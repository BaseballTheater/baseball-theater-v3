import {
	Badge, Group, SimpleGrid, Stack, Text, UnstyledButton,
} from "@mantine/core";
import { useState } from "react";
import { clipDuration } from "@bt/domain";
import { useDayDigest } from "../../api/digest.js";
import type { DayDigestPayload } from "../../api/digest.js";
import { formatMonthDay } from "../../format/datetime.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { LazyPlayerDialog } from "../videos/LazyPlayerDialog.js";
import { VideoStill } from "../videos/VideoCard.js";

type DigestItem = DayDigestPayload["items"][number];

/** The player's game link for a digest clip: `NYY @ BOS, Sep 21` (S70's "Go to game: …"). */
function gameLabel(game: DigestItem["game"]): string
{
	return `${game.away} @ ${game.home}, ${formatMonthDay(game.officialDate)}`;
}

/** One ranked clip on the gold ground: rank, still, title, duration, and `WATCH FIRST` on the top one. */
function DigestRow({ item, onPlay }: { item: DigestItem;
	onPlay: (item: DigestItem) => void; })
{
	const { highlight } = item;
	const duration = clipDuration(highlight.duration);
	return (
		<UnstyledButton
			data-testid="digest-item"
			aria-label={`Play ${highlight.title}`}
			onClick={() => onPlay(item)}
			p={12}
			style={{
				display: "block",
				width: "100%",
				borderRadius: 8,
				background: "var(--bt-digest-gold)",
				color: "var(--bt-light)",
			}}
		>
			<Group gap={12} wrap="nowrap" align="center">
				<Text fw={700} c="var(--bt-accent)" w={16} ta="center" data-testid="digest-rank">{item.rank}</Text>
				<VideoStill video={highlight} width={80} bare />
				<Stack gap={4} style={{
					minWidth: 0,
				}}
				>
					<Text fw={500} lh={1.3} lineClamp={2}>{highlight.title}</Text>
					<Group gap={8} wrap="nowrap">
						{duration ? <Text size="sm" data-testid="digest-duration">{duration}</Text> : null}
						{item.watchFirst ? (
							<Badge radius={4} size="sm" fw={700} c="var(--bt-dark)" bg="var(--bt-accent)" data-testid="watch-first">
								Watch first
							</Badge>
						) : null}
					</Group>
				</Stack>
			</Group>
		</UnstyledButton>
	);
}

/**
 * "Best of <date> — Highlights" (S71; `digest-item` on every ratified scoreboard frame):
 * the day's top clips across its games, ranked by `dayDigest` on the server, each on the
 * dull gold ground with its rank, still, title and duration, and `WATCH FIRST` on the top
 * one. One column on mobile, two on medium and desktop, like the games above it.
 *
 * Choosing a clip plays it in S70's dialog, whatever the Video Player setting (there is no
 * stage on the scoreboard), with the link to its game (owner, 2026-10-21: "All videos which
 * have enough context to associate them to a game should show a link to the game unless
 * they are already being played from the game"). Hide Scores leaves the digest as it is,
 * titles as MLB writes them (shell-scoreboard A3: "there are probably too many ways to
 * detect this to make a reliable detector beyond the recap"). Nothing shows while it loads,
 * if it fails, or on a day with no videos: the games above are the page.
 */
export function DayDigest({ date, variant }: { date: string;
	variant: LayoutVariant; })
{
	const { data } = useDayDigest(date);
	const [playing, setPlaying] = useState<DigestItem | null>(null);
	if (!data || data.items.length === 0) return null;
	return (
		<Stack gap="sm" data-testid="day-digest">
			<Text size="xs" fw={700} tt="uppercase">
				Best of {formatMonthDay(data.date)} — Highlights
			</Text>
			<SimpleGrid cols={variant === "mobile" ? 1 : 2} spacing={8} verticalSpacing={8}>
				{data.items.map((item) => <DigestRow key={item.highlight.id} item={item} onPlay={setPlaying} />)}
			</SimpleGrid>
			{playing ? (
				<LazyPlayerDialog
					video={playing.highlight}
					onClose={() => setPlaying(null)}
					game={{
						gamePk: playing.game.gamePk,
						label: gameLabel(playing.game),
					}}
				/>
			) : null}
		</Stack>
	);
}
