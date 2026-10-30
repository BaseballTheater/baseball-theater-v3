import {
	SimpleGrid, Stack, Text,
} from "@mantine/core";
import { useParams } from "react-router-dom";
import { useScheduleDay } from "../api/schedule.js";
import type { ScheduleDayPayload } from "../api/schedule.js";
import { ViewState } from "../components/ViewState.js";
import { DateControl } from "../components/scoreboard/DateControl.js";
import { ScoreboardModule } from "../components/scoreboard/ScoreboardModule.js";
import { formatDate } from "../format/datetime.js";
import { FooterMeta } from "../layout/FooterMeta.js";
import type { LayoutVariant } from "../layout/variant.js";

/** The day's games under their `GAMES — SEP 21, 2026` label, or the empty sentence. */
function Games({ day, variant }: { day: ScheduleDayPayload;
	variant: LayoutVariant; })
{
	if (day.games.length === 0)
	{
		return <ViewState kind="empty" message="No games scheduled for this date." />;
	}
	return (
		<Stack gap="sm">
			<Text size="xs" fw={700} tt="uppercase">
				Games — {formatDate(day.date)}
			</Text>
			<SimpleGrid cols={variant === "mobile" ? 1 : 2} spacing="md" verticalSpacing="md" data-testid="scoreboard-grid">
				{day.games.map((game) => <ScoreboardModule key={game.gamePk} game={game} />)}
			</SimpleGrid>
		</Stack>
	);
}

/**
 * The scoreboard (S31 frames; S66): the date control, then the day's games as
 * `ScoreboardModule`s — one column on mobile, two on medium and desktop, from the
 * host's `variant` — or the loading, empty or error state from `ViewState`. The
 * date control stays through every state so the reader can always move to another day.
 */
export function ScoreboardPage({ variant }: { variant: LayoutVariant })
{
	const { date = "2024-07-04" } = useParams();
	const {
		data: day, error, refetch,
	} = useScheduleDay(date);

	let body;
	if (error)
	{
		body = <ViewState kind="error" title="Couldn't load games" onRetry={() => void refetch()} />;
	}
	else if (!day)
	{
		body = <ViewState kind="loading" title={`${formatDate(date)} Scoreboard`} />;
	}
	else
	{
		body = (
			<>
				<Games day={day} variant={variant} />
				<FooterMeta fetchedAt={day.fetchedAt} />
			</>
		);
	}

	return (
		<Stack gap="md">
			<DateControl date={date} />
			{body}
		</Stack>
	);
}
