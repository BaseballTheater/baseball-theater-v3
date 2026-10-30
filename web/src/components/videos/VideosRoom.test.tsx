/**
 * S69: the Videos room on 823823's 40 recorded videos (`fixtures/game-823823.json`),
 * impact-ranked as the server sends them.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rankHighlightsByImpact } from "@bt/domain";
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
		highlights: highlights ?? rankHighlightsByImpact(snapshot.highlights) as GamePayload["highlights"],
	};
}

function renderRoom(variant: LayoutVariant = "mobile", g: GamePayload = game(), onPlay = vi.fn())
{
	render(
		<MantineProvider>
			<VideosRoom game={g} variant={variant} onPlay={onPlay} />
		</MantineProvider>,
	);
	return onPlay;
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
		const grid = screen.getByTestId("videos-grid");
		expect(getComputedStyle(grid).getPropertyValue("--sg-cols")).toBe(cols);
		expect(cardTitles()).toEqual(game().highlights.map((h) => h.title));
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
		await user.click(screen.getByText("List"));
		expect(screen.queryByTestId("videos-grid")).toBeNull();
		const rows = within(screen.getByTestId("videos-list")).getAllByTestId("video-card");
		expect(rows).toHaveLength(40);
		expect(rows.every((r) => r.dataset.layout === "list")).toBe(true);
		await user.click(screen.getByText("Grid"));
		expect(screen.getByTestId("videos-grid")).toBeInTheDocument();
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
		const all = game().highlights.map((h) => h.title);
		expect(cardTitles()).toEqual(all);
		await user.click(screen.getByRole("button", {
			name: "Featured team",
		}));
		expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["All teams", "CHC", "MIA"]);
		await user.click(screen.getByRole("menuitem", {
			name: "MIA",
		}));
		const marlins = game().highlights.filter((h) => h.teamIds?.includes(146)).map((h) => h.title);
		expect(cardTitles()).toEqual(marlins);
		await user.click(screen.getByRole("checkbox", {
			name: "Stat / viz",
		}));
		expect(cardTitles()).toContain("Breaking down Kyle Stowers' home run");
		expect(cardTitles()).not.toContain("Kyle Stowers' solo home run (19)");
		expect(cardTitles().every((t) => marlins.includes(t))).toBe(true);
		await user.click(screen.getByRole("checkbox", {
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

	it("no Filter button renders (A1)", () =>
	{
		renderRoom();
		expect(screen.queryByRole("button", {
			name: /^Filters?$/,
		})).toBeNull();
		expect(screen.queryByText(/^Filters?$/)).toBeNull();
	});

	it("onPlay: choosing a card calls onPlay with that video", async () =>
	{
		const user = userEvent.setup();
		const onPlay = renderRoom();
		const first = game().highlights[0]!;
		await user.click(screen.getByRole("button", {
			name: `Play ${first.title}`,
		}));
		expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({
			id: first.id,
		}));
	});
});
