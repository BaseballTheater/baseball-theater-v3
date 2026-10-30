import {
	Button, Checkbox, Drawer, Group, Menu, Radio, ScrollArea, SegmentedControl, SimpleGrid, Stack, Text, TextInput, VisuallyHidden,
} from "@mantine/core";
import {
	IconArrowsSort, IconChevronDown, IconLayoutGrid, IconList, IconSearch,
} from "@tabler/icons-react";
import { useState } from "react";
import { filterHighlights, sortHighlights } from "@bt/domain";
import type { HighlightSort } from "@bt/domain";
import type { GamePayload } from "../../api/game.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { ViewState } from "../ViewState.js";
import { FilterPill, QuickFilters } from "./QuickFilters.js";
import { VideoCard } from "./VideoCard.js";
import type { Video } from "./VideoCard.js";

/** Grid columns by pairing (game-shell Videos frames: two, three, four). */
const COLUMNS: Readonly<Record<LayoutVariant, number>> = {
	mobile: 2,
	medium: 3,
	desktop: 4,
};

const SORT_LABELS: Readonly<Record<HighlightSort, string>> = {
	impact: "Impact",
	newest: "Newest",
	oldest: "Oldest",
};

/** The quick filters' values; the drawer edits a copy and applies it whole. */
type Filters = {
	teamId: number | null;
	statViz: boolean;
};

/**
 * The Featured team quick filter: a pill that opens a menu of the game's two teams, plus
 * "All teams" to clear it. Nothing is chosen until the reader picks a team (owner,
 * 2026-10-30: "One of the game's two teams and the default filter value should be none");
 * once chosen the pill names the team.
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
				<FilterPill active={Boolean(chosen)} rightSection={<IconChevronDown size={12} />} aria-label={chosen ? `Featured team: ${chosen.abbreviation}` : "Featured team"}>
					{chosen ? chosen.abbreviation : "Featured team"}
				</FilterPill>
			</Menu.Target>
			<Menu.Dropdown>
				<Menu.Item onClick={() => onChange(null)}>All teams</Menu.Item>
				{[away, home].map((team) => <Menu.Item key={team.id} onClick={() => onChange(team.id)}>{team.abbreviation}</Menu.Item>)}
			</Menu.Dropdown>
		</Menu>
	);
}

/**
 * Every filter in a drawer from the bottom (owner, 2026-10-30: "a drawer from the bottom
 * showing all the filters … a fixed apply button and a scrolling list of filters"). It
 * edits a copy of the filters; Apply sets them and closes, dismissing discards.
 */
function FilterDrawer({
	game, opened, filters, onApply, onClose,
}: { game: GamePayload;
	opened: boolean;
	filters: Filters;
	onApply: (filters: Filters) => void;
	onClose: () => void; })
{
	const [draft, setDraft] = useState(filters);
	const { away, home } = game.teams;
	return (
		<Drawer
			opened={opened}
			onClose={onClose}
			position="bottom"
			title="Filters"
			styles={{
				// As tall as its filters (up to most of the screen), not Mantine's full-height default.
				content: {
					height: "auto",
					maxHeight: "85dvh",
				},
				body: {
					display: "flex",
					flexDirection: "column",
					gap: 16,
				},
			}}
		>
			<ScrollArea.Autosize mah="55dvh" type="auto" data-testid="filter-drawer-list">
				<Stack gap="lg">
					<Radio.Group
						label="Featured team"
						value={draft.teamId === null ? "" : String(draft.teamId)}
						onChange={(value) => setDraft({
							...draft,
							teamId: value ? Number(value) : null,
						})}
					>
						<Stack gap="xs" mt="xs">
							<Radio value="" label="All teams" />
							{[away, home].map((team) => <Radio key={team.id} value={String(team.id)} label={team.abbreviation} />)}
						</Stack>
					</Radio.Group>
					<Checkbox
						label="Stat / viz"
						checked={draft.statViz}
						onChange={(event) => setDraft({
							...draft,
							statViz: event.currentTarget.checked,
						})}
					/>
				</Stack>
			</ScrollArea.Autosize>
			<Button fullWidth onClick={() => onApply(draft)}>Apply</Button>
		</Drawer>
	);
}

