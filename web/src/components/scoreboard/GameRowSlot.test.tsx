/**
 * S67: the scoreboard's game-row slot on the S65 fixtures — SF @ NYM final
 * (`schedule-2026-09-05.json`) and 823823 in progress and before first pitch
 * (`schedule-823823-moments.json`) — and the Game-Row Slot setting that picks it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AccountSettings, GameRowSlot as Setting } from "@bt/domain";
import {
	DEFAULT_SETTINGS, gamePhase, roomsForPhase,
} from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MemoryRouter, Route, Routes,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../../api/queryClient.js";
import type { ScheduleDayPayload } from "../../api/schedule.js";
import { ScoreboardPage } from "../../pages/ScoreboardPage.js";
import { SettingsPage } from "../../pages/SettingsPage.js";
import { DEV_SIGN_IN_TOKEN } from "../../session/session.js";
import { SessionProvider } from "../../session/SessionProvider.js";
import { setSessionToken } from "../../session/token.js";
import { SettingsSync } from "../../settings/SettingsSync.js";
import { resetSettings } from "../../settings/store.js";
import { clearPersonalData } from "../../storage/storage.js";
import { jsonResponse } from "../../test/jsonResponse.js";
import { DEV_ACCOUNT } from "../../test/meApi.js";
import { GameRowSlot } from "./GameRowSlot.js";
import { ScoreboardModule } from "./ScoreboardModule.js";
import type { ScoreboardGame } from "./ScoreboardModule.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");

function read<T>(name: string): T
{
	return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

const SCHEDULE = read<ScheduleDayPayload>("schedule-2026-09-05.json");
const MOMENTS = read<{ pregame: ScoreboardGame;
	live: ScoreboardGame; }>("schedule-823823-moments.json");
const GAMES: Record<"final" | "live" | "pregame", ScoreboardGame> = {
	final: SCHEDULE.games[0]!,
	live: MOMENTS.live,
	pregame: MOMENTS.pregame,
};

function renderSlot(game: ScoreboardGame, setting: Setting)
{
	return render(
		<MantineProvider>
			<MemoryRouter>
				<GameRowSlot game={game} setting={setting} />
			</MemoryRouter>
		</MantineProvider>,
	);
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	setSessionToken(null);
	resetSettings();
	clearPersonalData();
});

describe("GameRowSlot Status (S67)", () =>
{
	it("pitchers of record on a final: W and L as MLB named them, no S when there was no save", () =>
	{
		renderSlot(GAMES.final, "status");
		const slot = within(screen.getByTestId("slot-pitchers"));
		expect(slot.getByText("W: A. Molina")).toBeInTheDocument();
		expect(slot.getByText("L: Z. Thornton")).toBeInTheDocument();
		expect(slot.queryByText(/^S:/)).toBeNull();
	});

	it("count on a live game: the shared BaseDiamond (bases loaded) beside the count as shorthand text, no pips, then AB / P", () =>
	{
		renderSlot(GAMES.live, "status");
		const slot = within(screen.getByTestId("slot-count"));
		expect(slot.getByRole("img", {
			name: "Runners on second, third, first",
		})).toBeInTheDocument();
		expect(slot.getByText("2-2, 2 out")).toBeInTheDocument();
		expect(slot.queryByTestId(/^pips-/)).toBeNull();
		expect(slot.getByText("AB: A. Bregman")).toBeInTheDocument();
		expect(slot.getByText("P: R. Gusto")).toBeInTheDocument();
	});

	it("probables before first pitch: each starter with W-L, ERA, away first", () =>
	{
		renderSlot(GAMES.pregame, "status");
		const slot = within(screen.getByTestId("slot-probables"));
		const names = slot.getAllByText(/^[A-Z]\. /).map((n) => n.textContent);
		expect(names).toEqual(["J. Assad", "R. Gusto"]);
		expect(slot.getAllByText(/^\d+-\d+, \d+\.\d{2}$/)).toHaveLength(2);
		expect(slot.getByText("6-1, 3.46")).toBeInTheDocument();
	});
});

describe("GameRowSlot Room Menu (S67)", () =>
{
	it.each(["pregame", "live", "final"] as const)("room menu: %s lists exactly roomsForPhase as links to /game/:pk/:room", (phase) =>
	{
		const game = GAMES[phase];
		expect(gamePhase(game.status.codedGameState)).toBe(phase);
		renderSlot(game, "roomMenu");
		const links = within(screen.getByTestId("slot-room-menu")).getAllByRole("link");
		const rooms = roomsForPhase(phase, true);
		expect(links.map((l) => l.textContent?.toLowerCase())).toEqual([...rooms]);
		expect(links.map((l) => l.getAttribute("href"))).toEqual(rooms.map((room) => `/game/${game.gamePk}/${room}`));
	});
});

describe("Game-Row Slot setting (S67)", () =>
{
	it("setting: Status (default) and Room Menu only; choosing Room Menu re-renders the mounted scoreboard and saves to the account", async () =>
	{
		let stored: AccountSettings = DEFAULT_SETTINGS;
		const puts: AccountSettings[] = [];
		vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
		{
			const { pathname } = new URL(request.url);
			if (pathname === "/api/v1/me") return jsonResponse(DEV_ACCOUNT);
			if (pathname.startsWith("/api/v1/me/download")) return jsonResponse({
				error: "not_found",
			}, 404);
			// The day digest (S71) is asked beside the schedule; these tests answer it with none.
			if (pathname === "/api/v1/digest") return jsonResponse({
				date: "2026-09-05",
				items: [],
			});
			if (pathname === "/api/v1/schedule") return jsonResponse({
				...SCHEDULE,
				games: [GAMES.final],
				fetchedAt: "2026-09-05T20:57:20.000Z",
				windowMode: "cache",
				version: 1,
				lastChangedAt: "2026-09-05T20:57:20.000Z",
			});
			if (request.method === "PUT")
			{
				const body = await request.json() as AccountSettings;
				puts.push(body);
				if (body.version > stored.version) stored = body;
			}
			return jsonResponse(stored);
		}));
		setSessionToken(DEV_SIGN_IN_TOKEN);
		render(
			<MantineProvider>
				<QueryClientProvider client={createQueryClient()}>
					<SessionProvider>
						<SettingsSync />
						<MemoryRouter initialEntries={["/games/2026-09-05"]}>
							<Routes>
								<Route path="/games/:date" element={<ScoreboardPage variant="mobile" />} />
							</Routes>
						</MemoryRouter>
						<SettingsPage variant="mobile" />
					</SessionProvider>
				</QueryClientProvider>
			</MantineProvider>,
		);
		const slot = await screen.findByTestId("game-row-slot");
		expect(slot).toHaveAttribute("data-occupant", "pitchersOfRecord");

		const group = within(screen.getByRole("radiogroup", {
			name: "Game-Row Slot",
		}));
		expect(group.getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["status", "roomMenu"]);
		expect(group.getByRole("radio", {
			name: "Status",
		})).toBeChecked();

		await userEvent.click(group.getByRole("radio", {
			name: "Room Menu",
		}));
		expect(screen.getByTestId("game-row-slot")).toHaveAttribute("data-occupant", "roomMenu");
		await waitFor(() => expect(puts.at(-1)?.gameRowSlot).toBe("roomMenu"));
		expect(stored.gameRowSlot).toBe("roomMenu");
	});
});

/** A game with every optional part MLB may leave out, at `codedGameState`. */
function sparse(codedGameState: string): ScoreboardGame
{
	return {
		...GAMES.final,
		gamePk: 9,
		startTime: undefined,
		status: {
			...GAMES.final.status,
			codedGameState,
		},
		teams: {
			away: {
				...GAMES.final.teams.away,
				record: null,
			},
			home: {
				...GAMES.final.teams.home,
				record: null,
			},
		},
		venue: null,
		linescore: null,
		probablePitchers: {
			away: null,
			home: {
				id: 1,
				fullName: "Pat Unknown",
				wins: null,
				losses: null,
				era: null,
			},
		},
		decisions: null,
		live: null,
	};
}

