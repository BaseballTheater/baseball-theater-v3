import type { AtBat } from "@bt/domain";
import { Stack } from "@mantine/core";
import { useState } from "react";
import { MatchupCards } from "./MatchupCards.js";
import { PitchSequence } from "./PitchSequence.js";
import { PitchTheater } from "./PitchTheater.js";

type Props = {
	/** The game's at-bats, so the cards total each player through this one. */
	plays: readonly AtBat[];
	atBat: AtBat;
	/** Changes each time the at-bat is opened and scrolled into place: replay every pitch then. */
	autoplay?: number;
	/** Hide Scores for this game, for the pitch calls (S75). */
	scoresHidden?: boolean;
};

/**
 * An open at-bat in Plays (S41): the same modules as Live, in Live's order — the
 * pitcher and batter cards totalled through this at-bat (S64's `MatchupCards`), the
 * catcher's view (`PitchTheater`), and the pitch sequence newest-first with the
 * selected pitch open (`PitchSequence`). Kept at mobile width at every pairing
 * (game-rooms DESIGN: "the at-bat contents keep their mobile width").
 */
export function AtBatViewer({
	plays, atBat, autoplay = 0, scoresHidden = false,
}: Props)
{
	const newest = atBat.pitches.at(-1)?.pitchNumber ?? null;
	const [picked, setPicked] = useState<number | null>(null);
	const selected = picked ?? newest;
	// Opening the at-bat replays every pitch in the zone, overlapping (owner, 2026-10-29:
	// "Opening an at bat should animate each pitch in quick succession, starting after the
	// top of screen animation is completed"; "should overlap a bit"). The last pitch is
	// selected straight away, so the side and top charts show it, not the replay ("those
	// should always show the selected / last pitch irrespective of the initial animation").
	const [replaying, setReplaying] = useState(false);
	const [seenAutoplay, setSeenAutoplay] = useState(autoplay);
	if (autoplay !== seenAutoplay)
	{
		setSeenAutoplay(autoplay);
		const last = atBat.pitches.filter((p) => p.pitchData).at(-1);
		if (last)
		{
			setPicked(last.pitchNumber);
			setReplaying(true);
		}
	}
	// Choosing a pitch by hand stops a replay in progress.
	const choose = (pitchNumber: number) =>
	{
		setReplaying(false);
		setPicked(pitchNumber);
	};

	return (
		<Stack gap={16} maw={420}>
			<MatchupCards plays={plays} atBat={atBat} />
			<PitchTheater
				atBat={atBat}
				selected={selected}
				onSelectPitch={choose}
				replayingAll={replaying}
				onReplayAllEnd={() => setReplaying(false)}
				scoresHidden={scoresHidden}
			/>
			<PitchSequence pitches={atBat.pitches} selectedPitchNumber={selected} onSelectPitch={choose} variant="mobile" scoresHidden={scoresHidden} />
		</Stack>
	);
}