/**
 * The Videos room (S69; game-shell `game-videos-*` frames, A1): the game's videos under
 * "Impact-sorted videos", a full-width search, then one row: the quick filters on the
 * left (`QuickFilters`: as many as fit, then a Filters button opening `FilterDrawer`), and
 * on the right the sort (`sortHighlights`; impact first, the server's
 * `rankHighlightsByImpact` order) and the Grid / List icons (owner, 2026-10-30). The grid
 * has 2 / 3 / 4 columns at mobile / medium / desktop from the host's `variant`; List
 * shows the same `VideoCard`s as rows. Filtering is `filterHighlights` (packages/domain).
 * Choosing a video calls `onPlay`; the player is S70's.
 */
export function VideosRoom({
	game, variant, onPlay,
}: { game: GamePayload;
	variant: LayoutVariant;
	onPlay: (video: Video) => void; })
{
	const [query, setQuery] = useState("");
	const [filters, setFilters] = useState<Filters>({
		teamId: null,
		statViz: false,
	});
	const [drawer, setDrawer] = useState(false);
	const [sort, setSort] = useState<HighlightSort>("impact");
	const [layout, setLayout] = useState<"grid" | "list">("grid");

	if (game.highlights.length === 0)
	{
		return <ViewState kind="empty" message="No videos yet." />;
	}

	const videos = sortHighlights(filterHighlights(game.highlights, {
		query,
		...filters,
	}), sort);
	const cards = videos.map((video) => <VideoCard key={video.id} video={video} layout={layout} onPlay={onPlay} />);
	const pills = [
		{
			key: "team",
			active: filters.teamId !== null,
			node: <FeaturedTeam game={game} teamId={filters.teamId} onChange={(teamId) => setFilters({
				...filters,
				teamId,
			})}
			/>,
		},
		{
			key: "statViz",
			active: filters.statViz,
			node: (
				<FilterPill active={filters.statViz} aria-pressed={filters.statViz} onClick={() => setFilters({
					...filters,
					statViz: !filters.statViz,
				})}
				>
					Stat / viz
				</FilterPill>
			),
		},
	];

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
			<Group gap={8} wrap="nowrap" align="center">
				<QuickFilters pills={pills} onMore={() => setDrawer(true)} />
				<Menu position="bottom-end">
					<Menu.Target>
						<FilterPill leftSection={<IconArrowsSort size={14} />} aria-label={`Sort: ${SORT_LABELS[sort]}`}>
							{SORT_LABELS[sort]}
						</FilterPill>
					</Menu.Target>
					<Menu.Dropdown>
						{(Object.keys(SORT_LABELS) as HighlightSort[]).map((value) => (
							<Menu.Item key={value} onClick={() => setSort(value)}>{SORT_LABELS[value]}</Menu.Item>
						))}
					</Menu.Dropdown>
				</Menu>
				<SegmentedControl
					size="xs"
					aria-label="Layout"
					color="primary"
					value={layout}
					onChange={(value) => setLayout(value as "grid" | "list")}
					style={{
						flexShrink: 0,
					}}
					data={[
						{
							value: "grid",
							label: <><IconLayoutGrid size={16} style={{
								display: "block",
							}}
							/><VisuallyHidden>Grid</VisuallyHidden></>,
						},
						{
							value: "list",
							label: <><IconList size={16} style={{
								display: "block",
							}}
							/><VisuallyHidden>List</VisuallyHidden></>,
						},
					]}
				/>
			</Group>
			{videos.length === 0 ? <ViewState kind="empty" message="No videos match." /> : null}
			{videos.length > 0 && layout === "grid" ? (
				<SimpleGrid cols={COLUMNS[variant]} spacing="md" verticalSpacing="lg" data-testid="videos-grid" style={{
					alignItems: "start",
				}}
				>
					{cards}
				</SimpleGrid>
			) : null}
			{videos.length > 0 && layout === "list" ? <Stack gap="sm" data-testid="videos-list">{cards}</Stack> : null}
			{drawer ? <FilterDrawer game={game} opened filters={filters} onApply={(next) =>
			{
				setFilters(next);
				setDrawer(false);
			}} onClose={() => setDrawer(false)}
			/> : null}
		</Stack>
	);
}
