import { winProbabilitySeries } from "@bt/domain";
import {
	Box, Group, Paper, Text,
} from "@mantine/core";
import type { GamePayload } from "../../api/game.js";
import { HiddenValue } from "../HiddenValue.js";

/** The chart's drawing box; the SVG scales it to the card's width. */
const W = 300;
const H = 150;
/** Room under the plot for the inning labels. */
const AXIS = 18;
const PLOT = H - AXIS;

/**
 * The Live room's Win probability card (S106; game-rooms `live-medium` / `live-desktop`, hidden
 * as A5's `live-hidden-status-medium`): the home team's chance of winning after each at-bat
 * (`winProbabilitySeries`, S93's play metrics), drawn as one SVG with no charting library — the
 * line with the area under it, a dashed 50% line, the innings along the bottom, and the current
 * value at the top right. With Hide Scores on it keeps its title and size and reads "–" and
 * "Hidden with scores": the line would give the score away. A game with no play metrics has no
 * card (`null`), so the room lays out as S64 built it.
 */
export function WinProbabilityCard({ game, scoresHidden }: { game: GamePayload;
	scoresHidden: boolean; })
{
	const series = winProbabilitySeries(game);
	if (series.currentPercent == null) return null;
	const n = series.points.length;
	const x = (i: number) => n === 1 ? W / 2 : (i / (n - 1)) * W;
	const y = (home: number) => PLOT - (home / 100) * PLOT;
	const line = series.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.home).toFixed(1)}`).join(" ");
	const area = `${line} L${x(n - 1).toFixed(1)},${PLOT} L${x(0).toFixed(1)},${PLOT} Z`;
	// Each inning's label sits under its first at-bat.
	const innings = series.points.flatMap((p, i) => i === 0 || series.points[i - 1]!.inning !== p.inning ? [{
		inning: p.inning,
		x: x(i),
	}] : []);

	return (
		<Paper
			role="figure"
			aria-label="Win probability"
			data-testid="win-probability"
			radius="md"
			p={12}
			w={320}
			style={{
				border: "1px solid var(--bt-light)",
			}}
		>
			<Group justify="space-between" wrap="nowrap" mb={8}>
				<Text fz={11} fw={700} tt="uppercase">Win probability ({game.teams.home.abbreviation})</Text>
				<Text fz={13} fw={700} c="var(--bt-accent)" data-testid="win-probability-value">
					{scoresHidden ? <HiddenValue kind="score" /> : `${series.currentPercent}%`}
				</Text>
			</Group>
			{scoresHidden ? (
				<Box h={H} style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
				>
					<Text fz={12} c="var(--bt-muted)">Hidden with scores</Text>
				</Box>
			) : (
				<svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Home win probability by at-bat, now ${series.currentPercent}%`} data-testid="win-probability-chart">
					<path d={area} fill="var(--bt-accent)" fillOpacity={0.12} data-testid="win-probability-area" />
					<line x1={0} x2={W} y1={y(50)} y2={y(50)} stroke="var(--bt-light)" strokeWidth={1} strokeDasharray="3 3" data-testid="win-probability-midline" />
					<path d={line} fill="none" stroke="var(--bt-accent)" strokeWidth={2} strokeLinejoin="round" data-testid="win-probability-line" data-points={n} />
					{innings.map((label) => (
						<text key={label.inning} x={label.x} y={H - 4} fontSize={10} fill="var(--bt-muted)" textAnchor="middle" data-testid="win-probability-inning">
							{label.inning}
						</text>
					))}
				</svg>
			)}
		</Paper>
	);
}
