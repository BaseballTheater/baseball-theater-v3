import type {
	FieldView, PitchEvent, TrajectoryPoint,
} from "@bt/domain";
import {
	battedBallChartRangeFt, fieldChart, fieldChartPoint, fieldLandmarks, pathUpTo, pitcherFigure,
} from "@bt/domain";
import {
	Box, Button, Group, Stack, Text,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { usePitchReplay } from "./usePitchReplay.js";
import {
	pitchDotColor, speedLabel, svgPoints,
} from "./utils.js";

/** The two flight charts this view can show. */
export type TrajectoryChart = FieldView;

type Props = {
	pitch: PitchEvent | null;
	/** Which charts to show; both by default. Live shows them only on request (S64). */
	charts?: readonly TrajectoryChart[];
	/** The batter's side, "R" or "L", so the top view labels the right box. */
	batSide?: string | null;
	/** The pitcher's throwing hand, "R" or "L", named on the charts. */
	pitchHand?: string | null;
};

type ViewBox = { minX: number;
	maxX: number;
	minY: number;
	maxY: number };

/** Height of the batted-ball side chart, in feet. */
const HIT_CHART_MAX_HEIGHT_FT = 120;

/**
 * One point in chart units → SVG pixels (y up), for a `width`×`height` panel. The one
 * place this view scales (S64): paths, the ball and the hit dot all go through it.
 */
function toViewBox(x: number, y: number, vb: ViewBox, width: number, height: number): { cx: number;
	cy: number }
{
	return {
		cx: ((x - vb.minX) / (vb.maxX - vb.minX)) * width,
		cy: height - ((y - vb.minY) / (vb.maxY - vb.minY)) * height,
	};
}

function mapPath(
	points: TrajectoryPoint[],
	map: (p: TrajectoryPoint) => { x: number;
		y: number },
	vb: ViewBox,
	width: number,
	height: number,
): string
{
	return points
		.map((p, i) =>
		{
			const { x, y } = map(p);
			const { cx, cy } = toViewBox(x, y, vb, width, height);
			return `${i === 0 ? "M" : "L"} ${cx.toFixed(2)} ${cy.toFixed(2)}`;
		})
		.join(" ");
}

/** Drawing width of each field chart; the height follows from its one scale. */
const FIELD_W = 670;
/** Feet each chart shows over and under its baseline: room for a release point and the labels. */
const FIELD_RANGE: Record<FieldView, { above: number;
	below: number }> = {
	side: {
		above: 8,
		below: 1.6,
	},
	top: {
		above: 6.5,
		below: 6.5,
	},
};

/**
 * One to-scale field chart of the pitch's flight (S64): from the side or from above,
 * pitcher on the left and catcher on the right, the same feet per unit both ways, with
 * the mound, rubber, plate, boxes or strike zone and who stands where. Every point —
 * flight and landmarks — is placed by `@bt/domain`'s field-chart functions; this only
 * draws them.
 */
function FieldPanel({
	view, title, flight, ball, color, zone, batSide, pitchHand,
}: {
	view: FieldView;
	title: string;
	flight: TrajectoryPoint[];
	ball: TrajectoryPoint | null;
	color: string;
	zone: { top: number;
		bottom: number };
	batSide: string | null | undefined;
	pitchHand: string | null | undefined;
})
{
	const chart = fieldChart(view, FIELD_W, FIELD_RANGE[view].above, FIELD_RANGE[view].below);
	const marks = fieldLandmarks(chart, zone, batSide, pitchHand);
	// The pitcher throwing from this pitch's release point: the arm shows which hand.
	const release = flight[0];
	const figure = release ? pitcherFigure(release) : null;
	const dot = ball ? fieldChartPoint(ball, chart) : null;
	return (
		<Box>
			<Text size="sm" c="dimmed" mb={4}>
				{title}
			</Text>
			<svg
				role="img"
				aria-label={title}
				viewBox={`0 0 ${FIELD_W} ${chart.height.toFixed(1)}`}
				width="100%"
				style={{
					display: "block",
					borderRadius: 8,
					background: "var(--bt-dark)",
				}}
			>
				{marks.ground.map((points, i) => (
					<polyline key={`g${i}`} points={svgPoints(points)} fill="none" stroke="var(--bt-hairline)" strokeWidth={1.5} />
				))}
				{marks.marks.map((points, i) => (
					<polyline key={`m${i}`} points={svgPoints(points)} fill="none" stroke="var(--bt-muted)" strokeWidth={1.5} />
				))}
				{marks.zone ? <polyline points={svgPoints(marks.zone)} stroke="var(--bt-muted)" strokeWidth={4} strokeLinecap="round" /> : null}
				{marks.labels.map((l) => (
					<text key={l.text} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="central" fontSize={11} fill="var(--bt-muted)">
						{l.text}
					</text>
				))}
				{figure ? (
					<g data-testid="pitcher-figure" stroke="var(--bt-muted)" strokeWidth={1.5} strokeLinecap="round">
						{figure.lines.map(([a, b], i) => <polyline key={i} points={svgPoints([fieldChartPoint(a, chart), fieldChartPoint(b, chart)])} />)}
					</g>
				) : null}
				<polyline points={svgPoints(flight.map((p) => fieldChartPoint(p, chart)))} fill="none" stroke={color} strokeWidth={2} />
				{dot ? <circle data-testid="ball" cx={dot.x} cy={dot.y} r={7} fill="white" stroke="var(--bt-dark)" strokeWidth={1.5} /> : null}
			</svg>
		</Box>
	);
}

export function PitchTrajectoryView({
	pitch, charts = ["side", "top"], batSide, pitchHand,
}: Props)
{
	// The charts' own replay, started by the Animate button under them (owner, 2026-10-29).
	const [playing, setPlaying] = useState(false);
	const {
		flight: pitchPath, hit: hitPath, replay,
	} = usePitchReplay(pitch, playing, () => setPlaying(false), true);

	useEffect(() =>
	{
		setPlaying(false);
	}, [pitch?.playId]);

	if (!pitch?.pitchData)
	{
		return <Text c="dimmed">Select a pitch to see trajectory.</Text>;
	}

	const hitPoint = playing ? replay.hitBall : null;
	// While playing, each path draws in behind its ball (owner, 2026-10-29): the pitch's
	// up to the ball, then whole once it's hit; the batted ball's from contact.
	const flightDrawn = playing && replay.ball ? pathUpTo(pitchPath, replay.ball) : pitchPath;
	const hitDrawn = !playing ? hitPath : hitPoint ? pathUpTo(hitPath, hitPoint) : [];
	// While playing the ball travels the flight; at rest it sits where it crossed the plate.
	const ball = playing ? replay.ball : (pitchPath.at(-1) ?? null);
	const zone = {
		top: pitch.pitchData.strikeZoneTop,
		bottom: pitch.pitchData.strikeZoneBottom,
	};

	const hitVb: ViewBox = {
		minX: 0,
		maxX: battedBallChartRangeFt(pitch.hitData?.totalDistance),
		minY: 0,
		maxY: HIT_CHART_MAX_HEIGHT_FT,
	};
	const hitSidePath =
		hitDrawn.length > 0
			? mapPath(
				hitDrawn,
				(p) => ({
					x: p.y,
					y: p.z,
				}),
				hitVb,
				280,
				160,
			)
			: "";
	const hitDot = hitPoint ? toViewBox(hitPoint.y, hitPoint.z, hitVb, 280, 160) : null;

	return (
		<Box>
			<Group justify="space-between" mb="xs">
				<Text fw={600}>
					#{pitch.pitchNumber} {pitch.details.typeDescription ?? pitch.details.type}
				</Text>
				<Text size="sm" c="dimmed">
					{speedLabel(pitch.pitchData.startSpeed)} → {speedLabel(pitch.pitchData.endSpeed)}
					{pitch.pitchData.breaks?.spinRate
						? ` · ${pitch.pitchData.breaks.spinRate.toFixed(0)} rpm`
						: ""}
				</Text>
			</Group>
			<Stack gap="md">
				{charts.includes("side") ? (
					<FieldPanel view="side" title="Side view (pitcher → catcher, to scale)" flight={flightDrawn} ball={ball} color={pitchDotColor(pitch)} zone={zone} batSide={batSide} pitchHand={pitchHand} />
				) : null}
				{charts.includes("top") ? (
					<FieldPanel view="top" title="Top-down view (pitcher → catcher, to scale)" flight={flightDrawn} ball={ball} color={pitchDotColor(pitch)} zone={zone} batSide={batSide} pitchHand={pitchHand} />
				) : null}
				<Group>
					<Button size="xs" variant="light" disabled={pitchPath.length === 0} onClick={() => setPlaying(true)}>
						Animate
					</Button>
				</Group>
			</Stack>
			{pitch.hitData && pitch.details.isInPlay ? (
				<Box mt="md">
					<Text size="sm" c="dimmed" mb={4}>
						Batted ball · {pitch.hitData.launchSpeed.toFixed(0)} mph /{" "}
						{pitch.hitData.launchAngle.toFixed(0)}° · {pitch.hitData.trajectory} (
						{pitch.hitData.totalDistance} ft)
					</Text>
					<svg width={280} height={160} style={{
						display: "block",
						borderRadius: 8,
					}}>
						<rect width={280} height={160} fill="var(--mantine-color-dark-7)" rx={8} />
						<path
							d={hitSidePath}
							fill="none"
							stroke={pitchDotColor(pitch)}
							strokeWidth={2.5}
						/>
						{hitDot ? (
							<circle
								cx={hitDot.cx}
								cy={hitDot.cy}
								r={6}
								fill={pitchDotColor(pitch)}
								stroke="#111"
								strokeWidth={1}
							/>
						) : null}
					</svg>
				</Box>
			) : null}
		</Box>
	);
}
