import {
	Chip, Group, SegmentedControl, SimpleGrid, Stack, Text, TextInput,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useState } from "react";
import { featuredTeamId, filterHighlights } from "@bt/domain";
import type { GamePayload } from "../../api/game.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { useSettings } from "../../settings/store.js";
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
 * The Videos room (S69; game-shell `game-videos-*` frames, A1): the game's videos in
 * impact order (`rankHighlightsByImpact`, server-side) under "Impact-sorted videos", a
 * full-width search, the **Featured team** and **Stat / viz** quick filters, and a
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
	const { favoriteTeamIds } = useSettings();
	const [query, setQuery] = useState("");
	const [featured, setFeatured] = useState(false);
	const [statViz, setStatViz] = useState(false);
	const [layout, setLayout] = useState<"grid" | "list">("grid");

	if (game.highlights.length === 0)
	{
		return <ViewState kind="empty" message="No videos yet." />;
	}

	const videos = filterHighlights(game.highlights, {
		query,
		teamId: featured ? featuredTeamId(favoriteTeamIds, game.teams.away.id, game.teams.home.id) : null,
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
					<Chip size="xs" variant="outline" checked={featured} onChange={setFeatured}>Featured team</Chip>
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
