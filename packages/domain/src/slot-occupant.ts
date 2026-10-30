/**
 * What the scoreboard's game-row slot shows (S67; shell-scoreboard `Modular Block`).
 * The owner decided (2026-10-19) that **Status** is the drawn per-phase mix — the
 * pitchers of record on a final, the count on a live game, the probable pitchers
 * before first pitch — and the default; **Room Menu** links into the game's rooms in
 * any phase. One answer for the scoreboard (ADR-025); the view draws it.
 */
import type { GamePhase } from "./game-phase.js";
import type { GameRowSlot } from "./settings.js";
import type { ProbablePitcher } from "./types.js";

export type SlotOccupant = "pitchersOfRecord" | "count" | "probables" | "roomMenu";

const STATUS: Readonly<Record<GamePhase, SlotOccupant>> = {
	final: "pitchersOfRecord",
	live: "count",
	pregame: "probables",
};

/** The occupant for the user's Game-Row Slot setting and the game's phase. */
export function slotOccupant(setting: GameRowSlot, phase: GamePhase): SlotOccupant
{
	return setting === "status" ? STATUS[phase] : "roomMenu";
}

/**
 * A probable pitcher's season line as the scheduled module draws it, `11-5, 3.12`
 * (W-L, ERA). Parts MLB didn't send are left out; `null` when it sent none.
 */
export function probableLine(pitcher: Pick<ProbablePitcher, "wins" | "losses" | "era">): string | null
{
	const record = pitcher.wins !== null && pitcher.losses !== null ? `${pitcher.wins}-${pitcher.losses}` : null;
	const parts = [record, pitcher.era].filter((part): part is string => part !== null);
	return parts.length > 0 ? parts.join(", ") : null;
}
