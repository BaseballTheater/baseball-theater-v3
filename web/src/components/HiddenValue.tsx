import { Text } from "@mantine/core";

/** What each mask stands in for, and how it is drawn (shell-scoreboard scores-hidden frames, S57 A3). */
const MASKS = {
	/** An R / H / E cell: a muted dash. */
	score: "–",
	/** A season record: shade blocks that read as see-through (owner, 2026-10-10). */
	record: "▒▒-▒▒",
	/** A pitcher of record's name. */
	name: "▒▒▒▒▒▒",
} as const;

/**
 * IBM Plex Sans has no `▒` (U+2592), so the masks name fonts that draw it — Menlo
 * (macOS / iOS), Consolas and Segoe UI Symbol (Windows), DejaVu Sans Mono (Linux) —
 * before the generic monospace (shell-scoreboard REVISIONS: "check that the web font
 * stack has a fallback that draws U+2592").
 */
const MASK_FONTS = "Menlo, Consolas, \"Segoe UI Symbol\", \"DejaVu Sans Mono\", monospace";

/**
 * A value hidden by Hide Scores (S68). The one component that draws the masks, so every
 * hidden score, record and name looks the same and takes the place of the real value
 * without changing the layout. The masks are the only sign scores are hidden: A4
 * removed the line that used to say so.
 */
export function HiddenValue({ kind }: { kind: keyof typeof MASKS })
{
	return (
		<Text
			span
			inherit
			c={kind === "score" ? "var(--bt-muted)" : undefined}
			ff={kind === "score" ? undefined : MASK_FONTS}
			aria-label="hidden"
			data-testid={`hidden-${kind}`}
		>
			{MASKS[kind]}
		</Text>
	);
}
