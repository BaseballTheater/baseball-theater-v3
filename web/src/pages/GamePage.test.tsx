import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, render, screen, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MemoryRouter, Route, Routes,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { GamePayload } from "../api/game.js";
import { gameKey } from "../api/game.js";
import type { LayoutVariant } from "../layout/variant.js";
import { createQueryClient } from "../api/queryClient.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { GamePage } from "./GamePage.js";
import type { OpensFirst } from "@bt/domain";
import { hydrateSettings, resetSettings } from "../settings/store.js";
import { resetVersionNotice } from "../api/versionNotice.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

/** A committed fixture snapshot, shaped as the API serves it. */
function fixture(gamePk: number): GamePayload
{
	const snapshot = JSON.parse(readFileSync(join(FIXTURES, `game-${gamePk}.json`), "utf8")) as Omit<GamePayload, "fetchedAt" | "windowMode">;
	return {
		...snapshot,
		fetchedAt: "2024-07-04T18:00:00.000Z",
		windowMode: "cache",
	} as GamePayload;
}

function renderGame(path: string, variant: LayoutVariant = "mobile", client = createQueryClient())
{
	return render(
		<MantineProvider>
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={[path]}>
					<Routes>
						<Route path="/game/:gamePk" element={<GamePage variant={variant} />} />
						<Route path="/game/:gamePk/:tab" element={<GamePage variant={variant} />} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

function serve(game: GamePayload)
{
	const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(game)));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

async function tabNames(): Promise<string[]>
{
	await screen.findByTestId("game-topbar");
	// The first tablist is the room tabs; a room (Plays) may hold tabs of its own.
	const rooms = screen.getAllByRole("tablist")[0]!;
	return within(rooms).getAllByRole("tab").map((t) => t.textContent ?? "");
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	resetSettings();
	resetVersionNotice();
});

/** Hydrates the settings store as a signed-in account whose Opens First is `room`. */
async function opensFirst(room: OpensFirst): Promise<void>
{
	vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({
		favoriteTeamIds: [],
		opensFirst: room,
		version: 1,
	}))));
	await hydrateSettings("test-user");
}

describe("GamePage Opens First (S6)", () =>
{
	it("Opens First: a live game opens on the chosen room when its phase offers it", async () =>
	{
		await opensFirst("live");
		serve(fixture(745001));
		renderGame("/game/745001");
		await tabNames();
		expect(screen.getByRole("tab", {
			name: "Live",
		})).toHaveAttribute("aria-selected", "true");
	});

	it("Opens First: a final game has no Live, so it falls back to resolveRoom's default (Videos)", async () =>
	{
		await opensFirst("live");
		serve(fixture(744834));
		renderGame("/game/744834");
		await tabNames();
		expect(screen.getByRole("tab", {
			name: "Videos",
		})).toHaveAttribute("aria-selected", "true");
	});

	it("Opens First: Box opens Box on a final game, and a room in the URL still wins", async () =>
	{
		await opensFirst("box");
		serve(fixture(744834));
		const { unmount } = renderGame("/game/744834");
		await tabNames();
		expect(screen.getByRole("tab", {
			name: "Box",
		})).toHaveAttribute("aria-selected", "true");
		unmount();

		renderGame("/game/744834/plays");
		await tabNames();
		expect(screen.getByRole("tab", {
			name: "Plays",
		})).toHaveAttribute("aria-selected", "true");
	});

	it("Opens First: signed out (house defaults), games open on Videos", async () =>
	{
		serve(fixture(745001));
		renderGame("/game/745001");
		await tabNames();
		expect(screen.getByRole("tab", {
			name: "Videos",
		})).toHaveAttribute("aria-selected", "true");
	});
});

describe("GamePage top bar (S40)", () =>
{
	it("shows back to that day's scoreboard, the matchup, and the date", async () =>
	{
		serve(fixture(744834));
		renderGame("/game/744834");

		const bar = within(await screen.findByTestId("game-topbar"));
		expect(bar.getByRole("link", {
			name: "Back to scoreboard",
		})).toHaveAttribute("href", "/games/2024-07-04");
		expect(bar.getByText("NYM @ WSH")).toBeInTheDocument();
		expect(bar.getByText("Jul 4, 2024")).toBeInTheDocument();
	});

	it("never shows the score, the venue, or the status", async () =>
	{
		serve(fixture(744834));
		renderGame("/game/744834");

		const barEl = await screen.findByTestId("game-topbar");
		const text = barEl.textContent ?? "";
		expect(text).not.toMatch(/0\s*[–-]\s*1/);
		expect(text).not.toContain("0 – 1");
		expect(text).not.toContain("0-1");
		expect(text).not.toContain("Nationals Park");
		expect(text).not.toContain("Final");
		// Nowhere on the page either — the header module is gone, not moved.
		expect(screen.queryByText(/0\s*[–-]\s*1/)).toBeNull();
		expect(screen.queryByText(/Nationals Park/)).toBeNull();
	});
});

