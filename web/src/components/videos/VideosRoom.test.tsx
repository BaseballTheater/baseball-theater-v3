/**
 * S69: the Videos room on 823823's 40 recorded videos (`fixtures/game-823823.json`),
 * impact-ranked as the server sends them.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	groupHighlights, rankHighlightsByImpact, sortHighlights,
} from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import {
	cleanup, render, screen, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { GamePayload } from "../../api/game.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { resetSettings } from "../../settings/store.js";
import { VideosRoom } from "./VideosRoom.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");

function game(highlights?: GamePayload["highlights"]): GamePayload
{
	const snapshot = JSON.parse(readFileSync(join(FIXTURES, "game-823823.json"), "utf8")) as GamePayload;
	return {
		...snapshot,
		// The API always sends plays (a required field); none here, so no card gets a play link (S97).
		plays: [],
		highlights: highlights ?? rankHighlightsByImpact(snapshot.highlights) as GamePayload["highlights"],
	};
}

function renderRoom(variant: LayoutVariant = "mobile", g: GamePayload = game())
{
	render(
		<MantineProvider>
			<VideosRoom game={g} variant={variant} />
		</MantineProvider>,
	);
}

/** Titles in the order the room shows them: by group, each group in the order given. */
function grouped(highlights: GamePayload["highlights"]): string[]
{
	return groupHighlights(highlights).flatMap((g) => g.highlights.map((h) => h.title));
}

function cardTitles(): string[]
{
	return screen.getAllByTestId("video-card").map((c) => c.getAttribute("aria-label")!.replace(/^Play /, ""));
}

afterEach(() =>
{
	cleanup();
	resetSettings();
});

describe("VideosRoom layout (S69)", () =>
{
	it.each([
		["mobile", "2"],
		["medium", "3"],
		["desktop", "4"],
	] as const)("columns: %s shows a %s-column grid of every video, impact order kept", (variant, cols) =>
	{
		renderRoom(variant);
		for (const grid of screen.getAllByTestId("videos-grid"))
		{
			expect(getComputedStyle(grid).getPropertyValue("--sg-cols")).toBe(cols);
		}
		expect(cardTitles()).toEqual(grouped(game().highlights));
	});

	it("each card shows the still's duration, the title and a Kind · date meta line", () =>
	{
		renderRoom();
		const recap = within(screen.getByRole("button", {
			name: "Play Conforto clubs Cubs' 200th homer in close win",
		}));
		expect(recap.getByTestId("video-duration")).toHaveTextContent("3:06");
		expect(recap.getByText(/^Recap · (Sep 5|Sep 6), 2026$/)).toBeInTheDocument();
	});

	it("list: List shows the same VideoCards as rows; Grid brings the grid back", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		await user.click(screen.getByRole("radio", {
			name: "List",
		}));
		expect(screen.queryByTestId("videos-grid")).toBeNull();
		const rows = screen.getAllByTestId("videos-list").flatMap((list) => within(list).getAllByTestId("video-card"));
		expect(rows).toHaveLength(40);
		expect(rows.every((r) => r.dataset.layout === "list")).toBe(true);
		await user.click(screen.getByRole("radio", {
			name: "Grid",
		}));
		expect(screen.getAllByTestId("videos-grid").length).toBeGreaterThan(0);
	});

	it("groups: Pre-game, Game highlights, Statcast, Post-game, each headed; a group with nothing in it is left out", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		const groups = () => screen.getAllByTestId("videos-group").map((g) => g.getAttribute("aria-label"));
		expect(groups()).toEqual(["Pre-game", "Game highlights", "Statcast", "Post-game"]);
		expect(screen.getByText("Game highlights")).toBeInTheDocument();
		expect(within(screen.getByRole("region", {
			name: "Post-game",
		})).getByRole("button", {
			name: "Play Condensed Game: CHC@MIA - 9/5/26",
		})).toBeInTheDocument();
		await user.type(screen.getByRole("textbox", {
			name: "Search videos",
		}), "ABS challenge");
		expect(groups()).toEqual(["Game highlights"]);
	});

	it("groups collapse: each heading folds its group away and back; the others stay open", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		const heading = () => within(screen.getByRole("region", {
			name: "Statcast",
		})).getByRole("button", {
			name: /^Statcast \d+$/,
		});
		expect(heading()).toHaveAttribute("aria-expanded", "true");
		const all = cardTitles().length;
		await user.click(heading());
		expect(heading()).toHaveAttribute("aria-expanded", "false");
		expect(within(screen.getByRole("region", {
			name: "Statcast",
		})).queryAllByTestId("video-card")).toHaveLength(0);
		expect(cardTitles().length).toBeLessThan(all);
		expect(screen.getAllByTestId("videos-group")).toHaveLength(4);
		await user.click(heading());
		expect(cardTitles()).toHaveLength(all);
	});
});

