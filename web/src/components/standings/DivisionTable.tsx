import {
	Group, Stack, Table, Text, Title,
} from "@mantine/core";
import { divisionName } from "@bt/domain";
import type { StandingsPayload } from "../../api/standings.js";
import { TeamSwatch } from "../team/TeamSwatch.js";

type Division = StandingsPayload["divisions"][number];

/** A muted column head, as the frames draw `TEAM  W  L  PCT  GB`. */
function Head({ children, align = "right" }: { children: string;
	align?: "left" | "right"; })
{
	return (
		<Table.Th ta={align} fz={11} fw={700} c="var(--bt-muted)" tt="uppercase">
			{children}
		</Table.Th>
	);
}

/**
 * One division's table (S4; standings-search-settings `standings-*`): the division name as
 * its heading, then each team in rank order — color swatch and name, abbreviation, W, L,
 * PCT and GB. The leader's GB is "—": MLB's `"-"` arrives as `null` (the standings mapper),
 * so the dash is drawn here, never stored. The heading is `divisionName`, since the
 * recording names no division; an id it doesn't know falls back to MLB's own name.
 */
export function DivisionTable({ division }: { division: Division })
{
	const heading = (division.divisionId !== null ? divisionName(division.divisionId) : undefined) ?? division.name ?? "Division";
	return (
		<Stack gap={4} data-testid="division-table">
			<Title order={3} fz={18}>{heading}</Title>
			<Table verticalSpacing={8} horizontalSpacing={8} borderColor="var(--bt-hairline)" aria-label={`${heading} standings`}>
				<Table.Thead>
					<Table.Tr>
						<Head align="left">Team</Head>
						<Table.Th aria-label="Abbreviation" />
						<Head>W</Head>
						<Head>L</Head>
						<Head>PCT</Head>
						<Head>GB</Head>
					</Table.Tr>
				</Table.Thead>
				<Table.Tbody>
					{division.teams.map((team) => (
						<Table.Tr key={team.teamId} data-testid="standings-row">
							<Table.Td w="100%">
								<Group gap={10} wrap="nowrap">
									<TeamSwatch teamId={team.teamId} />
									<Text fz={13} fw={700}>{team.name}</Text>
								</Group>
							</Table.Td>
							<Table.Td ta="right" fz={12} c="var(--bt-muted)">{team.abbreviation}</Table.Td>
							<Table.Td ta="right" fz={13}>{team.wins}</Table.Td>
							<Table.Td ta="right" fz={13}>{team.losses}</Table.Td>
							<Table.Td ta="right" fz={13}>{team.pct}</Table.Td>
							<Table.Td ta="right" fz={13} c="var(--bt-muted)" data-testid="games-back">{team.gamesBack ?? "—"}</Table.Td>
						</Table.Tr>
					))}
				</Table.Tbody>
			</Table>
		</Stack>
	);
}
