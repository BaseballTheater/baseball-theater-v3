/**
 * Hide Scores in the game rooms (S75; game-rooms A3–A5, game-shell A2–A3) on the committed
 * 823823 fixtures (CHC @ MIA, Final 6–5, and the mid-game Live moment), rendered through the
 * game page with the setting on and off: what is masked, and that everything else reads the
 * same either way.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import {
	MemoryRouter, Route, Routes,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { AtBat } from "@bt/domain";
import { DEFAULT_SETTINGS, isGameRecapHighlight } from "@bt/domain";
import type { GamePayload } from "../../api/game.js";
import { createQueryClient } from "../../api/queryClient.js";
import { GamePage } from "../../pages/GamePage.js";
import { hydrateSettings, resetSettings } from "../../settings/store.js";
import { jsonResponse } from "../../test/jsonResponse.js";
import { LazyPlayerDialog } from "../videos/LazyPlayerDialog.js";
import { VideoCard } from "../videos/VideoCard.js";
import type { LayoutVariant } from "../../layout/variant.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");
const read = (file: string) => JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
const PLAYS: AtBat[] = read("plays-823823.json");

/** The final game as the API serves it, with `plays` (all of them by default). */
function finalGame(plays: AtBat[] = PLAYS): GamePayload
{
	return {
		...read("game-823823.json"),
		plays,
		fetchedAt: "2026-09-05T23:00:00.000Z",
		windowMode: "cache",
		version: 1,
		lastChangedAt: "2026-09-05T23:00:00.000Z",
	} as GamePayload;
}

/** The mid-game moment: top 3rd, Bregman batting against Gusto. */
function liveGame(): GamePayload
{
	return {
		...read("game-823823-live.json"),
		fetchedAt: "2026-09-05T20:57:20.000Z",
		windowMode: "active",
		version: 1,
		lastChangedAt: "2026-09-05T20:57:20.000Z",
	} as GamePayload;
}

/** Turns Hide Scores on or off for the signed-in reader. */
async function hideScores(on: boolean): Promise<void>
{
	vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({
		...DEFAULT_SETTINGS,
		hideScores: on,
		version: 1,
	}))));
	await hydrateSettings("test-user");
}

function wrap(node: ReactNode)
{
	return render(<MantineProvider><QueryClientProvider client={createQueryClient()}>{node}</QueryClientProvider></MantineProvider>);
}

/** Renders `/game/823823/<tab>` with Hide Scores `on` and returns the tab panel once `ready` shows. */
async function room(tab: string, game: GamePayload, on: boolean, ready: string, variant: LayoutVariant = "mobile"): Promise<HTMLElement>
{
	await hideScores(on);
	vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(game))));
	wrap(
		<MemoryRouter initialEntries={[`/game/823823/${tab}`]}>
			<Routes>
				<Route path="/game/:gamePk/:tab" element={<GamePage variant={variant} />} />
			</Routes>
		</MemoryRouter>,
	);
	await screen.findAllByTestId(ready);
	return screen.getByRole("tabpanel");
}

/** Renders the room with Hide Scores on, then off, handing each panel to `read` and returning both results. */
async function onAndOff<T>(tab: string, game: () => GamePayload, ready: string, readPanel: (panel: HTMLElement) => T | Promise<T>): Promise<{ hidden: T;
	shown: T; }>
{
	const hidden = await readPanel(await room(tab, game(), true, ready));
	cleanup();
	const shown = await readPanel(await room(tab, game(), false, ready));
	return {
		hidden,
		shown,
	};
}

afterEach(() =>
{
	cleanup();
	resetSettings();
	vi.unstubAllGlobals();
});

