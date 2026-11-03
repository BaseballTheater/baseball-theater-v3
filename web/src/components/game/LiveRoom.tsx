import type { AtBat } from "@bt/domain";
import {
	Box, Group, Paper, Stack, Text,
} from "@mantine/core";
import { useState } from "react";
import type { GamePayload } from "../../api/game.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { MatchupCards } from "../pitch/MatchupCards.js";
import { PitchSequence } from "../pitch/PitchSequence.js";
import { PitchTheater } from "../pitch/PitchTheater.js";
import { useScoresHidden } from "../../settings/useScoresHidden.js";
import { LiveStatus } from "./LiveStatus.js";

/** The pitcher's and batter's surnames: "Gusto vs Bregman". */
function matchupTitle(atBat: AtBat): string
{
	const last = (name: string) => name.slice(name.lastIndexOf(" ") + 1);
	return `${last(atBat.matchup.pitcher.fullName)} vs ${last(atBat.matchup.batter.fullName)}`;
}

/**
 * The Live room (S3 status, S64 pitch theater; game-rooms `live-mobile` / `-medium` /
 * `-desktop`): the status with the base diamond, the pitcher and batter cards, the catcher's
 * view of each pitch's flight, and the pitch sequence of the at-bat in progress — the last play.
 * One pitch is selected at a time, newest by default; a zone dot and a sequence row
 * select the same one. Mobile stacks it all under the status row; medium / desktop put
 * the cards and zone on the left with the status card beside them and the sequence
 * below. No win-probability chart at launch (owner, 2026-10-19). A game with no plays
 * yet shows the status alone. With Hide Scores on the status masks the score and an
 * in-play pitch reads "IN PLAY"; the result line and the batter's line stay (S75).
 */
export function LiveRoom({ game, variant }: { game: GamePayload;
	variant: LayoutVariant; })
{
	const scoresHidden = useScoresHidden(game);
	const atBat = game.plays.at(-1);
	const newest = atBat?.pitches.at(-1)?.pitchNumber ?? null;
	const [picked, setPicked] = useState<{ atBat: number;
		pitch: number } | null>(null);
	// A new pitch arriving live jumps to it and replays it in the zone (owner, 2026-10-29:
	// "when a new pitch is added during real time data it should animate"); the pitch
	// already there when the room opens doesn't replay.
	const latest = atBat && newest !== null ? `${atBat.about.atBatIndex}:${newest}` : null;
	const [seenLatest, setSeenLatest] = useState(latest);
	const [arrivals, setArrivals] = useState(0);
	if (latest !== seenLatest)
	{
		setSeenLatest(latest);
		if (latest !== null)
		{
			setPicked(null);
			setArrivals(arrivals + 1);
		}
	}
	// A new at-bat starts back at its newest pitch.
	const selected = picked && picked.atBat === atBat?.about.atBatIndex ? picked.pitch : newest;
	const status = <LiveStatus game={game} variant={variant} />;
	if (!atBat) return status;

	const select = (pitch: number) => setPicked({
		atBat: atBat.about.atBatIndex,
		pitch,
	});
	const cards = <MatchupCards plays={game.plays} atBat={atBat} />;
	const sequence = (
		<PitchSequence pitches={atBat.pitches} selectedPitchNumber={selected} onSelectPitch={select} variant={variant} scoresHidden={scoresHidden} />
	);

	if (variant === "mobile")
	{
		return (
			<Stack gap={16}>
				{status}
				<Box data-testid="matchup-line">
					<Text fz={15} fw={700}>{matchupTitle(atBat)}</Text>
					{atBat.result.description ? <Text fz={13}>Result: {atBat.result.description}</Text> : null}
				</Box>
				{cards}
				<PitchTheater atBat={atBat} selected={selected} onSelectPitch={select} arrivals={arrivals} scoresHidden={scoresHidden} />
				<Text fz={12} fw={700} tt="uppercase">Pitch sequence</Text>
				{sequence}
			</Stack>
		);
	}

	return (
		<Stack gap={16}>
			<Group align="flex-start" gap={16} wrap="nowrap" data-testid="live-top">
				<Stack gap={16} style={{
					flex: 1,
					minWidth: 0,
				}}
				>
					{cards}
					<Paper radius="md" p={12} style={{
						border: "1px solid var(--bt-light)",
					}}
					>
						<PitchTheater atBat={atBat} selected={selected} onSelectPitch={select} arrivals={arrivals} scoresHidden={scoresHidden} />
					</Paper>
				</Stack>
				{status}
			</Group>
			{sequence}
		</Stack>
	);
}
