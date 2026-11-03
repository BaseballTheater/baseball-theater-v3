import type { AtBat } from "@bt/domain";
import {
	Anchor, Group, Stack,
} from "@mantine/core";
import { useState } from "react";
import type { TrajectoryChart } from "./PitchTrajectoryView.js";
import { PitchTrajectoryView } from "./PitchTrajectoryView.js";
import { StrikeZoneChart } from "./StrikeZoneChart.js";

/** The two optional flight charts and the link that toggles each. */
const CHART_LINKS: { chart: TrajectoryChart;
	label: string }[] = [
	{
		chart: "side",
		label: "Side view",
	},
	{
		chart: "top",
		label: "Top view",
	},
];

/**
 * The catcher's view of an at-bat, with quiet links under it: one replays the
 * selected pitch in the zone, two show or hide the side and top-down flight charts of
 * the selected pitch (which have their own Animate button) — hidden by default (owner,
 * 2026-10-29: "only show the catcher's view. For now, put some subtle links to the top
 * and side views that toggle them (hidden by default)"). One for Live (S64) and an
 * open at-bat in Plays (S41).
 */
export function PitchTheater({
	atBat, selected, onSelectPitch, arrivals = 0, replayingAll = false, onReplayAllEnd, scoresHidden = false,
}: { atBat: AtBat;
	selected: number | null;
	onSelectPitch: (pitchNumber: number) => void;
	/** Counts pitches that arrived while watching; each one replays in the zone. */
	arrivals?: number;
	/** Every pitch of the at-bat replaying in turn (an at-bat just opened in Plays). */
	replayingAll?: boolean;
	onReplayAllEnd?: () => void;
	/** Hide Scores for this game, for the zone's call labels (S75). */
	scoresHidden?: boolean; })
{
	const [charts, setCharts] = useState<TrajectoryChart[]>([]);
	// Replays the selected pitch in the zone, at the speed it looks from behind the plate.
	const [playing, setPlaying] = useState(false);
	const [seenArrivals, setSeenArrivals] = useState(arrivals);
	if (arrivals !== seenArrivals)
	{
		setSeenArrivals(arrivals);
		setPlaying(true);
	}
	const toggle = (chart: TrajectoryChart) => setCharts(charts.includes(chart) ? charts.filter((c) => c !== chart) : [...charts, chart]);
	return (
		<Stack gap={8} data-testid="live-zone">
			<StrikeZoneChart
				pitches={atBat.pitches}
				selectedPitchNumber={selected}
				onSelectPitch={onSelectPitch}
				batSide={atBat.matchup.batSide}
				pitchHand={atBat.matchup.pitchHand}
				playing={playing}
				onPlaybackEnd={() => setPlaying(false)}
				replayingAll={replayingAll}
				onReplayAllEnd={onReplayAllEnd}
				scoresHidden={scoresHidden}
			/>
			<Group gap={12} justify="center">
				<Anchor
					component="button"
					type="button"
					fz={12}
					c="var(--bt-muted)"
					disabled={selected === null}
					onClick={() =>
					{
						onReplayAllEnd?.();
						setPlaying(true);
					}}
				>
					Animate pitch
				</Anchor>
				{CHART_LINKS.map(({ chart, label }) => (
					<Anchor
						key={chart}
						component="button"
						type="button"
						fz={12}
						c="var(--bt-muted)"
						aria-pressed={charts.includes(chart)}
						onClick={() => toggle(chart)}
					>
						{label}
					</Anchor>
				))}
			</Group>
			{charts.length > 0 ? (
				<PitchTrajectoryView
					pitch={atBat.pitches.find((pitch) => pitch.pitchNumber === selected) ?? null}
					batSide={atBat.matchup.batSide}
					pitchHand={atBat.matchup.pitchHand}
					charts={CHART_LINKS.flatMap(({ chart }) => (charts.includes(chart) ? [chart] : []))}
				/>
			) : null}
		</Stack>
	);
}
