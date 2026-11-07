import {
	Box, SimpleGrid, Stack, Text,
} from "@mantine/core";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { scoreboardRows } from "@bt/domain";
import { useScheduleDay } from "../api/schedule.js";
import { useScoreboardDefaultDate } from "../api/scoreboardDate.js";
import type { ScheduleDayPayload } from "../api/schedule.js";
import { ViewState } from "../components/ViewState.js";
import { queryScreen } from "../components/queryScreen.js";
import { CollapsedBar } from "../components/scoreboard/CollapsedBar.js";
import { DayDigest } from "../components/scoreboard/DayDigest.js";
import { DateControl } from "../components/scoreboard/DateControl.js";
import { ScoreboardModule } from "../components/scoreboard/ScoreboardModule.js";
import { formatDate } from "../format/datetime.js";
import { FooterMeta } from "../layout/FooterMeta.js";
import type { LayoutVariant } from "../layout/variant.js";
import { useSettings } from "../settings/store.js";

/**
 * The day's games under their `GAMES — SEP 21, 2026` label, or the empty sentence. With
 * Collapse Non-Favorites on, `scoreboardRows` folds games without a favorite team into
 * `CollapsedBar`s after the favorites; a bar opens to its full module when chosen. While
 * anything is collapsed, a favorite's module spans the whole row at medium and desktop
 * (owner, 2026-10-30: "on desktop, when the collapsed mode is on, make the favorite one
 * full-width").
 */
function Games({ day, variant }: { day: ScheduleDayPayload;
	variant: LayoutVariant; })
{
	const { favoriteTeamIds, collapseNonFavorites } = useSettings();
	const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
	if (day.games.length === 0)
	{
		return <ViewState kind="empty" message="No games scheduled for this date." />;
	}
	const rows = scoreboardRows(day.games, favoriteTeamIds, collapseNonFavorites);
	const wide = variant !== "mobile" && rows.some((row) => row.collapsed);
	return (
		<Stack gap="sm">
			<Text size="xs" fw={700} tt="uppercase">
				Games — {formatDate(day.date)}
			</Text>
			<SimpleGrid cols={variant === "mobile" ? 1 : 2} spacing="md" verticalSpacing="md" data-testid="scoreboard-grid">
				{rows.map(({ game, collapsed }) =>
				{
					if (collapsed && !expanded.has(game.gamePk))
					{
						return <CollapsedBar key={game.gamePk} game={game} onExpand={() => setExpanded(new Set(expanded).add(game.gamePk))} />;
					}
					return wide && !collapsed ? (
						<Box key={game.gamePk} data-testid="scoreboard-wide" style={{
							gridColumn: "1 / -1",
						}}
						>
							<ScoreboardModule game={game} />
						</Box>
					) : <ScoreboardModule key={game.gamePk} game={game} />;
				})}
			</SimpleGrid>
		</Stack>
	);
}

/**
 * The scoreboard (S31 frames; S66) for the URL's day, or, with none in the URL, the
 * server's default day (S111) — `ViewState`'s loading treatment until it is known.
 */
export function ScoreboardPage({ variant }: { variant: LayoutVariant })
{
	const { date } = useParams();
	return date ? <ScoreboardDay date={date} variant={variant} /> : <DefaultScoreboardDay variant={variant} />;
}

/** No day in the URL: ask for the default; it is MLB's today if the server can't say. */
function DefaultScoreboardDay({ variant }: { variant: LayoutVariant })
{
	const date = useScoreboardDefaultDate();
	return date ? <ScoreboardDay date={date} variant={variant} /> : <ViewState kind="loading" />;
}

/**
 * One day's scoreboard: the date control, then the day's games as
 * `ScoreboardModule`s — one column on mobile, two on medium and desktop, from the
 * host's `variant` — and the day digest under them (S71), or the loading, empty or
 * error state from `ViewState`. The
 * date control stays through every state so the reader can always move to another day.
 */
function ScoreboardDay({ date, variant }: { date: string;
	variant: LayoutVariant; })
{
	const {
		data: day, error, refetch,
	} = useScheduleDay(date);

	let body;
	// A failed background refetch keeps the day already shown (S28's one rule: a retired
	// version's 426 raises the update notice and leaves the screen readable).
	const screen = queryScreen({
		data: day,
		error,
	});
	if (screen === "error")
	{
		body = <ViewState kind="error" title="Couldn't load games" onRetry={() => void refetch()} />;
	}
	else if (screen === "loading" || !day)
	{
		body = <ViewState kind="loading" title={`${formatDate(date)} Scoreboard`} />;
	}
	else
	{
		body = (
			<>
				<Games day={day} variant={variant} />
				<DayDigest date={day.date} variant={variant} />
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
