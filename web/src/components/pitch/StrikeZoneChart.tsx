import type { PitchEvent, TrajectoryPoint } from "@bt/domain";
import {
	atBatReplayAt, catcherViewBatter, catcherViewGround, catcherViewPath, catcherViewPoint, catcherViewZone, catcherViewZoneDimensions, feetToInches, fitArt,
	isSwingingStrike, pathUpTo, pitchCallLabel, pitcherFigure, pitchFlight, pitchOutcome, PLATE_FRONT_Y_FT,
} from "@bt/domain";
import { Box, Tooltip } from "@mantine/core";
import { useEffect, useRef } from "react";
import batterUrl from "./assets/batter.webp";
import zoneUrl from "./assets/strikezone.svg";
import { usePitchReplay, useReplayClock } from "./usePitchReplay.js";
import {
	pitchDotColor, speedLabel, svgPoints,
} from "./utils.js";

type Props = {
	pitches: PitchEvent[];
	selectedPitchNumber: number | null;
	onSelectPitch: (pitchNumber: number) => void;
	/** The batter's side, "R" or "L": a right-handed batter stands on the catcher's left. */
	batSide?: string | null;
	/** The pitcher's throwing hand, "R" or "L", named beside the drawn pitcher. */
	pitchHand?: string | null;
	/** Replays the selected pitch in the zone while true; `onPlaybackEnd` fires when it lands. */
	playing?: boolean;
	/**
	 * Replays every pitch of the at-bat on `atBatReplaySchedule` while true — overlapping,
	 * each hidden until thrown — then calls `onReplayAllEnd`.
	 */
	replayingAll?: boolean;
	onReplayAllEnd?: () => void;
	onPlaybackEnd?: () => void;
	/** Hide Scores for this game (`useScoresHidden`): an in-play call reads "IN PLAY" (S75). */
	scoresHidden?: boolean;
};

/** The scene's own units: everything is placed in this 360 × 300 box, which scales as a whole to fit its column. */
const SCENE_W = 360;
const SCENE_H = 300;
/** Canvas pixels per scene unit, so curves stay sharp on high-density screens. */
const CANVAS_SCALE = 2;
/**
 * The one camera every part of the scene is projected through (`@bt/domain`'s
 * catcher's view): plate centred, the eye's height at y 150, 36 units a foot at the
 * plate's front edge. The zone, plate, boxes, batter and flights all come from it, so
 * they stay to scale with each other at every size.
 */
const CAMERA = {
	centerX: 180,
	eyeY: 150,
	perFt: 36,
};
/**
 * `assets/batter.webp` (generated to the catcher's view's perspective, owner
 * 2026-10-29), measured: its size, the middle of the feet, the ground at the stance's
 * middle (between the near shoe, 1520, and the far one, 1340) and the helmet's top.
 */
const BATTER_ART = {
	width: 588,
	height: 1525,
	feetX: 310,
	groundY: 1446,
	headY: 150,
};
/** `assets/strikezone.svg`: its size and the 3 × 3 grid inside it, which is laid over the batter's zone. */
const ZONE_ART = {
	width: 595.28,
	height: 841.89,
	inner: {
		left: 118,
		top: 181,
		width: 363,
		height: 468,
	},
};

/** A scene-unit box as CSS percentages of the scene, for the absolutely placed artwork. */
function placed(left: number, top: number, width: number, height: number)
{
	return {
		position: "absolute" as const,
		left: `${(left / SCENE_W) * 100}%`,
		top: `${(top / SCENE_H) * 100}%`,
		width: `${(width / SCENE_W) * 100}%`,
		height: `${(height / SCENE_H) * 100}%`,
	};
}

/** A length as the zone's dimensions show it: 38.4". */
function lengthLabel(feet: number): string
{
	return `${feetToInches(feet).toFixed(1)}"`;
}

/** The plate and batter's boxes on the ground: the same for every at-bat. */
const GROUND = catcherViewGround(CAMERA);

/** A `var(--token)` color resolved for the canvas, which can't read CSS variables. */
function canvasColor(el: HTMLElement, color: string): string
{
	const name = /^var\((--[\w-]+)\)$/.exec(color)?.[1];
	return name ? getComputedStyle(el).getPropertyValue(name).trim() || color : color;
}

type Located = {
	pitch: PitchEvent;
	/** The flight in the air (feet), for replays. */
	flight: TrajectoryPoint[];
	/** Where it crossed the plate; null while the pitch is still in the air in a replay. */
	dot: { x: number;
		y: number } | null;
	path: { x: number;
		y: number }[];
};

