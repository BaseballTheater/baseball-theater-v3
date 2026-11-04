/**
 * The inning as a fan reads it (S3): `Top 6th`, `Bot 7th`, `Mid 3rd`, `End 9th`. One
 * label for the Live status and the scoreboard's live row (ADR-025); views render it.
 * The short forms are the ratified frames' (`Bot 7th · 1 Out`, game-rooms Live).
 */
import type { AtBat } from "./plays.js";
import type { LinescoreSummary } from "./types.js";

const HALF: Readonly<Record<string, string>> = {
	Top: "Top",
	Bottom: "Bot",
	Middle: "Mid",
	End: "End",
};

/** `1` → `1st`, `2` → `2nd`, `11` → `11th`, `23` → `23rd`. */
export function ordinal(n: number): string
{
	const teen = n % 100 >= 11 && n % 100 <= 13;
	const suffix = teen ? "th" : ({
		1: "st",
		2: "nd",
		3: "rd",
	} as Record<number, string>)[n % 10] ?? "th";
	return `${n}${suffix}`;
}

/**
 * The inning label, or `null` before the game has an inning. MLB's `inningState`
 * names the half (Top / Bottom / Middle / End); without it, `isTopInning` decides.
 */
export function inningLabel(linescore: Pick<LinescoreSummary, "currentInning" | "inningState" | "isTopInning"> | null): string | null
{
	if (!linescore?.currentInning) return null;
	const half = (linescore.inningState && HALF[linescore.inningState]) ?? (linescore.isTopInning === false ? "Bot" : "Top");
	return `${half} ${ordinal(linescore.currentInning)}`;
}

/**
 * An at-bat's half and inning as the video play link spells it, `Top 6th` / `Bot 3rd` (S97;
 * game-shell A5's `Play · Top 6th →`). The at-bat's own form of `inningLabel`, which reads a
 * linescore; the one spelling for an at-bat's inning wherever a link or label needs it (ADR-025).
 */
export function atBatInningLabel(atBat: Pick<AtBat, "about">): string
{
	return `${atBat.about.halfInning === "top" ? "Top" : "Bot"} ${ordinal(atBat.about.inning)}`;
}
