import type { PitchEvent, PitchOutcome } from "@bt/domain";
import { pitchOutcome } from "@bt/domain";

/** Theme role per pitch outcome — the pitch tokens in `styles.css` (VISUAL-DESIGN §3). */
const PITCH_OUTCOME_COLOR: Record<PitchOutcome, string> = {
	ball: "var(--bt-pitch-ball)",
	strike: "var(--bt-pitch-strike)",
	inPlay: "var(--bt-pitch-in-play)",
};

/** Dot color for a pitch. The outcome is decided once in `@bt/domain`; this only picks the token. */
export function pitchDotColor(pitch: PitchEvent): string
{
	return PITCH_OUTCOME_COLOR[pitchOutcome(pitch)];
}

/**
 * A speed as shown everywhere a pitch appears — zone tooltip, trajectory header, pitch
 * sequence — "98.1 mph" (S64; one format, ADR-025).
 */
export function speedLabel(mph: number): string
{
	return `${mph.toFixed(1)} mph`;
}

/**
 * Scene points as an SVG `points` attribute, one decimal each. The zone and the flight
 * charts both draw polylines through it (one helper, ADR-025; was a copy in each).
 */
export function svgPoints(points: readonly { x: number;
	y: number }[]): string
{
	return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}
