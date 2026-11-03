import {
	Stack, Text, Title,
} from "@mantine/core";
import { recapHeading } from "@bt/domain";
import type { GamePayload } from "../../api/game.js";
import { useScoresHidden } from "../../settings/useScoresHidden.js";

/**
 * The Recap room (S10; game-rooms `recap-mobile` / `recap-medium` / `recap-desktop`,
 * A2 `recap-source-mobile`): MLB's editorial recap as a document — the headline over a
 * hairline, the article's paragraphs, and "Source: MLB" (owner, 2026-10-19). Nothing
 * else: no linescore and no score (owner, 2026-10-14: "Recap should have nothing").
 * Every pairing draws the same document at the content width. The text arrives as
 * plain paragraphs (markup stripped at ingest, `mapRecap`), so nothing here renders HTML.
 * Shown only for a game with a recap — `roomsForPhase` keeps the tab away otherwise.
 * With Hide Scores on it is headed "Recap" (`recapHeading`; game-rooms A4
 * `recap-hidden-nonotice-mobile`, S75): MLB's headline tells the result, the article below
 * reads unchanged for whoever opens it.
 */
export function RecapRoom({ game, recap }: { game: { gamePk: number };
	recap: NonNullable<GamePayload["recap"]>; })
{
	const scoresHidden = useScoresHidden(game);
	return (
		<Stack component="article" gap={16} px={8} pt={8} aria-label="Recap">
			<Title
				order={2}
				fz={22}
				lh={1.3}
				pb={12}
				style={{
					borderBottom: "1px solid var(--bt-hairline)",
				}}
			>
				{recapHeading(recap, scoresHidden)}
			</Title>
			{recap.text.split("\n\n").map((paragraph, i) => (
				<Text key={i} fz={14} lh={1.55}>
					{paragraph}
				</Text>
			))}
			<Text fz={11} c="var(--bt-muted)">Source: MLB</Text>
		</Stack>
	);
}
