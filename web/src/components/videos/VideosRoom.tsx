import {
	Button, Chip, Group, Menu, SegmentedControl, SimpleGrid, Stack, Text, TextInput,
} from "@mantine/core";
import { IconChevronDown, IconSearch } from "@tabler/icons-react";
import { useState } from "react";
import { filterHighlights } from "@bt/domain";
import type { GamePayload } from "../../api/game.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { ViewState } from "../ViewState.js";
import { VideoCard } from "./VideoCard.js";
import type { Video } from "./VideoCard.js";

/** Grid columns by pairing (game-shell Videos frames: two, three, four). */
const COLUMNS: Readonly<Record<LayoutVariant, number>> = {
	mobile: 2,
	medium: 3,
	desktop: 4,
};

/**
 * The Featured team quick filter: a chip that opens a menu of the game's two teams, plus
 * "All teams" to clear it. Nothing is chosen until the reader picks a team (owner,
 * 2026-10-30: "One of the game's two teams and the default filter value should be none");
 * once chosen the chip names the team.
 */
function FeaturedTeam({
	game, teamId, onChange,
}: { game: GamePayload;
	teamId: number | null;
	onChange: (teamId: number | null) => void; })
{
	const { away, home } = game.teams;
	const chosen = [away, home].find((team) => team.id === teamId);
	return (
		<Menu position="bottom-start">
			<Menu.Target>
				<Button
					size="compact-xs"
					radius="xl"
					variant={chosen ? "light" : "default"}
					fw={400}
					// Drawn like its Stat / viz neighbour, an outline chip, rather than a solid button.
					styles={{
						root: {
							background: chosen ? undefined : "transparent",
							borderColor: "var(--mantine-color-dark-4)",
						},
					}}
					rightSection={<IconChevronDown size={12} />}
					aria-label={chosen ? `Featured team: ${chosen.abbreviation}` : "Featured team"}
				>
					{chosen ? chosen.abbreviation : "Featured team"}
				</Button>
			</Menu.Target>
			<Menu.Dropdown>
				<Menu.Item onClick={() => onChange(null)}>All teams</Menu.Item>
				{[away, home].map((team) => <Menu.Item key={team.id} onClick={() => onChange(team.id)}>{team.abbreviation}</Menu.Item>)}
			</Menu.Dropdown>
		</Menu>
	);
}

/**
 * The Videos room (S69; game-shell `game-videos-*` frames, A1): the game's videos in
 * impact order (`rankHighlightsByImpact`, server-side) under "Impact-sorted videos", a
 * full-width search, the **Featured team** (`FeaturedTeam`) and **Stat / viz** quick filters, and a
 * Grid / List toggle. The grid has 2 / 3 / 4 columns at mobile / medium / desktop from
 * the host's `variant`; List shows the same `VideoCard`s as rows. Filtering is
 * `filterHighlights` (packages/domain), which never reorders. No `Filter` button at
 * launch (A1). Choosing a video calls `onPlay`; the player is S70's.
 */
export function VideosRoom({
	game, variant, onPlay,
}: { game: GamePayload;
	variant: LayoutVariant;
	onPlay: (video: Video) => void; })
{
	const [query, setQuery] = useState("");
	const [teamId, setTeamId] = useState<number | null>(null);
	const [statViz, setStatViz] = useState(false);
	const [layout, setLayout] = useState<"grid" | "list">("grid");

	if (game.highlights.length === 0)
	{
		return <ViewState kind="empty" message="No videos yet." />;
	}

	const videos = filterHighlights(game.highlights, {
		query,
		teamId,
		statViz,
	});
	const cards = videos.map((video) => <VideoCard key={video.id} video={video} layout={layout} onPlay={onPlay} />);

	return (
		<Stack gap="md">
			<Text size="xs" fw={700} tt="uppercase">Impact-sorted videos</Text>
			<TextInput
				aria-label="Search videos"
				placeholder="Search videos..."
				leftSection={<IconSearch size={18} />}
				value={query}
				onChange={(event) => setQuery(event.currentTarget.value)}
			/>
			<Group justify="space-between" wrap="nowrap">
				<Group gap={8} wrap="nowrap">
					<FeaturedTeam game={game} teamId={teamId} onChange={setTeamId} />
					<Chip size="xs" variant="outline" checked={statViz} onChange={setStatViz}>Stat / viz</Chip>
				</Group>
				<SegmentedControl
					size="xs"
					aria-label="Layout"
					color="primary"
					value={layout}
					onChange={(value) => setLayout(value as "grid" | "list")}
					data={[
						{
							value: "grid",
							label: "Grid",
						},
						{
							value: "list",
							label: "List",
						},
					]}
				/>
			</Group>
			{videos.length === 0 ? <ViewState kind="empty" message="No videos match." /> : null}
			{videos.length > 0 && layout === "grid" ? (
				<SimpleGrid cols={COLUMNS[variant]} spacing="md" verticalSpacing="lg" data-testid="videos-grid">
					{cards}
				</SimpleGrid>
			) : null}
			{videos.length > 0 && layout === "list" ? <Stack gap="sm" data-testid="videos-list">{cards}</Stack> : null}
		</Stack>
	);
}