/**
 * Draws each pitch's flight onto the canvas: older pitches faint, the selected one on
 * top at full strength. Canvas rather than SVG because the flights are dense sampled
 * curves (owner, 2026-10-29: "the trajectories are curves which either need creative
 * Bézier curves or, more likely, canvas-based drawing").
 */
function drawFlights(canvas: HTMLCanvasElement, located: Located[], selected: number | null)
{
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.setTransform(CANVAS_SCALE, 0, 0, CANVAS_SCALE, 0, 0);
	ctx.clearRect(0, 0, SCENE_W, SCENE_H);
	ctx.lineWidth = 2;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	const ordered = [...located].sort((a, b) => Number(a.pitch.pitchNumber === selected) - Number(b.pitch.pitchNumber === selected));
	for (const { pitch, path } of ordered)
	{
		const [first, ...rest] = path;
		if (!first) continue;
		ctx.globalAlpha = selected === null || pitch.pitchNumber === selected ? 1 : 0.55;
		ctx.strokeStyle = canvasColor(canvas, pitchDotColor(pitch));
		ctx.beginPath();
		ctx.moveTo(first.x, first.y);
		for (const point of rest) ctx.lineTo(point.x, point.y);
		ctx.stroke();
	}
}

/**
 * The pitcher, small on the mound in the distance, throwing from this pitch's release
 * point — the first point of its flight (`pitchFlight`, `pitcherFigure`) — projected
 * like the flights so the arm meets their start. Null when the pitch has no flight.
 */
function catcherFigure(data: NonNullable<PitchEvent["pitchData"]>)
{
	const release = pitchFlight(data)[0];
	if (!release) return null;
	const { lines, head } = pitcherFigure(release);
	return {
		lines: lines.map(([a, b]) => [catcherViewPoint(a, CAMERA), catcherViewPoint(b, CAMERA)] as const),
		head: catcherViewPoint(head, CAMERA),
		hand: catcherViewPoint(release, CAMERA),
	};
}

/**
 * The catcher's view of an at-bat (S64; game-rooms Live frames): the batter on their
 * side of the plate, the strike zone and plate, each pitch's curved flight from release
 * to where it crossed the plate, a numbered dot there colored by outcome (dotted
 * outline for a swinging strike), and the pitcher on the mound throwing with their arm. Flights
 * are projected in `@bt/domain` (`catcherViewPath`); the artwork is absolutely placed
 * in one fixed scene so the zone, plate and dots always line up, and the scene scales
 * to its column. A dot is a button: it selects that pitch, as a sequence row does.
 */
