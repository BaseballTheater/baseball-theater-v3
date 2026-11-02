/**
 * S66: the scoreboard to the ratified shell-scoreboard frames, on the S65 fixtures —
 * a finished game from `schedule-2026-09-05.json` and 823823 before first pitch and in
 * progress from `schedule-823823-moments.json` (folded from its recording, never typed).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
	act, cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MemoryRouter, Route, Routes, useLocation,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { contrastSafeTeamColor, formatGameTime } from "@bt/domain";
import { createQueryClient } from "../api/queryClient.js";
import { writeScheduleDay } from "../api/schedule.js";
import type { ScheduleDayPayload } from "../api/schedule.js";
import { viewerTimeZone } from "../format/datetime.js";
import type { LayoutVariant } from "../layout/variant.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { createRenderCounter } from "../test/renderCount.js";
import { ScoreboardPage } from "./ScoreboardPage.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

type Game = ScheduleDayPayload["games"][number];

function read<T>(name: string): T
{
	return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

/**
 * 2026-09-05 with one game in each phase: SF @ NYM final 9–5, and 823823 (CHC @ MIA)
 * in progress and before first pitch. The pre-game copy is the same game at another
 * moment, so it gets its own key to render beside the live one.
 */
function day(games?: Game[]): ScheduleDayPayload
{
	const schedule = read<ScheduleDayPayload>("schedule-2026-09-05.json");
	const moments = read<{ pregame: Game;
		live: Game; }>("schedule-823823-moments.json");
	return {
		...schedule,
		games: games ?? [schedule.games[0]!, moments.live, {
			...moments.pregame,
			gamePk: 1,
		}],
		fetchedAt: "2026-09-05T20:57:20.000Z",
		windowMode: "active",
		version: 1,
		lastChangedAt: "2026-09-05T20:57:20.000Z",
	};
}