describe("Hide Scores in the rooms (S75)", () =>
{
	it("S75 live status: CHC – · MIA – through HiddenValue; inning, pips, result and batter's line unchanged; no Count: or outs text", async () =>
	{
		for (const variant of ["mobile", "medium"] as const)
		{
			const read = async (on: boolean) =>
			{
				const panel = await room("live", liveGame(), on, "matchup-cards", variant);
				const status = within(panel).getByTestId("live-status");
				const result = {
					status: status.textContent,
					masks: within(status).queryAllByTestId("hidden-score").length,
					cards: within(panel).getByTestId("matchup-cards").textContent,
					line: variant === "mobile" ? within(panel).getByTestId("matchup-line").textContent : null,
					panel: panel.textContent,
				};
				cleanup();
				return result;
			};
			const hidden = await read(true);
			const shown = await read(false);
			expect(hidden.status).toMatch(/^CHC – · MIA –/);
			expect(hidden.masks).toBe(2);
			expect(shown.status).toMatch(/^CHC \d+ · MIA \d+/);
			expect(shown.masks).toBe(0);
			// The pips and the inning: everything after the score reads the same.
			expect(hidden.status!.replace(/^CHC – · MIA –/, "")).toBe(shown.status!.replace(/^CHC \d+ · MIA \d+/, ""));
			expect(hidden.status).toMatch(/Top 3rd$/);
			expect(hidden.cards).toBe(shown.cards);
			expect(hidden.line).toBe(shown.line);
			expect(hidden.panel).not.toMatch(/Count:|\bOuts?\b/);
		}
	});

	it("S75 pitch call: an in-play pitch that scored reads IN PLAY with scores hidden, MLB's call with them shown, in the sequence of an open at-bat", async () =>
	{
		// Through Conine's home run (bottom 5th), the last at-bat; its last pitch is "In play, run(s)".
		// No at-bat opens by default (owner, 2026-11-12), so open it.
		vi.stubGlobal("scrollBy", vi.fn());
		const plays = PLAYS.slice(0, 47);
		const game = () => finalGame(plays);
		const openLast = async (panel: HTMLElement) =>
		{
			await userEvent.click(within(panel).getByRole("button", {
				name: new RegExp(`${plays.at(-1)!.matchup.batter.fullName} —`),
			}));
			return (await within(panel).findAllByTestId("pitch-row"))[0]!.textContent;
		};
		const { hidden, shown } = await onAndOff("plays", game, "game-topbar", openLast);
		expect(hidden).toMatch(/IN PLAY/);
		expect(hidden).not.toMatch(/run\(s\)/);
		expect(shown).toMatch(/In play, run\(s\)/);
	});

	it("S75 linescore: Plays masks every inning cell and R·H·E; Box reads the same with Hide Scores on and off", async () =>
	{
		const cells = (panel: HTMLElement) =>
		{
			const table = within(panel).getByRole("table", {
				name: "Linescore",
			});
			return within(table).getAllByRole("row").slice(1).map((row) => [...row.querySelectorAll("td")].map((td) => td.textContent).filter((text) => text !== ""));
		};
		const plays = await onAndOff("plays", () => finalGame(), "game-topbar", cells);
		for (const row of plays.hidden)
		{
			// Nine innings, then R H E.
			expect(row).toEqual(Array(12).fill("–"));
		}
		expect(plays.shown.flat()).not.toContain("–");
		cleanup();

		const box = await onAndOff("box", () => finalGame([]), "game-topbar", (panel) => within(panel).getByRole("table", {
			name: "Linescore",
		}).textContent);
		expect(box.hidden).toBe(box.shown);
		expect(box.shown).toMatch(/\d/);
	});

	it("S75 runs: the Runs view masks the score after each scoring play; the descriptions are unchanged", async () =>
	{
		const runs = async (panel: HTMLElement) =>
		{
			await userEvent.click(within(panel).getByRole("button", {
				name: "Runs",
			}));
			const rows = within(panel).getAllByRole("button", {
				name: /^(Top|Bot) \d+ · /,
			});
			return rows.map((row) => ({
				label: row.getAttribute("aria-label") ?? row.textContent,
				text: row.textContent,
				masked: within(row).queryAllByTestId("hidden-score").length,
			}));
		};
		const { hidden, shown } = await onAndOff("plays", () => finalGame(), "game-topbar", runs);
		expect(hidden).toHaveLength(9);
		expect(hidden.map((row) => row.label)).toEqual(shown.map((row) => row.label));
		for (const [i, row] of hidden.entries())
		{
			expect(row.masked).toBe(1);
			expect(row.text).toMatch(/ · –$/);
			expect(row.text).not.toMatch(/\d+–\d+/);
			expect(shown[i]!.text).toMatch(/\d+–\d+$/);
		}
	});

	it("S75 recap: headed Recap with scores hidden, MLB's headline otherwise; the body and Source: MLB unchanged", async () =>
	{
		const game = finalGame([]);
		const recap = async (panel: HTMLElement) => ({
			heading: within(panel).getByRole("heading", {
				level: 2,
			}).textContent,
			body: within(panel).getByRole("article").textContent!.replace(within(panel).getByRole("heading", {
				level: 2,
			}).textContent!, ""),
		});
		const { hidden, shown } = await onAndOff("recap", () => game, "game-topbar", recap);
		expect(hidden.heading).toBe("Recap");
		expect(shown.heading).toBe(game.recap!.headline);
		expect(hidden.body).toBe(shown.body);
		expect(hidden.body).toMatch(/Source: MLB$/);
	});

	it("S75 videos: the recap clip is Recap (score hidden) on its card and in the player on the game page; other titles, and the cards Search and the digest draw, are MLB's", async () =>
	{
		const game = finalGame([]);
		const recapClip = game.highlights.find(isGameRecapHighlight)!;
		const titles = (panel: HTMLElement) => within(panel).getAllByTestId("video-card").map((card) => card.getAttribute("aria-label"));
		const { hidden, shown } = await onAndOff("videos", () => game, "video-card", titles);
		expect(shown).toContain(`Play ${recapClip.title}`);
		expect(hidden).toEqual(shown.map((title) => (title === `Play ${recapClip.title}` ? "Play Recap (score hidden)" : title)));
		cleanup();

		const panel = await room("videos", game, true, "video-card");
		await userEvent.click(within(panel).getByRole("button", {
			name: "Play Recap (score hidden)",
		}));
		const dialog = await screen.findByRole("dialog");
		// Mantine puts the Modal's label on its root, outside the role="dialog" element.
		expect(document.querySelector("[aria-label=\"Recap (score hidden)\"]")).not.toBeNull();
		expect(document.querySelector(`[aria-label="${recapClip.title.replaceAll("\"", "\\\"")}"]`)).toBeNull();
		expect(within(dialog).getByTestId("video-player")).toHaveTextContent("Recap (score hidden)");
		expect(within(dialog).getByTestId("video-player")).not.toHaveTextContent(recapClip.title);
		cleanup();

		// Off the game page (Search, the day digest) the card and the dialog keep MLB's title.
		await hideScores(true);
		wrap(
			<MemoryRouter>
				<VideoCard video={recapClip} layout="grid" onPlay={() => undefined} />
				<LazyPlayerDialog video={recapClip} onClose={() => undefined} />
			</MemoryRouter>,
		);
		expect(screen.getByTestId("video-card")).toHaveAccessibleName(`Play ${recapClip.title}`);
		expect(within(await screen.findByRole("dialog")).getByTestId("video-player")).toHaveTextContent(recapClip.title);
		expect(document.querySelector("[aria-label=\"Recap (score hidden)\"]")).toBeNull();
	});
});
