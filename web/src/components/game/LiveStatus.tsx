import {
	Group, Paper, Stack, Text,
} from "@mantine/core";
import { inningLabel } from "@bt/domain";
import type { GamePayload } from "../../api/game.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { useScoresHidden } from "../../settings/useScoresHidden.js";
import { HiddenValue } from "../HiddenValue.js";
import { BaseDiamond } from "./BaseDiamond.js";
import { BsoPips } from "./BsoPips.js";

/**
 * The Live room's compact status (S3; game-rooms `live-mobile` / `live-medium` /
 * `live-desktop`): the score `NYY 4 · BOS 3`, ball / strike / out pips and the inning.
 * The inning reads alone (`Bot 7th`): the count and outs show only as the pips, here and
 * nowhere else on Live (game-rooms A5, S109; owner, 2026-10-31: "one representation for
 * the inning and the count and the outs").
 * The score lives here, never in the game header (owner, 2026-10-14). On mobile it
 * is a row under the tabs; at medium and desktop it is the status card at the top of
 * the right-hand column, 320px as drawn — `variant` comes from the layout host. The inning text is
 * `inningLabel`'s (packages/domain). The base diamond (S64) leads the row and the card.
 * With Hide Scores on each team's runs read `–` through `HiddenValue` (`NYY – · BOS –`;
 * game-rooms A5 `live-hidden-status-*`, S75); the pips and the inning stay.
 */
export function LiveStatus({ game, variant }: { game: GamePayload;
	variant: LayoutVariant; })
{
	const { linescore, teams } = game;
	const scoresHidden = useScoresHidden(game);
	const runs = (value: number | null | undefined) => (scoresHidden ? <HiddenValue kind="score" /> : value ?? 0);
	const score = <>{teams.away.abbreviation} {runs(linescore?.teams.away.runs)} · {teams.home.abbreviation} {runs(linescore?.teams.home.runs)}</>;
	const inning = inningLabel(linescore);
	const pips = <BsoPips balls={linescore?.balls ?? null} strikes={linescore?.strikes ?? null} outs={linescore?.outs ?? null} />;

	if (variant === "mobile")
	{
		return (
			<Group
				role="status"
				aria-label="Live status"
				data-testid="live-status"
				data-variant={variant}
				justify="space-between"
				wrap="nowrap"
				py={10}
				style={{
					borderBottom: "1px solid var(--bt-hairline)",
				}}
			>
				<Group gap={10} wrap="nowrap">
					<BaseDiamond live={game.live} />
					<Text fz={12} fw={700}>{score}</Text>
				</Group>
				{pips}
				<Text fz={12} fw={700}>{inning}</Text>
			</Group>
		);
	}

	return (
		<Group justify="flex-end" style={{
			flex: "0 0 auto",
		}}
		>
			<Paper
				role="status"
				aria-label="Live status"
				data-testid="live-status"
				data-variant={variant}
				radius="md"
				px={16}
				py={14}
				w={320}
				style={{
					border: "1px solid var(--bt-light)",
				}}
			>
				<Group gap={14} wrap="nowrap">
					<BaseDiamond live={game.live} />
					<Stack gap={6}>
						<Text fz={11} fw={700}>{score}</Text>
						{pips}
						<Text fz={15} fw={700}>{inning}</Text>
					</Stack>
				</Group>
			</Paper>
		</Group>
	);
}
