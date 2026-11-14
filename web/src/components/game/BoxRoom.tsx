import {
	Group, SimpleGrid, Stack, Table, Text, UnstyledButton,
} from "@mantine/core";
import { useState } from "react";
import type { GamePayload } from "../../api/game.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { TeamSwatch } from "../team/TeamSwatch.js";
import { ViewState } from "../ViewState.js";
import { gameInfoLines, shortPlayerName } from "./format.js";
import { Linescore } from "./Linescore.js";

type Side = "away" | "home";

const COLUMNS = [
	["AB", "atBats"],
	["R", "runs"],
	["H", "hits"],
	["RBI", "rbi"],
	["BB", "baseOnBalls"],
	["SO", "strikeOuts"],
] as const;

const HEAD = {
	color: "var(--bt-muted)",
	fontSize: 11,
	fontWeight: 400,
} as const;

/**
 * The Box room (S2; game-rooms `box-mobile` / `box-medium` / `box-desktop`): the
 * boxed-inning `Linescore`, a team switcher (each team marked with its `TeamSwatch`),
 * one batting table at a time — away first, as drawn — and the Game info block with
 * MLB's own labels. Every pairing draws the same modules; `variant` comes from the
 * layout host and is only passed through (VISUAL-DESIGN §5). Before MLB has a box
 * score, the room's empty state.
 */
export function BoxRoom({ game, variant }: { game: GamePayload;
	variant: LayoutVariant; })
{
	const [side, setSide] = useState<Side>("away");
	const { boxscore } = game;
	if (!boxscore)
	{
		return <ViewState kind="empty" message="No box score yet." />;
	}
	const info = gameInfoLines(boxscore.info);

	return (
		<Stack gap="md" data-testid="box-room" data-variant={variant}>
			<Linescore linescore={game.linescore} away={game.teams.away.abbreviation} home={game.teams.home.abbreviation} />

			<SimpleGrid cols={2} spacing="xs" role="group" aria-label="Team">
				{(["away", "home"] as const).map((s) =>
				{
					const team = game.teams[s];
					const selected = s === side;
					return (
						<UnstyledButton
							key={s}
							aria-pressed={selected}
							onClick={() => setSide(s)}
							className={selected ? undefined : "bt-hover"}
							h={38}
							style={{
								borderRadius: "var(--mantine-radius-md)",
								border: `1px solid ${selected ? "var(--bt-light)" : "var(--bt-hairline)"}`,
								background: selected ? "var(--bt-raised-current)" : "transparent",
							}}
						>
							<Group gap={8} justify="center" wrap="nowrap">
								<TeamSwatch teamId={team.id} size={8} />
								<Text size="sm" fw={600}>{team.abbreviation}</Text>
							</Group>
						</UnstyledButton>
					);
				})}
			</SimpleGrid>

			<Table aria-label={`${game.teams[side].abbreviation} batting`} verticalSpacing={12} horizontalSpacing={0} withRowBorders>
				<Table.Thead>
					<Table.Tr>
						<Table.Th style={HEAD}>PLAYER</Table.Th>
						{COLUMNS.map(([label]) => <Table.Th key={label} ta="center" w={30} style={HEAD}>{label}</Table.Th>)}
						<Table.Th ta="right" w={40} style={HEAD}>AVG</Table.Th>
					</Table.Tr>
				</Table.Thead>
				<Table.Tbody>
					{boxscore.teams[side].batting.map((batter) => (
						<Table.Tr key={batter.id} data-testid="batting-row">
							<Table.Td fz={12}>
								{shortPlayerName(batter.fullName)}
								<Text span fz={12} ml={6}>{batter.position}</Text>
							</Table.Td>
							{COLUMNS.map(([label, key]) => <Table.Td key={label} ta="center" fz={12}>{batter[key]}</Table.Td>)}
							<Table.Td ta="right" fz={12}>{batter.avg ?? ""}</Table.Td>
						</Table.Tr>
					))}
				</Table.Tbody>
			</Table>

			{info.length > 0 ? (
				<Stack gap={6} component="section" aria-label="Game info">
					<Text style={HEAD}>GAME INFO</Text>
					{info.map((line) => (
						<Group key={line.label} gap={0} wrap="nowrap" align="flex-start">
							<Text w={88} fz={11} fw={600} c="var(--bt-muted)" tt="uppercase" style={{
								flexShrink: 0,
							}}
							>{line.label}
							</Text>
							<Text fz={12}>{line.value}</Text>
						</Group>
					))}
				</Stack>
			) : null}
		</Stack>
	);
}