describe("VideosRoom search and quick filters (S69)", () =>
{
	it("search: narrows to videos whose title or blurb matches, in impact order", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		await user.type(screen.getByRole("textbox", {
			name: "Search videos",
		}), "abs challenge");
		const titles = cardTitles();
		expect(titles).toHaveLength(5);
		expect(titles).toEqual(game().highlights.map((h) => h.title).filter((t) => titles.includes(t)));
		await user.clear(screen.getByRole("textbox", {
			name: "Search videos",
		}));
		await user.type(screen.getByRole("textbox", {
			name: "Search videos",
		}), "no such clip");
		expect(screen.getByText("No videos match.")).toBeInTheDocument();
	});

	it("quick filter: Featured team starts on none, narrows to the team picked from the game's two, and clears with All teams; Stat / viz the viz clips, together both", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		const all = grouped(game().highlights);
		expect(cardTitles()).toEqual(all);
		await user.click(screen.getByRole("button", {
			name: "Featured team",
		}));
		expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["All teams", "CHC", "MIA"]);
		await user.click(screen.getByRole("menuitem", {
			name: "MIA",
		}));
		const marlins = grouped(game().highlights.filter((h) => h.teamIds?.includes(146)));
		expect(cardTitles()).toEqual(marlins);
		await user.click(screen.getByRole("button", {
			name: "Stat / viz",
		}));
		expect(cardTitles()).toContain("Breaking down Kyle Stowers' home run");
		expect(cardTitles()).not.toContain("Kyle Stowers' solo home run (19)");
		expect(cardTitles().every((t) => marlins.includes(t))).toBe(true);
		await user.click(screen.getByRole("button", {
			name: "Stat / viz",
		}));
		await user.click(screen.getByRole("button", {
			name: "Featured team: MIA",
		}));
		await user.click(await screen.findByRole("menuitem", {
			name: "All teams",
		}));
		expect(cardTitles()).toEqual(all);
	});
});

describe("VideosRoom states and play (S69)", () =>
{
	it("empty: a game with no videos reads \"No videos yet.\"", () =>
	{
		renderRoom("mobile", game([]));
		expect(screen.getByText("No videos yet.")).toBeInTheDocument();
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	it("filters overflow: when every pill fits there is no Filters button", () =>
	{
		renderRoom();
		expect(within(screen.getByTestId("filter-row")).queryByRole("button", {
			name: "Filters",
		})).toBeNull();
		expect(within(screen.getByTestId("filter-row")).getAllByRole("button")).toHaveLength(2);
	});

	it("filters overflow: pills that don't fit move behind a last Filters button whose drawer lists every filter, applied with Apply", async () =>
	{
		// jsdom lays nothing out: each pill 100px, the Filters button 60px, and the row room for one pill plus the button.
		const widths = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement)
		{
			return this.textContent === "Filters" ? 60 : 100;
		});
		const room = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(180);
		const user = userEvent.setup();
		renderRoom();
		const row = within(screen.getByTestId("filter-row"));
		expect(row.getAllByRole("button").map((b) => b.textContent)).toEqual(["Featured team", "Filters"]);
		await user.click(row.getByRole("button", {
			name: "Filters",
		}));
		const drawer = within(await screen.findByRole("dialog", {
			name: "Filters",
		}));
		expect(drawer.getByTestId("filter-drawer-list")).toBeInTheDocument();
		await user.click(drawer.getByRole("radio", {
			name: "MIA",
		}));
		await user.click(drawer.getByRole("checkbox", {
			name: "Stat / viz",
		}));
		expect(cardTitles()).toHaveLength(game().highlights.length);
		await user.click(drawer.getByRole("button", {
			name: "Apply",
		}));
		const marlinsViz = cardTitles();
		expect(marlinsViz).toContain("Breaking down Kyle Stowers' home run");
		expect(marlinsViz).not.toContain("Kyle Stowers' solo home run (19)");
		expect(marlinsViz.length).toBeLessThan(game().highlights.length);
		// Dismissing the drawer discards its edits.
		await user.click(row.getByRole("button", {
			name: "Filters",
		}));
		const again = within(await screen.findByRole("dialog", {
			name: "Filters",
		}));
		await user.click(again.getByRole("radio", {
			name: "All teams",
		}));
		await user.keyboard("{Escape}");
		expect(cardTitles()).toEqual(marlinsViz);
		widths.mockRestore();
		room.mockRestore();
	});

	it("sort: Impact by default; Newest and Oldest reorder through sortHighlights, within each group", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		const impact = cardTitles();
		expect(impact).toEqual(grouped(game().highlights));
		await user.click(screen.getByRole("button", {
			name: "Sort: Impact",
		}));
		await user.click(await screen.findByRole("menuitem", {
			name: "Newest",
		}));
		const newest = grouped(sortHighlights(game().highlights, "newest"));
		expect(cardTitles()).toEqual(newest);
		expect(newest).not.toEqual(impact);
		await user.click(screen.getByRole("button", {
			name: "Sort: Newest",
		}));
		await user.click(await screen.findByRole("menuitem", {
			name: "Oldest",
		}));
		expect(cardTitles()).toEqual(grouped(sortHighlights(game().highlights, "oldest")));
	});

	it("onPlay: choosing a card plays that video in the player dialog (S70), with no link back to this game", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		const first = game().highlights[0]!;
		await user.click(screen.getByRole("button", {
			name: `Play ${first.title}`,
		}));
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByTestId("video-player")).toHaveTextContent(first.title);
		expect(within(dialog).queryByRole("link", {
			name: /Go to game/,
		})).toBeNull();
	});
});
