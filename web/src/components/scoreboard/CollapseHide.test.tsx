/**
 * S68: collapse non-favorites and Hide Scores on the scoreboard, on the S65 fixtures —
 * SF @ NYM final (`schedule-2026-09-05.json`) and 823823 (CHC @ MIA) in progress and
 * before first pitch (`schedule-823823-moments.json`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AccountSettings } from "@bt/domain";
import { DEFAULT_SETTINGS, formatGameTime } from "@bt/domain";
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
import { hydrateSettings, resetSettings } from "../../settings/store.js";
import { clearPersonalData } from "../../storage/storage.js";
import { jsonResponse } from "../../test/jsonResponse.js";
import { DEV_ACCOUNT } from "../../test/meApi.js";
import { viewerTimeZone } from "../../format/datetime.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { CollapsedBar } from "./CollapsedBar.js";
import type { ScoreboardGame } from "./ScoreboardModule.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");

function read<T>(name: string): T
{
	return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

const SCHEDULE = read<ScheduleDayPayload>("schedule-2026-09-05.json");
const MOMENTS = read<{ pregame: ScoreboardGame;
	live: ScoreboardGame; }>("schedule-823823-moments.json");

/** Final SF @ NYM, live CHC @ MIA, scheduled CHC @ MIA (keyed apart: the same game at another moment). */
const DAY: ScheduleDayPayload = {
	...SCHEDULE,
	games: [SCHEDULE.games[0]!, MOMENTS.live, {
		...MOMENTS.pregame,
		gamePk: 1,
	}],
	fetchedAt: "2026-09-05T20:57:20.000Z",
	windowMode: "cache",
	version: 1,
	lastChangedAt: "2026-09-05T20:57:20.000Z",
};

/** The API with one settings document (apply-if-newer) and the day above; returns the PUT bodies. */
function stubApi(stored: AccountSettings)
{
	let doc = stored;
	const puts: AccountSettings[] = [];
	vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
	{
		const { pathname } = new URL(request.url);
		if (pathname === "/api/v1/me") return jsonResponse(DEV_ACCOUNT);
		if (pathname.startsWith("/api/v1/me/download")) return jsonResponse({
			error: "not_found",
		}, 404);
		if (pathname === "/api/v1/schedule") return jsonResponse(DAY);
		if (request.method === "PUT")
		{
			const body = await request.json() as AccountSettings;
			puts.push(body);
			if (body.version > doc.version) doc = body;
		}
		return jsonResponse(doc);
	}));
	return puts;
}

/** The scoreboard with the store hydrated from `settings`. */
async function renderScoreboard(settings: Partial<AccountSettings>, variant: LayoutVariant = "mobile")
{
	stubApi({
		...DEFAULT_SETTINGS,
		...settings,
		version: 1,
	});
	await hydrateSettings();
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={["/games/2026-09-05"]}>
					<Routes>
						<Route path="/games/:date" element={<ScoreboardPage variant={variant} />} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
	await screen.findByText(/^Games —/);
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	setSessionToken(null);
	resetSettings();
	clearPersonalData();
});

