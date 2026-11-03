import type { PitchEvent } from "./plays.js";

/** What a pitch did, as the pitch views color it: the three pitch tokens in VISUAL-DESIGN §3. */
export type PitchOutcome = "ball" | "strike" | "inPlay";

/**
 * The one reading of a pitch's result (ADR-025). MLB marks a ball in play with
 * `isInPlay` and not `isStrike`; fouls and swinging / called strikes carry
 * `isStrike`. Anything else — balls, hit-by-pitch, automatic balls, pitchouts —
 * reads as a ball. MLB's own `ballColor` is ignored: BT colors pitches with its
 * own tokens.
 */
export function pitchOutcome(pitch: Pick<PitchEvent, "details">): PitchOutcome
{
	if (pitch.details.isInPlay) return "inPlay";
	if (pitch.details.isStrike) return "strike";
	return "ball";
}

/**
 * MLB's call codes for a swing and a miss: swinging strike, swinging strike (blocked),
 * foul tip (caught, so a strike the batter swung through), missed bunt, swinging
 * pitchout. Fouls are swings too but are not swinging strikes.
 */
const SWINGING_STRIKE_CALLS = new Set(["S", "W", "T", "M", "Q"]);

/**
 * Whether a strike came from the batter swinging rather than the umpire's call — the
 * zone draws these with a dotted outline (owner, 2026-10-29: "Swinging strikes and
 * called strikes should have a slightly different visual treatment in the strike
 * zone. I propose a dotted outline for swinging strikes").
 */
export function isSwingingStrike(pitch: Pick<PitchEvent, "details">): boolean
{
	return pitchOutcome(pitch) === "strike" && SWINGING_STRIKE_CALLS.has(pitch.details.call ?? "");
}

/** MLB's call code for a ball in play that scored a run ("In play, run(s)"). */
const IN_PLAY_SCORED = "E";

/**
 * A pitch's call as the pitch views print it (S75; game-rooms A3 frames). MLB words a ball
 * in play by what it did to the score ("In play, run(s)"), so with Hide Scores on that call
 * reads "IN PLAY". Every other call — outs and no-outs in play included — is MLB's own words,
 * unchanged from how it normally shows (owner, 2026-11-03: "They should be unchanged from how
 * they normally show"). The pitch sequence and the zone both print through this, so no view
 * words a call itself.
 */
export function pitchCallLabel(pitch: Pick<PitchEvent, "details">, scoresHidden: boolean): string
{
	if (scoresHidden && pitchOutcome(pitch) === "inPlay" && pitch.details.call === IN_PLAY_SCORED) return "IN PLAY";
	return pitch.details.callDescription ?? pitch.details.call ?? "";
}
