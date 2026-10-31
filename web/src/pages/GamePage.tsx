import { Stack, Tabs } from "@mantine/core";
import { useNavigate, useParams } from "react-router-dom";
import { useCachedGame, useGame } from "../api/game.js";
import { useLiveGame } from "../api/live.js";
import { BoxRoom } from "../components/game/BoxRoom.js";
import { GameTopBar } from "../components/game/GameTopBar.js";
import { LiveRoom } from "../components/game/LiveRoom.js";
import { RecapRoom } from "../components/game/RecapRoom.js";
import { PlaysPanel } from "../components/pitch/PlaysPanel.js";
import { VideosRoom } from "../components/videos/VideosRoom.js";
import { ViewState } from "../components/ViewState.js";
import { FooterMeta } from "../layout/FooterMeta.js";
import type { LayoutVariant } from "../layout/variant.js";
import {
	gamePhase, openingRoom, roomsForPhase,
} from "@bt/domain";
import { roomLabel } from "../components/game/format.js";
import { useSettings } from "../settings/store.js";

/**
 * One game: the game top bar (in place of the app header, S60), the room tabs
 * across the full width at every pairing (S56 game-rooms A2), and the room.
 * `variant` comes from the layout host; rooms take their tablet and desktop
 * layouts from it as they're built (S63/S64 and on).
 */
export function GamePage({ variant }: { variant: LayoutVariant })
{
	const { gamePk, tab } = useParams();
	const navigate = useNavigate();
	// A game in its window streams (S19); the stream then owns its freshness, so the query stops refetching.
	const streaming = useLiveGame(Number(gamePk), useCachedGame(Number(gamePk))?.windowMode === "active");
	const {
		data: game, error, refetch,
	} = useGame(Number(gamePk), streaming);
	// Signed out, the store holds the house defaults, so games open on the default room.
	const { opensFirst } = useSettings();

	if (error)
	{
		return <ViewState kind="error" title="Couldn't load this room" onRetry={() => void refetch()} />;
	}
	if (!game)
	{
		return <ViewState kind="loading" />;
	}

	const phase = gamePhase(game.status.codedGameState);
	// Recap only when MLB has published one (S10).
	const hasRecap = game.recap !== undefined;
	const rooms = roomsForPhase(phase, hasRecap);
	// With no room in the URL, the user's Opens First; a room this game hides
	// (Live on a final game, Recap without a recap) opens the default room instead.
	const active = openingRoom(tab, opensFirst, phase, hasRecap);

	return (
		<Stack gap="xs" data-variant={variant}>
			<GameTopBar
				away={game.teams.away.abbreviation}
				home={game.teams.home.abbreviation}
				officialDate={game.officialDate}
				live={phase === "live"}
			/>

			{/* Only the open room is mounted: a hidden room (Plays opens an at-bat, Live replays pitches) costs nothing. */}
			<Tabs
				keepMounted={false}
				value={active}
				onChange={(value) =>
				{
					if (value)
					{
						void navigate(`/game/${game.gamePk}/${value}`);
					}
				}}
			>
				<Tabs.List
					justify="space-between"
					style={{
						flexWrap: "nowrap",
						overflowX: "auto",
					}}
				>
					{rooms.map((room) => (
						<Tabs.Tab key={room} value={room}>
							{roomLabel(room)}
						</Tabs.Tab>
					))}
				</Tabs.List>

				<Tabs.Panel value="videos" pt="md">
					<VideosRoom game={game} variant={variant} />
				</Tabs.Panel>

				{rooms.includes("live") ? (
					<Tabs.Panel value="live" pt="md">
						<LiveRoom game={game} variant={variant} />
					</Tabs.Panel>
				) : null}

				<Tabs.Panel value="plays" pt="md">
					<PlaysPanel game={game} />
				</Tabs.Panel>

				<Tabs.Panel value="box" pt="md">
					<BoxRoom game={game} variant={variant} />
				</Tabs.Panel>

				{game.recap && rooms.includes("recap") ? (
					<Tabs.Panel value="recap" pt="md">
						<RecapRoom recap={game.recap} />
					</Tabs.Panel>
				) : null}
			</Tabs>
			<FooterMeta fetchedAt={game.fetchedAt} />
		</Stack>
	);
}
