import {
	Box, Group, Text,
} from "@mantine/core";

/**
 * One count group as pips (S3): `B ●●○`. The group's accessible name carries the
 * value ("Balls: 2 of 3"), so a screen reader hears the count the dots show; the
 * pips themselves are decoration. Filled pips take the group's color; empty ones
 * are dim dots. Balls Accent, strikes Primary Light, outs Light (the frames).
 */
function Pips({
	letter, name, value, slots, color,
}: { letter: string;
	name: string;
	value: number;
	slots: number;
	color: string; })
{
	return (
		<Group gap={3} wrap="nowrap" role="img" aria-label={`${name}: ${value} of ${slots}`} data-testid={`pips-${name.toLowerCase()}`}>
			<Text span fz={11} fw={700} mr={2} aria-hidden>{letter}</Text>
			{Array.from({
				length: slots,
			}, (_, i) => (
				<Box
					key={i}
					w={6}
					h={6}
					data-filled={i < value}
					aria-hidden
					style={{
						borderRadius: "50%",
						background: i < value ? color : "var(--bt-hairline)",
					}}
				/>
			))}
		</Group>
	);
}

/**
 * The count as ball / strike / out pips (S3 Live status; S67 scoreboard count slot):
 * `B ●●○  S ●○  O ●○`. One component for every count BT draws, so the Live room and
 * the scoreboard can't disagree on how a count looks. Missing values show empty pips.
 */
export function BsoPips({
	balls, strikes, outs, gap = 10,
}: { balls: number | null;
	strikes: number | null;
	outs: number | null;
	gap?: number; })
{
	return (
		<Group gap={gap} wrap="nowrap">
			<Pips letter="B" name="Balls" value={balls ?? 0} slots={3} color="var(--bt-accent)" />
			<Pips letter="S" name="Strikes" value={strikes ?? 0} slots={2} color="var(--bt-primary-light)" />
			<Pips letter="O" name="Outs" value={outs ?? 0} slots={2} color="var(--bt-light)" />
		</Group>
	);
}