export function StrikeZoneChart({
	pitches, selectedPitchNumber, onSelectPitch, batSide, pitchHand, playing = false, onPlaybackEnd, replayingAll = false, onReplayAllEnd, scoresHidden = false,
}: Props)
{
	const canvas = useRef<HTMLCanvasElement>(null);
	// Only pitches with a plate location get a dot; a flight needs the release data too.
	const located: Located[] = pitches.flatMap((pitch) =>
	{
		const data = pitch.pitchData;
		if (!data) return [];
		const flight = pitchFlight(data);
		return [{
			pitch,
			flight,
			dot: catcherViewPoint({
				x: data.coordinates.pX,
				y: PLATE_FRONT_Y_FT,
				z: data.coordinates.pZ,
			}, CAMERA),
			path: catcherViewPath(flight, CAMERA),
		}];
	});

	// The pitcher throws from the selected pitch's release point, or the newest one's.
	const thrower = located.find(({ pitch }) => pitch.pitchNumber === selectedPitchNumber)?.pitch ?? located.at(-1)?.pitch;
	const figure = thrower?.pitchData ? catcherFigure(thrower.pitchData) : null;
	// The replay: the selected pitch's ball in real time, projected like its flight, so it
	// looks as fast as it would from behind the plate — slow far out, rushing in at the end.
	const replayed = located.find(({ pitch }) => pitch.pitchNumber === selectedPitchNumber)?.pitch ?? null;
	const { flight, replay } = usePitchReplay(replayed, playing, onPlaybackEnd, false);
	const inFlight = playing && replay.ball ? {
		ball: replay.ball,
	} : null;
	// The whole at-bat's replay: every pitch's state on one clock.
	const allElapsed = useReplayClock(replayingAll, (seconds) => atBatReplayAt(located.map((entry) => entry.flight), seconds).done, onReplayAllEnd);
	const all = replayingAll ? atBatReplayAt(located.map((entry) => entry.flight), allElapsed).pitches : null;
	const balls = all
		? all.flatMap(({ ball }) =>
		{
			return ball ? [catcherViewPoint(ball, CAMERA)] : [];
		})
		: inFlight ? [catcherViewPoint(inFlight.ball, CAMERA)] : [];
	// What the zone shows: pitches not yet thrown in a replay of the at-bat stay hidden;
	// the pitch in the air draws its path in behind the ball, and its dot appears where
	// it lands once it gets there (owner, 2026-10-29).
	const shown: Located[] = located.flatMap((entry, i) =>
	{
		const state = all?.[i];
		if (state)
		{
			if (state.landed) return [entry];
			if (!state.ball) return [];
			return [{
				...entry,
				dot: null,
				path: catcherViewPath(pathUpTo(entry.flight, state.ball), CAMERA),
			}];
		}
		if (!inFlight || entry.pitch !== replayed) return [entry];
		return [{
			...entry,
			dot: null,
			path: catcherViewPath(pathUpTo(flight, inFlight.ball), CAMERA),
		}];
	});

	useEffect(() =>
	{
		// During the at-bat's replay every flight is drawn at full strength.
		if (canvas.current) drawFlights(canvas.current, shown, replayingAll ? null : selectedPitchNumber);
	});

	// The batter's own zone (MLB's per-batter top and bottom): the zone is drawn there and
	// the batter is sized from it. Unknown until a pitch has data, so neither is drawn then.
	const zoneData = thrower?.pitchData;
	const zone = zoneData ? {
		top: zoneData.strikeZoneTop,
		bottom: zoneData.strikeZoneBottom,
	} : null;
	const zoneBox = zone ? fitArt(catcherViewZone(zone, CAMERA), ZONE_ART) : null;
	const batter = zone ? catcherViewBatter(zone, batSide, CAMERA, BATTER_ART) : null;
	// Toward the empty box: right of the zone for a right-hander, left for a left-hander.
	const dimensions = zone ? catcherViewZoneDimensions(zone, CAMERA, batSide !== "L", 16, 64, 8) : null;
	return (
		<Box
			data-testid="catcher-view"
			pos="relative"
			w="100%"
			maw={SCENE_W}
			mx="auto"
			style={{
				aspectRatio: `${SCENE_W} / ${SCENE_H}`,
				background: "var(--bt-dark)",
				borderRadius: 8,
				overflow: "hidden",
			}}
		>
			<svg data-testid="ground" viewBox={`0 0 ${SCENE_W} ${SCENE_H}`} style={placed(0, 0, SCENE_W, SCENE_H)}>
				{GROUND.boxes.map((box, i) => (
					<polygon key={i} points={svgPoints(box)} fill="none" stroke="#e0c6b2" strokeOpacity={0.35} strokeWidth={4} strokeLinejoin="round" />
				))}
				<polygon points={svgPoints(GROUND.plate)} fill="#e0c6b2" fillOpacity={0.35} />
			</svg>
			{batter ? (
				<img
					src={batterUrl}
					alt={batter.mirrored ? "Left-handed batter" : "Right-handed batter"}
					style={{
						...placed(batter.left, batter.top, batter.width, batter.height),
						transform: batter.mirrored ? "scaleX(-1)" : undefined,
					}}
				/>
			) : null}
			{zoneBox ? (
				<img data-testid="zone" src={zoneUrl} alt="" style={{
					...placed(zoneBox.left, zoneBox.top, zoneBox.width, zoneBox.height),
					opacity: 0.4,
				}} />
			) : null}
			<canvas
				ref={canvas}
				width={SCENE_W * CANVAS_SCALE}
				height={SCENE_H * CANVAS_SCALE}
				style={{
					...placed(0, 0, SCENE_W, SCENE_H),
					pointerEvents: "none",
				}}
			/>
			<svg viewBox={`0 0 ${SCENE_W} ${SCENE_H}`} style={{
				...placed(0, 0, SCENE_W, SCENE_H),
				overflow: "visible",
			}}>
				{dimensions ? (
					// The zone's measured top, bottom and height, drawn like a dimension in
					// the empty batter's box so no pitch sits on it (owner, 2026-10-29).
					<g data-testid="zone-measurements" fontSize={9} fill="var(--bt-muted)" stroke="var(--bt-hairline)" strokeWidth={1}>
						{[dimensions.top, dimensions.bottom, ...dimensions.height.lines.map((line) => ({
							line,
						}))].map(({ line }, i) => <line key={i} x1={line[0].x} y1={line[0].y} x2={line[1].x} y2={line[1].y} />)}
						{/* The top's height sits on its line; the bottom's hangs under its own. */}
						{[{
							edge: dimensions.top,
							dy: -3,
							baseline: "auto" as const,
						}, {
							edge: dimensions.bottom,
							dy: 3,
							baseline: "hanging" as const,
						}].map(({
							edge, dy, baseline,
						}) => (
							<text key={edge.feet} x={edge.label.x} y={edge.label.y} dy={dy} textAnchor="middle" dominantBaseline={baseline} stroke="none">
								{lengthLabel(edge.feet)}
							</text>
						))}
						<text x={dimensions.height.label.x} y={dimensions.height.label.y} textAnchor="middle" dominantBaseline="central" stroke="none">
							{lengthLabel(dimensions.height.feet)}
						</text>
					</g>
				) : null}
				{figure ? (
					<g data-testid="pitcher-figure" stroke="var(--bt-muted)" strokeWidth={1.5} strokeLinecap="round">
						{figure.lines.map(([a, b], i) => <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />)}
						<circle cx={figure.head.x} cy={figure.head.y} r={2.2} fill="var(--bt-muted)" stroke="none" />
						{pitchHand ? (
							<text x={figure.hand.x} y={figure.hand.y} dy={-8} textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--bt-muted)" stroke="none">
								{pitchHand}HP
							</text>
						) : null}
					</g>
				) : null}
				{shown.map(({ pitch, dot }) =>
				{
					if (!dot) return null;
					const selected = pitch.pitchNumber === selectedPitchNumber;
					// No "current pitch" ring while an at-bat replays; the last one gets it at the end (owner, 2026-10-29).
					const ringed = selected && !replayingAll;
					// Swinging strikes get a dotted outline; called strikes a solid one. A ball's number is
					// dark to read on the light green (owner, 2026-10-29).
					const swinging = isSwingingStrike(pitch);
					return (
						<Tooltip
							key={pitch.playId || pitch.pitchNumber}
							label={
								<>
									#{pitch.pitchNumber}{" "}
									{pitch.details.typeDescription ?? pitch.details.type}
									<br />
									{pitchCallLabel(pitch, scoresHidden)}
									<br />
									{pitch.pitchData ? speedLabel(pitch.pitchData.startSpeed) : null}
								</>
							}
						>
							<g
								role="button"
								tabIndex={0}
								// The dot grows a little under the pointer (styles.css), like every clickable.
								className="bt-pitch-dot"
								aria-label={`Pitch ${pitch.pitchNumber}`}
								aria-pressed={selected}
								onClick={() => onSelectPitch(pitch.pitchNumber)}
								onKeyDown={(event) =>
								{
									if (event.key !== "Enter" && event.key !== " ") return;
									event.preventDefault();
									onSelectPitch(pitch.pitchNumber);
								}}
								style={{
									cursor: "pointer",
								}}
							>
								<circle
									cx={dot.x}
									cy={dot.y}
									r={ringed ? 10 : 8.5}
									fill={pitchDotColor(pitch)}
									stroke={ringed || swinging ? "var(--bt-light)" : "var(--bt-dark)"}
									strokeWidth={ringed || swinging ? 2 : 1}
									strokeDasharray={swinging ? "0.1 3.4" : undefined}
									strokeLinecap={swinging ? "round" : undefined}
									data-swinging={swinging || undefined}
								/>
								<text
									x={dot.x}
									y={dot.y}
									textAnchor="middle"
									dominantBaseline="central"
									fontSize={10}
									fontWeight={700}
									fill={pitchOutcome(pitch) === "ball" ? "var(--bt-dark)" : "var(--bt-light)"}
									style={{
										pointerEvents: "none",
									}}
								>
									{pitch.pitchNumber}
								</text>
							</g>
						</Tooltip>
					);
				})}
				{balls.map((ball, i) => <circle key={i} data-testid="zone-ball" cx={ball.x} cy={ball.y} r={5} fill="white" stroke="var(--bt-dark)" strokeWidth={1} />)}
			</svg>
		</Box>
	);
}
