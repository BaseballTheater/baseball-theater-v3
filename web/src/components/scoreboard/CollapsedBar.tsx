import {
	Box, Group, Text, UnstyledButton,
} from "@mantine/core";
import {
	collapsedBarState, formatGameTime, gamePhase, inningLabel,
} from "@bt/domain";
import { viewerTimeZone } from "../../format/datetime.js";
import { useScoresHidden } from "../../settings/useScoresHidden.js";
import { TeamSwatch } from "../team/TeamSwatch.js";
import type { ScoreboardGame } from "./ScoreboardModule.js";

/** A team in the bar: its abbreviation with its round color swatch on the inner side, toward the score (owner, 2026-10-30: "CHC o 1-0 o MIA"). */
function Team({ team, side }: { team: ScoreboardGame["teams"]["away"];
	side: "away" | "home"; })
{
	return (
		<Group gap={8} wrap="nowrap" h={20} justify={side === "away" ? "flex-end" : "flex-start"}>
			{side === "home" ? <TeamSwatch teamId={team.id} /> : null}
			<Text fw={700} c="var(--bt-muted)">{team.abbreviation}</Text>
			{side === "away" ? <TeamSwatch teamId={team.id} /> : null}
		</Group>
	);
}

/**
 * A non-favorite game folded into a slim bar (S68; shell-scoreboard `scoreboard-collapsed-*`,
 * S56 A2, S57 A3), centered in every state (owner, 2026-10-30): `NYY ● 5–2 ● BOS`, the
 * teams either side of the score with their round color swatches inside, by the score, and a muted line
 * under it — the inning and count while live, `Final` after, the start time before first
 * pitch. With scores hidden, or before any runs, `@` stands where the score would. What
 * it says comes from `collapsedBarState` (`packages/domain`), whose inning reads through
 * `inningLabel` like every live label. The bar is a button: choosing it opens the full
 * module.
 */
export function CollapsedBar({ game, onExpand }: { game: ScoreboardGame;
	onExpand: () => void; })
{
	const hidden = useScoresHidden(game);
	const bar = collapsedBarState(game, hidden);
	const state = bar?.state ?? (game.startTime ? formatGameTime(game.startTime, viewerTimeZone()) : "");
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
				padding: "10px 16px",
			}}
		>
			<Box style={{
				display: "grid",
				gridTemplateColumns: "1fr auto 1fr",
				alignItems: "center",
				columnGap: 14,
			}}
			>
				<Team team={game.teams.away} side="away" />
				<Text fw={700} ta="center" c={bar?.score ? undefined : "var(--bt-muted)"} data-testid="collapsed-score">{bar?.score ?? "@"}</Text>
				<Team team={game.teams.home} side="home" />
			</Box>
			<Text fz={11} c="var(--bt-muted)" ta="center" truncate mih={16} data-testid="collapsed-state">{state}</Text>
		</UnstyledButton>
	);
}
