import {
	Box, Group, Text, UnstyledButton,
} from "@mantine/core";
import {
	collapsedBarState, formatGameTime, gamePhase, inningLabel,
} from "@bt/domain";
import { viewerTimeZone } from "../../format/datetime.js";
import { useScoresHidden } from "../../settings/useScoresHidden.js";
import { TeamEdge } from "../team/TeamEdge.js";
import type { ScoreboardGame } from "./ScoreboardModule.js";

/** A team in the bar: its color edge as a short swatch, then its abbreviation. */
function Team({ team }: { team: ScoreboardGame["teams"]["away"] })
{
	return (
		<Group gap={8} wrap="nowrap" h={20}>
			<TeamEdge teamId={team.id} />
			<Text fw={700} c="var(--bt-muted)">{team.abbreviation}</Text>
		</Group>
	);
}

/**
 * A non-favorite game folded into a slim bar (S68; shell-scoreboard `scoreboard-collapsed-*`,
 * S56 A2, S57 A3): `LAD @ SD` with each team's color swatch, and on the right the score and
 * state (`2–1 · Bot 7th`, `5–3 · Final`) — the state alone with scores hidden, the start
 * time before first pitch. The inning reads through `inningLabel` inside
 * `collapsedBarState` (`packages/domain`), like every live label. The bar is a button:
 * choosing it opens the full module.
 */
export function CollapsedBar({ game, onExpand }: { game: ScoreboardGame;
	onExpand: () => void; })
{
	const hidden = useScoresHidden(game);
	const state = collapsedBarState(game, hidden) ?? (game.startTime ? formatGameTime(game.startTime, viewerTimeZone()) : "");
	// Only a live game has an inning to name; a pre-game linescore already says "Top 1st".
	const live = gamePhase(game.status.codedGameState) === "live" ? inningLabel(game.linescore) : null;
	return (
		<UnstyledButton
			onClick={onExpand}
			data-testid="collapsed-bar"
			aria-expanded={false}
			aria-label={`${game.teams.away.abbreviation} at ${game.teams.home.abbreviation}${live ? `, ${live}` : ""}: show the game`}
			style={{
				display: "block",
				width: "100%",
				borderRadius: "var(--mantine-radius-md)",
				border: "1px solid var(--bt-hairline)",
				background: "var(--bt-raised)",
				padding: "14px 16px",
			}}
		>
			<Group justify="space-between" wrap="nowrap">
				<Group gap={10} wrap="nowrap">
					<Team team={game.teams.away} />
					<Text size="sm" c="var(--bt-muted)">@</Text>
					<Team team={game.teams.home} />
				</Group>
				<Box style={{
					minWidth: 0,
				}}
				>
					<Text size="sm" c="var(--bt-muted)" truncate data-testid="collapsed-state">{state}</Text>
				</Box>
			</Group>
		</UnstyledButton>
	);
}