describe("collapse non-favorites (S68)", () =>
{
	it("collapsed bar: games without a favorite fold into bars after the favorite's module, with swatches, abbreviations and score · state", async () =>
	{
		await renderScoreboard({
			favoriteTeamIds: [112],
			collapseNonFavorites: true,
		});
		const modules = screen.getAllByTestId("scoreboard-module");
		expect(modules.map((m) => m.dataset.phase)).toEqual(["live", "pregame"]);
		const [bar] = screen.getAllByTestId("collapsed-bar");
		const b = within(bar!);
		// Round swatches inside, by the score (owner, 2026-10-30: "like CHC o 1-0 o MIA").
		const order = [b.getByText("SF"), ...b.getAllByTestId("team-swatch"), b.getByText("NYM")];
		order.slice(1).forEach((node, i) => expect(order[i]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
		expect(b.getByTestId("collapsed-score").compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(b.getByTestId("collapsed-score").compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
		expect(b.getByTestId("collapsed-score")).toHaveTextContent("9–5");
		expect(b.getByTestId("collapsed-state")).toHaveTextContent(/^Final$/);
	});

	it("expands: choosing a collapsed bar opens the full module", async () =>
	{
		const user = userEvent.setup();
		await renderScoreboard({
			favoriteTeamIds: [112],
			collapseNonFavorites: true,
		});
		await user.click(screen.getByTestId("collapsed-bar"));
		expect(screen.queryByTestId("collapsed-bar")).toBeNull();
		expect(screen.getAllByTestId("scoreboard-module")).toHaveLength(3);
	});

	it("collapsed bar: a live bar names its inning; a scheduled bar shows its start time, or nothing without one", async () =>
	{
		await renderScoreboard({
			favoriteTeamIds: [137],
			collapseNonFavorites: true,
		});
		const [live, pregame] = screen.getAllByTestId("collapsed-bar");
		expect(live).toHaveAccessibleName("CHC at MIA, Top 3rd: show the game");
		expect(within(live!).getByTestId("collapsed-score")).toHaveTextContent("1–0");
		expect(within(live!).getByTestId("collapsed-state")).toHaveTextContent("Top 3rd · 2-2, 2 out");
		expect(within(pregame!).getByTestId("collapsed-score")).toHaveTextContent("@");
		expect(within(pregame!).getByTestId("collapsed-state")).toHaveTextContent(formatGameTime("2026-09-05T20:10:00Z", viewerTimeZone()));
		cleanup();
		render(
			<MantineProvider>
				<CollapsedBar game={{
					...MOMENTS.pregame,
					startTime: undefined,
				}} onExpand={() => undefined}
				/>
			</MantineProvider>,
		);
		expect(screen.getByTestId("collapsed-state")).toBeEmptyDOMElement();
		expect(screen.getByTestId("collapsed-bar")).toHaveAccessibleName("CHC at MIA: show the game");
	});

	it("collapsed bar: at medium and desktop the favorite's module spans the row; on mobile, and with nothing collapsed, it doesn't", async () =>
	{
		const spans = () => screen.getAllByTestId("scoreboard-module").map((m) => m.closest("[data-testid=scoreboard-wide]") !== null);
		await renderScoreboard({
			favoriteTeamIds: [112],
			collapseNonFavorites: true,
		}, "desktop");
		expect(spans()).toEqual([true, true]);
		cleanup();
		resetSettings();
		await renderScoreboard({
			favoriteTeamIds: [112],
			collapseNonFavorites: true,
		});
		expect(spans()).toEqual([false, false]);
		cleanup();
		resetSettings();
		await renderScoreboard({
			favoriteTeamIds: [112],
		}, "desktop");
		expect(spans()).toEqual([false, false, false]);
	});

	it("with no favorites nothing collapses", async () =>
	{
		await renderScoreboard({
			collapseNonFavorites: true,
		});
		expect(screen.queryByTestId("collapsed-bar")).toBeNull();
		expect(screen.getAllByTestId("scoreboard-module")).toHaveLength(3);
	});
});

describe("Hide Scores (S68)", () =>
{
	it("hidden: R·H·E show –, records ▒▒-▒▒, the pitchers of record are masked, the count, AB / P and probables stay", async () =>
	{
		await renderScoreboard({
			hideScores: true,
		});
		const [final, live, pregame] = screen.getAllByTestId("scoreboard-module").map((m) => within(m));
		expect(final!.getAllByTestId("runs").map((c) => c.textContent)).toEqual(["–", "–"]);
		expect(final!.getAllByTestId("hits").map((c) => c.textContent)).toEqual(["–", "–"]);
		expect(final!.getByText((_, el) => el?.textContent === "SF (▒▒-▒▒)" && el.tagName === "P")).toBeInTheDocument();
		expect(final!.getByText((_, el) => el?.textContent === "W: ▒▒▒▒▒▒" && el.tagName === "P")).toBeInTheDocument();
		expect(final!.queryByText(/Molina/)).toBeNull();
		expect(live!.getByText("2-2, 2 out")).toBeInTheDocument();
		expect(live!.getByText("AB: A. Bregman")).toBeInTheDocument();
		expect(pregame!.getByText("J. Assad")).toBeInTheDocument();
		expect(pregame!.getByText((_, el) => el?.textContent === "CHC (▒▒-▒▒)" && el.tagName === "P")).toBeInTheDocument();
		expect(screen.queryByText(/Scores hidden/)).toBeNull();
	});

	it("hidden: a collapsed bar shows the state only", async () =>
	{
		await renderScoreboard({
			favoriteTeamIds: [112],
			collapseNonFavorites: true,
			hideScores: true,
		});
		expect(screen.getByTestId("collapsed-state")).toHaveTextContent(/^Final$/);
		expect(screen.getByTestId("collapsed-score")).toHaveTextContent("@");
	});

	it("structure: a masked module keeps the same cells and rows as an unmasked one, so its height doesn't change", async () =>
	{
		const shape = () => screen.getAllByTestId("scoreboard-module").map((m) => [
			m.querySelectorAll("[data-testid=team-row]").length,
			m.querySelectorAll("[data-testid=runs], [data-testid=hits], [data-testid=errors]").length,
			m.querySelectorAll("[data-testid=team-row] p").length,
			m.querySelectorAll("[data-testid=slot-pitchers] p").length,
		]);
		await renderScoreboard({});
		const shown = shape();
		cleanup();
		resetSettings();
		await renderScoreboard({
			hideScores: true,
		});
		expect(shape()).toEqual(shown);
	});
});

describe("Settings toggles (S68)", () =>
{
	it("toggles: Collapse Non-Favorites and Hide Scores save to the account and update a mounted scoreboard without reload", async () =>
	{
		const puts = stubApi({
			...DEFAULT_SETTINGS,
			favoriteTeamIds: [112],
			version: 1,
		});
		setSessionToken(DEV_SIGN_IN_TOKEN);
		const user = userEvent.setup();
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
		await screen.findAllByTestId("scoreboard-module");
		await waitFor(() => expect(screen.getByRole("switch", {
			name: "Collapse Non-Favorites",
		})).not.toBeChecked());

		await user.click(screen.getByRole("switch", {
			name: "Collapse Non-Favorites",
		}));
		expect(await screen.findByTestId("collapsed-bar")).toBeInTheDocument();
		await waitFor(() => expect(puts.at(-1)?.collapseNonFavorites).toBe(true));

		await user.click(screen.getByRole("switch", {
			name: "Hide Scores",
		}));
		expect(screen.getByTestId("collapsed-state")).toHaveTextContent(/^Final$/);
		await waitFor(() => expect(puts.at(-1)?.hideScores).toBe(true));
	});
});
