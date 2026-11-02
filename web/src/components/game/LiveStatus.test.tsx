/**
 * The Live room's status (S3) on the committed 745001 fixture (NYY @ BOS, In
 * Progress, Top 6, 1 out, 2–1, NYY 4 · BOS 3), rendered through the game page so
 * every assertion is made inside the Live tab panel. The inning reads alone; the outs
 * show only as pips (game-rooms A5, S109).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, within,
} from "@testing-library/react";
import {
	MemoryRouter, Route, Routes,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { GamePayload } from "../../api/game.js";
import { createQueryClient } from "../../api/queryClient.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { GamePage } from "../../pages/GamePage.js";
import { jsonResponse } from "../../test/jsonResponse.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");

function fixture(): GamePayload
{
	return {
		...JSON.parse(readFileSync(join(FIXTURES, "game-745001.json"), "utf8")),
		plays: [],
		fetchedAt: "2024-07-04T23:00:00.000Z",
		windowMode: "active",
		version: 1,
		lastChangedAt: "2024-07-04T23:00:00.000Z",
	} as GamePayload;
}

/** Renders `/game/745001/live` at a pairing and returns the Live tab panel. */
async function livePanel(variant: LayoutVariant = "mobile", game: GamePayload = fixture()): Promise<HTMLElement>
{
	vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(game))));
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={["/game/745001/live"]}>
					<Routes>
						<Route path="/game/:gamePk/:tab" element={<GamePage variant={variant} />} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
	await screen.findByTestId("game-topbar");
	return screen.getByRole("tabpanel");
}

/** How many of a pip group's dots are filled. */
function filled(group: HTMLElement): number
{
	return group.querySelectorAll("[data-filled='true']").length;
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

describe("the Live status (S3)", () =>
{
	it("live panel: Top 6th, 1 out, 2 balls, 1 strike", async () =>
	{
		const panel = await livePanel();
		const status = within(panel).getByRole("status", {
			name: "Live status",
		});
		expect(status.textContent).toMatch(/Top 6th$/);
		expect(status).not.toHaveTextContent(/\bOuts?\b/);
		expect(within(status).getByRole("img", {
			name: /Balls/,
		})).toHaveAccessibleName("Balls: 2 of 3");
		expect(within(status).getByRole("img", {
			name: /Strikes/,
		})).toHaveAccessibleName("Strikes: 1 of 2");
		expect(within(status).getByRole("img", {
			name: /Outs/,
		})).toHaveAccessibleName("Outs: 1 of 2");
	});

	it("pips: each group is labeled and fills as many pips as its value", async () =>
	{
		const panel = await livePanel();
		const group = (name: RegExp) => within(panel).getByRole("img", {
			name,
		});
		expect(filled(group(/^Balls/))).toBe(2);
		expect(group(/^Balls/).querySelectorAll("[data-filled]")).toHaveLength(3);
		expect(filled(group(/^Strikes/))).toBe(1);
		expect(filled(group(/^Outs/))).toBe(1);
	});

	it("pips: a full count fills every slot; no count fills none", async () =>
	{
		const game = fixture();
		const panel = await livePanel("mobile", {
			...game,
			linescore: {
				...game.linescore!,
				balls: 3,
				strikes: 2,
				outs: null,
			},
		});
		expect(filled(within(panel).getByRole("img", {
			name: /^Balls/,
		}))).toBe(3);
		expect(filled(within(panel).getByRole("img", {
			name: /^Outs/,
		}))).toBe(0);
		expect(within(panel).getByRole("status")).toHaveTextContent(/Top 6th$/);
	});

	it("score: NYY 4 and BOS 3 together in the live status, and no linescore on Live", async () =>
	{
		const panel = await livePanel();
		expect(within(panel).getByTestId("live-status")).toHaveTextContent("NYY 4 · BOS 3");
		expect(within(panel).queryByTestId("inning-cell")).toBeNull();
		expect(within(panel).queryByRole("table")).toBeNull();
		for (const header of ["R", "H", "E"]) expect(within(panel).queryByRole("columnheader", {
			name: header,
		})).toBeNull();
	});

	it("score: a game with no linescore yet reads 0 · 0 and no inning", async () =>
	{
		const panel = await livePanel("mobile", {
			...fixture(),
			linescore: null,
		});
		expect(within(panel).getByTestId("live-status")).toHaveTextContent("NYY 0 · BOS 0");
	});

	for (const variant of ["medium", "desktop"] as const)
	{
		it(`variant: at ${variant} the status is the card with score, pips and inning`, async () =>
		{
			const panel = await livePanel(variant);
			const card = within(panel).getByTestId("live-status");
			expect(card).toHaveAttribute("data-variant", variant);
			expect(card).toHaveTextContent("NYY 4 · BOS 3");
			expect(within(card).getAllByRole("img", {
				name: /^(Balls|Strikes|Outs):/,
			})).toHaveLength(3);
			expect(card.textContent).toMatch(/Top 6th$/);
		});
	}
});