describe("GamePage phase-aware tabs (S40)", () =>
{
	it("final 744834 (no recap yet): Videos, Plays, Box — no Live, no Recap (S10)", async () =>
	{
		serve(fixture(744834));
		renderGame("/game/744834");

		expect(await tabNames()).toEqual(["Videos", "Plays", "Box"]);
		expect(screen.queryByRole("tab", {
			name: "Live",
		})).toBeNull();
		expect(within(screen.getByTestId("game-topbar")).queryByText("LIVE")).toBeNull();
	});

	it("in-progress 745001: Videos, Live, Plays, Box — no Recap — and the LIVE indicator", async () =>
	{
		serve(fixture(745001));
		renderGame("/game/745001");

		expect(await tabNames()).toEqual(["Videos", "Live", "Plays", "Box"]);
		expect(screen.queryByRole("tab", {
			name: "Recap",
		})).toBeNull();
		expect(within(screen.getByTestId("game-topbar")).getByText("LIVE")).toBeInTheDocument();
	});

	it("pre-game copy: exactly Videos, Plays, Box and no live indicator", async () =>
	{
		const base = fixture(744834);
		serve({
			...base,
			status: {
				...base.status,
				abstractGameState: "Preview",
				codedGameState: "S",
				detailedState: "Scheduled",
			},
		});
		renderGame("/game/744834");

		expect(await tabNames()).toEqual(["Videos", "Plays", "Box"]);
		expect(screen.queryByText("LIVE")).toBeNull();
	});

	it("a room the phase hides falls back to Videos", async () =>
	{
		serve(fixture(744834));
		renderGame("/game/744834/live");

		await screen.findByTestId("game-topbar");
		expect(screen.getByRole("tab", {
			name: "Videos",
		})).toHaveAttribute("aria-selected", "true");
		expect(screen.queryByText(/Live feed projection/)).toBeNull();
		expect(screen.queryByText(/outs$/)).toBeNull();
	});
});

describe("GamePage room states (S40)", () =>
{
	it("shows a loader while the game request is pending", () =>
	{
		vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
		renderGame("/game/744834");

		expect(screen.getByLabelText("Loading")).toBeInTheDocument();
	});

	it("shows the error with Retry, and Retry asks again", async () =>
	{
		const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({}, 503)));
		vi.stubGlobal("fetch", fetchMock);
		renderGame("/game/744834");

		const alert = within(await screen.findByRole("alert"));
		expect(alert.getByText("Couldn't load this room")).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await userEvent.click(alert.getByRole("button", {
			name: "Retry",
		}));
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("readable: a failed refetch (a retired version's 426) keeps the room on screen, not the error (S28's one rule)", async () =>
	{
		const fetchMock = serve(fixture(744834));
		const client = createQueryClient();
		renderGame("/game/744834/box", "mobile", client);
		await tabNames();
		const before = screen.getAllByRole("tablist")[0]!.textContent;
		fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({
			error: "version_unsupported",
		}, 426)));
		await act(() => client.refetchQueries({
			queryKey: gameKey(744834),
		}));
		expect(client.getQueryState(gameKey(744834))?.status).toBe("error");
		// The query tells the page on its next tick; let that render land before looking.
		await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
		expect(screen.getAllByRole("tablist")[0]!.textContent).toBe(before);
		expect(screen.getByTestId("game-topbar")).toBeInTheDocument();
		expect(screen.queryByRole("alert")).toBeNull();
	});
});

describe("GamePage room tabs (S60, S56 game-rooms A2)", () =>
{
	it("span the full width at medium on Live", async () =>
	{
		serve(fixture(745001));
		const { container } = renderGame("/game/745001/live", "medium");
		await tabNames();
		expect(screen.getByRole("tab", {
			name: "Live",
		})).toHaveAttribute("aria-selected", "true");
		expect(container.querySelector("[data-variant]")).toHaveAttribute("data-variant", "medium");
		// Mantine's Tabs.List spreads the tabs edge to edge through `--tabs-justify`.
		expect(screen.getAllByRole("tablist")[0]!.getAttribute("style")).toMatch(/--tabs-justify:\s*space-between/);
	});

	it("shows the footer with the payload's fetch age", async () =>
	{
		serve(fixture(744834));
		renderGame("/game/744834");
		await tabNames();
		expect(screen.getByRole("contentinfo")).toHaveTextContent(/^Fetched \d+[smhd] ago · baseball\.theater$/);
	});
});
