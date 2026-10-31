/**
 * S19: the game page follows a game in progress live — `fixtures/game-823823-live.json`
 * (top 3rd, CHC 1 · MIA 0) served as in its window, with a stand-in `WebSocket` that the
 * test pushes payloads through. Updates land in place: what the reader had open stays.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MemoryRouter, Route, Routes,
} from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import type { GamePayload } from "../api/game.js";
import { createQueryClient } from "../api/queryClient.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { createRenderCounter } from "../test/renderCount.js";
import { GamePage } from "./GamePage.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const read = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as GamePayload;

/** The mid-game moment as BT serves it in-window, with the game's recorded videos for the Videos room. */
function live(): GamePayload
{
	return {
		...read("game-823823-live.json"),
		highlights: read("game-823823.json").highlights,
		fetchedAt: "2026-09-05T20:57:20.000Z",
		windowMode: "active",
		version: 1,
	};
}

/** `live()` at `version`, moved to `inning` with `away` runs. */
function update(version: number, inning: number, away: number): GamePayload
{
	const game = live();
	return {
		...game,
		version,
		linescore: {
			...game.linescore!,
			currentInning: inning,
			inningState: "Bottom",
			isTopInning: false,
			teams: {
				...game.linescore!.teams,
				away: {
					...game.linescore!.teams.away,
					runs: away,
				},
			},
		},
	};
}

/** The browser WebSocket, stood in: every one opened is kept so the test can push to it. */
class FakeWebSocket
{
	static opened: FakeWebSocket[] = [];
	onopen: ((event: unknown) => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: ((event: unknown) => void) | null = null;
	readonly close = vi.fn();

	constructor(readonly url: string)
	{
		FakeWebSocket.opened.push(this);
	}

	static last(): FakeWebSocket
	{
		return FakeWebSocket.opened.at(-1)!;
	}
}

function push(game: GamePayload): Promise<void>
{
	return act(async () =>
	{
		FakeWebSocket.last().onmessage?.({
			data: JSON.stringify(game),
		});
	});
}

function renderGame(room: string, Wrap: (props: { children: React.ReactNode }) => React.ReactNode = ({ children }) => children)
{
	return render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={[`/game/823823/${room}`]}>
					<Wrap>
						<Routes>
							<Route path="/game/:gamePk/:tab" element={<GamePage variant="mobile" />} />
						</Routes>
					</Wrap>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

/** Waits for the page to load the game and open its socket. */
async function opened(): Promise<FakeWebSocket>
{
	await waitFor(() => expect(FakeWebSocket.opened).toHaveLength(1));
	return FakeWebSocket.last();
}

beforeEach(() =>
{
	FakeWebSocket.opened = [];
	vi.stubGlobal("WebSocket", FakeWebSocket);
	vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(live()))));
	vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
	vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
	// The Plays room scrolls an opened at-bat into view; jsdom has no scrolling.
	vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("GamePage live (S19)", () =>
{
	it("opens a WebSocket to /api/v1/games/:gamePk/live for a game in progress", async () =>
	{
		renderGame("live");
		const socket = await opened();
		expect(new URL(socket.url).pathname).toBe("/api/v1/games/823823/live");
		expect(socket.url).toMatch(/^ws:/);
	});

	it("shows the second payload's values in the Live status without navigation; the top bar never shows a score", async () =>
	{
		renderGame("live");
		await opened();
		const status = () => screen.getAllByTestId("live-status")[0]!;
		const topBar = () => screen.getByTestId("game-topbar");
		await waitFor(() => expect(status()).toHaveTextContent("CHC 1 · MIA 0"));
		expect(topBar()).not.toHaveTextContent(/CHC \d|MIA \d/);
		await push(update(2, 5, 2));
		await push(update(3, 7, 4));
		await waitFor(() => expect(status()).toHaveTextContent("CHC 4 · MIA 0"));
		expect(status()).toHaveTextContent("Bot 7th");
		expect(topBar()).not.toHaveTextContent(/CHC \d|MIA \d/);
		expect(FakeWebSocket.opened).toHaveLength(1);
	});

	it("closes the socket when the page unmounts", async () =>
	{
		const { unmount } = renderGame("live");
		const socket = await opened();
		unmount();
		expect(socket.close).toHaveBeenCalledTimes(1);
	});

	it("keeps a selected pitch through an update (Live)", async () =>
	{
		const user = userEvent.setup();
		renderGame("live");
		await opened();
		const rows = await screen.findAllByTestId("pitch-row");
		const older = rows.at(-1)!;
		const button = within(older).getAllByRole("button")[0]!;
		await user.click(button);
		await waitFor(() => expect(button).toHaveAttribute("aria-expanded", "true"));
		await push(update(2, 3, 1));
		expect(within(screen.getAllByTestId("pitch-row").at(-1)!).getAllByRole("button")[0]).toHaveAttribute("aria-expanded", "true");
	});

	it("keeps an open at-bat row through an update (Plays)", async () =>
	{
		const user = userEvent.setup();
		renderGame("plays");
		await opened();
		const controls = await screen.findAllByRole("button", {
			expanded: false,
		});
		const control = controls.find((c) => c.className.includes("Accordion"))!;
		const label = control.getAttribute("aria-label")!;
		await user.click(control);
		await waitFor(() => expect(screen.getByRole("button", {
			name: label,
		})).toHaveAttribute("aria-expanded", "true"));
		await push(update(2, 3, 1));
		expect(screen.getByRole("button", {
			name: label,
		})).toHaveAttribute("aria-expanded", "true");
	});

	it("keeps a playing video through an update (Videos)", async () =>
	{
		const user = userEvent.setup();
		renderGame("videos");
		await opened();
		const first = live().highlights[0]!;
		await user.click(await screen.findByRole("button", {
			name: `Play ${first.title}`,
		}));
		const dialog = await screen.findByRole("dialog");
		const video = dialog.querySelector("video");
		await push(update(2, 3, 1));
		expect(screen.getByRole("dialog")).toHaveTextContent(first.title);
		expect(screen.getByRole("dialog").querySelector("video")).toBe(video);
	});

	it("render count: one streamed update commits the Live panel twice, as S64's baseline", async () =>
	{
		const counter = createRenderCounter("live");
		renderGame("live", counter.Counted);
		await opened();
		await screen.findByTestId("matchup-cards");
		counter.reset();
		await push(update(2, 3, 1));
		await waitFor(() => expect(counter.count()).toBeGreaterThan(0));
		await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
		expect(counter.count()).toBe(2);
	});
});
