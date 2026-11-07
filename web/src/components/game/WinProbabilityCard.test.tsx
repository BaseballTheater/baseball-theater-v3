/**
 * The Live room's Win probability card (S106) on 823823: the mid-game moment S63 folded
 * (top 3rd, Bregman batting against Gusto) with S93's play metrics for the at-bats played by
 * then, rendered through the game page at each pairing.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GamePlayMetrics } from "@bt/domain";
import { DEFAULT_SETTINGS } from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import {
	MemoryRouter, Route, Routes,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { GamePayload } from "../../api/game.js";
import { writeGame } from "../../api/game.js";
import { createQueryClient } from "../../api/queryClient.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { GamePage } from "../../pages/GamePage.js";
import { hydrateSettings, resetSettings } from "../../settings/store.js";
import { jsonResponse } from "../../test/jsonResponse.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");
const read = (file: string) => JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
const METRICS: GamePlayMetrics = read("game-823823.json").playMetrics;

/** The live moment with the metrics of its first `measured` at-bats (all it has played, by default). */
function liveGame(measured?: number, version = 1, metrics = true): GamePayload
{
	const live = read("game-823823-live.json");
	const played = measured ?? live.plays.length;
	return {
		...live,
		...metrics && {
			playMetrics: {
				atBats: METRICS.atBats.filter((m) => m.atBatIndex < played),
			},
		},
		fetchedAt: "2026-09-05T20:57:20.000Z",
		windowMode: "active",
		version,
		lastChangedAt: "2026-09-05T20:57:20.000Z",
	} as GamePayload;
}

async function hideScores(on: boolean): Promise<void>
{
	vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({
		...DEFAULT_SETTINGS,
		hideScores: on,
		version: 1,
	}))));
	await hydrateSettings("test-user");
}

/** Renders `/game/823823/live` at a pairing and returns the Live tab panel. */
async function livePanel(game: GamePayload, variant: LayoutVariant, client: QueryClient = createQueryClient()): Promise<HTMLElement>
{
	vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(game))));
	render(
		<MantineProvider>
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={["/game/823823/live"]}>
					<Routes>
						<Route path="/game/:gamePk/:tab" element={<GamePage variant={variant} />} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
	await screen.findByTestId("matchup-cards");
	return screen.getByRole("tabpanel");
}

afterEach(async () =>
{
	cleanup();
	vi.unstubAllGlobals();
	await resetSettings();
});

describe("the Live room's Win probability card (S106)", () =>
{
	it.each(["medium", "desktop"] as const)("S106 AC 2: at %s, under the status card beside the zone: title, current percent, line and area, dashed 50% line, innings", async (variant) =>
	{
		const game = liveGame();
		const panel = await livePanel(game, variant);
		const card = within(panel).getByTestId("win-probability");
		// Same column as the status card, right under it; the zone is in the column beside.
		const status = within(panel).getByTestId("live-status");
		const column = card.parentElement!;
		expect(column.contains(status)).toBe(true);
		expect(status.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(column.contains(within(panel).getByTestId("matchup-cards"))).toBe(false);

		expect(within(card).getByText("Win probability (MIA)")).toBeTruthy();
		const last = game.playMetrics!.atBats.at(-1)!.homeWinProbability!;
		expect(within(card).getByTestId("win-probability-value").textContent).toBe(`${Math.round(last)}%`);
		expect(within(card).getByTestId("win-probability-line").getAttribute("data-points")).toBe(String(game.playMetrics!.atBats.length));
		expect(within(card).getByTestId("win-probability-area")).toBeTruthy();
		expect(within(card).getByTestId("win-probability-midline").getAttribute("stroke-dasharray")).toBeTruthy();
		const innings = within(card).getAllByTestId("win-probability-inning").map((t) => t.textContent);
		expect(innings).toEqual(["1", "2", "3"]);
	});

	it("S106 AC 2: at mobile there is no card", async () =>
	{
		const panel = await livePanel(liveGame(), "mobile");
		expect(within(panel).queryByTestId("win-probability")).toBeNull();
	});

	it("S106 AC 3: with Hide Scores on the card keeps its title and size and reads – and Hidden with scores, with no line or value", async () =>
	{
		await hideScores(true);
		const panel = await livePanel(liveGame(), "medium");
		const card = await within(panel).findByTestId("win-probability");
		await waitFor(() => expect(within(card).queryByText("Hidden with scores")).toBeTruthy());
		expect(within(card).getByText("Win probability (MIA)")).toBeTruthy();
		expect(within(card).getByTestId("win-probability-value").textContent).toBe("–");
		expect(within(card).queryByTestId("win-probability-chart")).toBeNull();
		expect(within(card).queryByText(/%$/)).toBeNull();
	});

	it("S106 AC 4: with no play metrics the card is left out and the room lays out as before", async () =>
	{
		const panel = await livePanel(liveGame(undefined, 1, false), "medium");
		expect(within(panel).queryByTestId("win-probability")).toBeNull();
		expect(within(panel).getByTestId("live-status")).toBeTruthy();
		expect(within(panel).getByTestId("live-top")).toBeTruthy();
	});

	it("S106 AC 5: a newer game in the cache with another at-bat's metrics adds that point without a reload", async () =>
	{
		const client = createQueryClient();
		const first = liveGame(20);
		const panel = await livePanel(first, "medium", client);
		const line = () => within(panel).getByTestId("win-probability-line").getAttribute("data-points");
		expect(line()).toBe(String(first.playMetrics!.atBats.length));
		const fetches = vi.mocked(fetch).mock.calls.length;
		act(() => writeGame(client, liveGame(21, 2)));
		await waitFor(() => expect(line()).toBe(String(first.playMetrics!.atBats.length + 1)));
		expect(vi.mocked(fetch).mock.calls.length).toBe(fetches);
	});
});
