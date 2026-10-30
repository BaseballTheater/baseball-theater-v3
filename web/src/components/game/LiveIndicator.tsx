import {
	Box, Group, Text,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";

/**
 * The live marker (S32 `game-topbar`; S31 live row): an Accent 2 dot that
 * blinks, and a label — `LIVE` in the game top bar, the inning on the scoreboard's
 * live row (`BOT 7`, S66), always in capitals. One component for every live marker (S60).
 * Under `prefers-reduced-motion` the dot holds still (VISUAL-DESIGN §7) — an
 * accessibility preference, not a viewport read.
 */
export function LiveIndicator({ label = "LIVE" }: { label?: string })
{
	const reduceMotion = useReducedMotion();
	return (
		<Group gap={4} wrap="nowrap" data-testid="live-indicator">
			<Box
				w={8}
				h={8}
				bg="var(--bt-accent-2)"
				data-testid="live-dot"
				style={{
					borderRadius: "50%",
					animation: reduceMotion ? "none" : "bt-blink 1.2s ease-in-out infinite",
				}}
				aria-hidden
			/>
			<Text size="xs" fw={700} c="accent2" tt="uppercase">
				{label}
			</Text>
		</Group>
	);
}
