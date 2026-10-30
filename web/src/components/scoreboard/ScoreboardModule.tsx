import {
	Box, Group, Paper, Text,
} from "@mantine/core";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
	formatGameTime, gamePhase, inningLabel, teamRecordLabel,
} from "@bt/domain";
import type { GamePhase } from "@bt/domain";
import type { ScheduleDayPayload } from "../../api/schedule.js";
import { viewerTimeZone } from "../../format/datetime.js";
import { useSettings } from "../../settings/store.js";
import { LiveIndicator } from "../game/LiveIndicator.js";
import { TeamEdge } from "../team/TeamEdge.js";
import { GameRowSlot } from "./GameRowSlot.js";

export type ScoreboardGame = ScheduleDayPayload["games"][number];

/** Name and record on the left, then R · H · E: the frames' 28px score columns. */
const SCORED_GRID = "minmax(0, 1fr) repeat(3, 28px)";

const HEAD: CSSProperties = {
	color: "var(--bt-muted)",
	fontSize: 11,
	fontWeight: 700,
	textAlign: "center",
};

/**
 * The top-left status of a module (S31): `FINAL`, the live dot with the inning
 * (`BOT 7`), or the start time in the viewer's zone and the venue. Venue shows on
 * scheduled games only (R8).
 */
function StatusLine({ game, phase }: { game: ScoreboardGame;
	phase: GamePhase; })
{
	if (phase === "live")
	{
		return <LiveIndicator label={inningLabel(game.linescore) ?? "LIVE"} />;
	}
	if (phase === "final")
	{
		return <Text size="xs" fw={700}>FINAL</Text>;
	}
	return (
		<Group gap={6} wrap="nowrap" style={{
			minWidth: 0,
		}}
		>
			{game.startTime ? (
				<Text size="xs" fw={700} c="var(--bt-accent)" style={{
					whiteSpace: "nowrap",
				}}
				>
					{formatGameTime(game.startTime, viewerTimeZone())}
				</Text>
			) : null}
			{game.venue ? <Text size="xs" truncate>· {game.venue.name}</Text> : null}
		</Group>
	);
}

/** One team's row: its color edge, club name, and the record line under it. */
function TeamCell({ team, phase }: { team: ScoreboardGame["teams"]["away"];
	phase: GamePhase; })
{
	const record = teamRecordLabel(team, phase);
	return (
		<Group gap={8} wrap="nowrap" mih={36} data-testid="team-row" style={{
			minWidth: 0,
		}}
		>
			<TeamEdge teamId={team.id} />
			<Box style={{
				minWidth: 0,
			}}
			>
				<Text fw={700} tt="uppercase" lh={1.2} truncate>{team.teamName}</Text>
				{record ? <Text size="xs" lh={1.3}>{record}</Text> : null}
			</Box>
		</Group>
	);
}

/**
 * A game on the scoreboard — the ratified `Rich Scoreboard Module` (S31, S66), one
 * component for final, live and scheduled games. Final and live rows show R · H · E
 * beside each team and the abbreviation with its record (R7); a scheduled row shows
 * the record with its percentage, the start time and the venue. Team color is a 4px
 * edge only; names and numbers stay Light. Every label comes from `packages/domain`
 * (phase, inning, record, start time); this only lays them out. The right-hand slot
 * (S67) shows what the user's Game-Row Slot setting picks; the rest of the module
 * links to the game. Hide Scores and collapsed bars are S68's.
 */
export function ScoreboardModule({ game }: { game: ScoreboardGame })
{
	const phase = gamePhase(game.status.codedGameState);
	const teams = [game.teams.away, game.teams.home];
	const lines = [game.linescore?.teams.away, game.linescore?.teams.home];
	const scored = phase !== "pregame";
	const { gameRowSlot } = useSettings();
	return (
		<Paper
			data-testid="scoreboard-module"
			data-phase={phase}
			bg="var(--bt-raised)"
			radius="md"
			p={12}
			style={{
				display: "flex",
				gap: 12,
				border: "1px solid var(--bt-hairline)",
			}}
		>
			<Box
				component={Link}
				to={`/game/${game.gamePk}`}
				aria-label={`${game.teams.away.teamName} at ${game.teams.home.teamName}`}
				style={{
					flex: 1,
					minWidth: 0,
					color: "inherit",
					textDecoration: "none",
					display: "grid",
					gridTemplateColumns: scored ? SCORED_GRID : "minmax(0, 1fr)",
					alignItems: "center",
					rowGap: 8,
				}}
			>
				<Box mih={20} style={{
					display: "flex",
					alignItems: "center",
					minWidth: 0,
				}}
				>
					<StatusLine game={game} phase={phase} />
				</Box>
				{scored ? ["R", "H", "E"].map((h) => <Text key={h} span style={HEAD}>{h}</Text>) : null}
				{teams.map((team, i) => (
					<Box key={team.id} style={{
						display: "contents",
					}}
					>
						<TeamCell team={team} phase={phase} />
						{scored ? (
							<>
								<Text ta="center" fz={18} fw={700} data-testid="runs">{lines[i]?.runs ?? "–"}</Text>
								<Text ta="center" fz={14} data-testid="hits">{lines[i]?.hits ?? "–"}</Text>
								<Text ta="center" fz={14} data-testid="errors">{lines[i]?.errors ?? "–"}</Text>
							</>
						) : null}
					</Box>
				))}
			</Box>
			<GameRowSlot game={game} setting={gameRowSlot} />
		</Paper>
	);
}