function renderModule(game: ScoreboardGame)
{
	return render(
		<MantineProvider>
			<MemoryRouter>
				<ScoreboardModule game={game} />
			</MemoryRouter>
		</MantineProvider>,
	);
}

describe("sparse data (S66 module, S67 slot)", () =>
{
	it("sparse: a live game with no linescore or live moment reads LIVE, dashes for R·H·E, no count and no AB / P", () =>
	{
		renderModule(sparse("I"));
		expect(screen.getByText("LIVE")).toBeInTheDocument();
		expect(screen.getAllByTestId("runs").map((c) => c.textContent)).toEqual(["–", "–"]);
		expect(screen.queryByText(/out$/)).toBeNull();
		expect(screen.queryByText(/^AB:/)).toBeNull();
	});

	it("sparse: a final with no records or decisions shows abbreviations alone and an empty slot", () =>
	{
		renderModule(sparse("F"));
		expect(screen.getByText("SF")).toBeInTheDocument();
		expect(screen.getByTestId("slot-pitchers")).toBeEmptyDOMElement();
	});

	it("sparse: a scheduled game with no start time, venue, records or probables", () =>
	{
		renderModule(sparse("S"));
		const module = within(screen.getByTestId("scoreboard-module"));
		expect(module.queryByText(/PM|AM/)).toBeNull();
		expect(module.getByText("TBD")).toBeInTheDocument();
		expect(module.getByText("P. Unknown")).toBeInTheDocument();
		expect(module.queryAllByText(/\(\.\d{3}\)/)).toHaveLength(0);
	});
});

describe("the whole module is the game link (owner, 2026-11-12: \"the entire game card should be clickable in the games list\")", () =>
{
	function renderModule(game: ScoreboardGame)
	{
		render(
			<MantineProvider>
				<MemoryRouter>
					<ScoreboardModule game={game} />
				</MemoryRouter>
			</MantineProvider>,
		);
		return screen.getByTestId("scoreboard-module");
	}

	it("the game link's box is stretched over the card, which is its positioning box and lifts on hover", () =>
	{
		const card = renderModule(GAMES.final);
		const link = within(card).getByRole("link", {
			name: /at/,
		});
		expect(link).toHaveAttribute("href", `/game/${GAMES.final.gamePk}`);
		// `.bt-card-link::after` covers its nearest positioned ancestor: the card, padding and slot included.
		expect(link).toHaveClass("bt-card-link");
		expect(card.style.position).toBe("relative");
		expect(card).toHaveClass("bt-card");
		// The slot is not positioned, so the stretched link sits over it and a press on it opens the game.
		expect(within(card).getByTestId("game-row-slot").style.position).toBe("");
		// One link per card while the slot shows Status: nothing nested, nothing competing.
		expect(within(card).getAllByRole("link")).toHaveLength(1);
	});

	it("Room Menu links stay their own links, raised above the card's link", () =>
	{
		render(
			<MantineProvider>
				<MemoryRouter>
					<GameRowSlot game={GAMES.final} setting="roomMenu" />
				</MemoryRouter>
			</MantineProvider>,
		);
		const links = within(screen.getByTestId("slot-room-menu")).getAllByRole("link");
		expect(links.length).toBeGreaterThan(0);
		for (const link of links) expect(link).toHaveClass("bt-above-card-link");
	});
});