function Location()
{
	return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderScoreboard(variant: LayoutVariant = "mobile", client: QueryClient = createQueryClient(), wrap = (node: React.ReactNode) => node)
{
	return render(
		<MantineProvider>
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={["/games/2026-09-05"]}>
					{wrap(
						<Routes>
							<Route path="/games/:date" element={<><ScoreboardPage variant={variant} /><Location /></>} />
						</Routes>,
					)}
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

/** The day digest (S71) is asked beside the schedule; these tests answer it with none. */
function orDigest(request: Request, body: unknown): Response
{
	return new URL(request.url).pathname === "/api/v1/digest" ? jsonResponse({
		date: "2026-09-05",
		items: [],
	}) : jsonResponse(body);
}

function serve(body: ScheduleDayPayload = day())
{
	const fetchMock = vi.fn((request: Request) => Promise.resolve(orDigest(request, body)));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

async function modules(): Promise<HTMLElement[]>
{
	return screen.findAllByTestId("scoreboard-module");
}

function byPhase(all: HTMLElement[], phase: string): HTMLElement
{
	return all.find((m) => m.dataset.phase === phase)!;
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

describe("ScoreboardModule (S66)", () =>
{
	it("final: FINAL, R·H·E per team and ABBR (W-L) via teamRecordLabel", async () =>
	{
		serve();
		renderScoreboard();
		const final = byPhase(await modules(), "final");
		const m = within(final);
		expect(m.getByText("FINAL")).toBeInTheDocument();
		expect(m.getByText("Giants")).toBeInTheDocument();
		expect(m.getByText("SF (59-84)")).toBeInTheDocument();
		expect(m.getByText("NYM (64-78)")).toBeInTheDocument();
		expect(m.getAllByTestId("runs").map((c) => c.textContent)).toEqual(["9", "5"]);
		expect(m.getAllByTestId("hits").map((c) => c.textContent)).toEqual(["10", "5"]);
		expect(m.getAllByTestId("errors").map((c) => c.textContent)).toEqual(["1", "0"]);
		expect(m.getByRole("link", {
			name: "Giants at Mets",
		})).toHaveAttribute("href", "/game/823577");
	});

	it("live: the blinking LiveIndicator labeled with inningLabel, R·H·E and records", async () =>
	{
		serve();
		renderScoreboard();
		const m = within(byPhase(await modules(), "live"));
		expect(m.getByTestId("live-dot")).toBeInTheDocument();
		expect(m.getByText("Top 3rd")).toBeInTheDocument();
		expect(m.getByText("CHC (81-62)")).toBeInTheDocument();
		expect(m.getAllByTestId("runs").map((c) => c.textContent)).toEqual(["1", "0"]);
		expect(m.getAllByTestId("hits").map((c) => c.textContent)).toEqual(["5", "0"]);
	});

	it("scheduled: start time via formatGameTime, the venue, and records as W - L (.pct); no R·H·E", async () =>
	{
		serve();
		renderScoreboard();
		const m = within(byPhase(await modules(), "pregame"));
		expect(m.getByText(formatGameTime("2026-09-05T20:10:00Z", viewerTimeZone()))).toBeInTheDocument();
		expect(m.getByText("· loanDepot park")).toBeInTheDocument();
		expect(m.getByText("81 - 62 (.566)")).toBeInTheDocument();
		expect(m.queryByText("R")).toBeNull();
		expect(m.queryAllByTestId("runs")).toHaveLength(0);
	});

	it("venue renders on the scheduled module only", async () =>
	{
		serve();
		renderScoreboard();
		const all = await modules();
		expect(within(byPhase(all, "pregame")).getByText(/loanDepot park/)).toBeInTheDocument();
		expect(within(byPhase(all, "live")).queryByText(/loanDepot park/)).toBeNull();
		expect(within(byPhase(all, "final")).queryByText(/Citi Field/)).toBeNull();
	});

	it("edge: each team row has a TeamEdge in contrastSafeTeamColor", async () =>
	{
		serve();
		renderScoreboard();
		const final = byPhase(await modules(), "final");
		const edges = within(final).getAllByTestId("team-edge");
		expect(edges).toHaveLength(2);
		expect(edges[0]).toHaveStyle({
			background: contrastSafeTeamColor(137),
		});
		expect(edges[1]).toHaveStyle({
			background: contrastSafeTeamColor(121),
		});
		for (const row of screen.getAllByTestId("team-row"))
		{
			expect(within(row).getByTestId("team-edge")).toBeInTheDocument();
		}
	});
});

describe("ScoreboardPage layout (S66)", () =>
{
	it.each([
		["mobile", "1"],
		["medium", "2"],
		["desktop", "2"],
	] as const)("columns: %s lays modules in %s column(s)", async (variant, cols) =>
	{
		serve();
		renderScoreboard(variant);
		await modules();
		const grid = screen.getByTestId("scoreboard-grid");
		expect(getComputedStyle(grid).getPropertyValue("--sg-cols")).toBe(cols);
	});

	it("date control: previous and next go to the day before and after", async () =>
	{
		serve();
		const user = userEvent.setup();
		renderScoreboard();
		const control = await screen.findByTestId("date-control");
		expect(within(control).getByText("Sep 5, 2026")).toBeInTheDocument();
		await user.click(within(control).getByRole("link", {
			name: "Next day",
		}));
		expect(screen.getByTestId("location")).toHaveTextContent("/games/2026-09-06");
		await user.click(within(screen.getByTestId("date-control")).getByRole("link", {
			name: "Previous day",
		}));
		await user.click(within(screen.getByTestId("date-control")).getByRole("link", {
			name: "Previous day",
		}));
		expect(screen.getByTestId("location")).toHaveTextContent("/games/2026-09-04");
	});
});

describe("ScoreboardPage states (S66, ViewState)", () =>
{
	it("empty: one muted sentence when the day has no games", async () =>
	{
		serve(day([]));
		renderScoreboard();
		expect(await screen.findByText("No games scheduled for this date.")).toBeInTheDocument();
		expect(screen.queryAllByTestId("scoreboard-module")).toHaveLength(0);
		expect(screen.getByTestId("date-control")).toBeInTheDocument();
	});

	it("loading: the page title is kept above the loader", () =>
	{
		vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
		renderScoreboard();
		expect(screen.getByRole("heading", {
			name: "Sep 5, 2026 Scoreboard",
		})).toBeInTheDocument();
		expect(screen.getByLabelText("Loading")).toBeInTheDocument();
		expect(screen.getByTestId("date-control")).toBeInTheDocument();
	});

	it("error: Couldn't load games, the hint, and Retry refetches", async () =>
	{
		const fetchMock = vi.fn((_request: Request) => Promise.resolve(jsonResponse({
			error: "unavailable",
		}, 503)));
		vi.stubGlobal("fetch", fetchMock);
		const user = userEvent.setup();
		renderScoreboard();
		const alert = await screen.findByRole("alert");
		expect(within(alert).getByText("Couldn't load games")).toBeInTheDocument();
		expect(within(alert).getByText("Check your connection and try again")).toBeInTheDocument();
		const calls = fetchMock.mock.calls.length;
		fetchMock.mockImplementation((request: Request) => Promise.resolve(orDigest(request, day())));
		await user.click(within(alert).getByRole("button", {
			name: "Retry",
		}));
		expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
		expect(await modules()).toHaveLength(3);
	});
});

describe("ScoreboardPage render count (S66, ADR-026)", () =>
{
	it("render count: one schedule update commits the scoreboard a fixed number of times", async () =>
	{
		serve();
		const client = createQueryClient();
		const counter = createRenderCounter("scoreboard");
		renderScoreboard("mobile", client, (node) => <counter.Counted>{node}</counter.Counted>);
		await modules();
		// Let the day digest's own answer (S71) land before counting.
		await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
		counter.reset();
		const next = day();
		await act(async () =>
		{
			writeScheduleDay(client, {
				...next,
				version: 2,
			});
		});
		// The cache notifies its readers on the next tick; then let any follow-up commits land.
		await waitFor(() => expect(counter.count()).toBeGreaterThan(0));
		await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
		// Baseline (S66, ADR-026), measured 2026-10-30: one cache update commits the
		// scoreboard once. A rise means a schedule refresh re-renders more than it should.
		expect(counter.count()).toBe(1);
	});
});
