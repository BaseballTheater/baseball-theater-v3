/**
 * S4: Standings on the committed recording, `fixtures/standings-2026-09-05.json` (six
 * divisions, AL East first, Tampa Bay leading it), served as the API would; and the
 * generic loading, empty and error states.
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
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import type { StandingsPayload } from "../api/standings.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { StandingsPage } from "./StandingsPage.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

const STANDINGS = JSON.parse(readFileSync(join(FIXTURES, "standings-2026-09-05.json"), "utf8")) as StandingsPayload;

function renderStandings(path = "/standings?date=2026-09-05")
{
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={[path]}>
					<StandingsPage />
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

function serve(response: () => Response)
{
	const fetchMock = vi.fn((_request: Request) => Promise.resolve(response()));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

describe("StandingsPage (S4)", () =>
{
	it("names: the recording's teams, asked for the URL's day", async () =>
	{
		const fetchMock = serve(() => jsonResponse(STANDINGS));
		renderStandings();
		expect(await screen.findByText("New York Yankees")).toBeInTheDocument();
		expect(screen.getByText("Tampa Bay Rays")).toBeInTheDocument();
		const url = new URL(fetchMock.mock.calls[0]![0].url);
		expect(url.pathname).toBe("/api/v1/standings");
		expect(url.searchParams.get("date")).toBe("2026-09-05");
	});

	it("table: one per division, headed by divisionName, each row swatch, name, abbreviation, W, L, PCT, GB", async () =>
	{
		serve(() => jsonResponse(STANDINGS));
		renderStandings();
		const tables = await screen.findAllByTestId("division-table");
		expect(tables).toHaveLength(6);
		expect(screen.getAllByRole("heading", {
			level: 3,
		}).map((h) => h.textContent)).toEqual(["AL East", "AL Central", "AL West", "NL East", "NL Central", "NL West"]);
		const alEast = within(tables[0]!);
		expect(alEast.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Team", "", "W", "L", "PCT", "GB"]);
		const yankees = alEast.getAllByTestId("standings-row")[1]!;
		expect(within(yankees).getByTestId("team-swatch")).toBeInTheDocument();
		expect(within(yankees).getAllByRole("cell").map((c) => c.textContent)).toEqual(["New York Yankees", "NYY", "81", "61", ".570", "4.0"]);
	});

	it("leader: each division's leader reads — for games back, and no other row does", async () =>
	{
		serve(() => jsonResponse(STANDINGS));
		renderStandings();
		for (const table of await screen.findAllByTestId("division-table"))
		{
			const gb = within(table).getAllByTestId("games-back").map((c) => c.textContent);
			expect(gb[0]).toBe("—");
			expect(gb.slice(1)).not.toContain("—");
		}
	});

	it("table: a division the recording names but BT doesn't know keeps MLB's name; one with neither reads Division", async () =>
	{
		const [first, second] = STANDINGS.divisions;
		serve(() => jsonResponse({
			...STANDINGS,
			divisions: [{
				...first!,
				divisionId: null,
				name: "Spring League",
			}, {
				...second!,
				divisionId: 999,
				name: null,
			}],
		}));
		renderStandings();
		await screen.findAllByTestId("division-table");
		expect(screen.getAllByRole("heading", {
			level: 3,
		}).map((h) => h.textContent)).toEqual(["Spring League", "Division"]);
	});

	it("without a date in the URL, the server's today is asked for", async () =>
	{
		const fetchMock = serve(() => jsonResponse(STANDINGS));
		renderStandings("/standings");
		await screen.findAllByTestId("division-table");
		expect(new URL(fetchMock.mock.calls[0]![0].url).searchParams.has("date")).toBe(false);
	});

	it("loading: the title over ViewState's loader", () =>
	{
		vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
		renderStandings();
		expect(screen.getByRole("heading", {
			name: "Standings",
		})).toBeInTheDocument();
		expect(screen.getByLabelText("Loading")).toBeInTheDocument();
	});

	it("empty: a day with no tables says so", async () =>
	{
		serve(() => jsonResponse({
			...STANDINGS,
			divisions: [],
		}));
		renderStandings();
		expect(await screen.findByText("No standings for this date.")).toBeInTheDocument();
		expect(screen.queryByTestId("division-table")).toBeNull();
	});

	it("error: Couldn't load standings, the hint, and Retry asks again", async () =>
	{
		const fetchMock = serve(() => jsonResponse({
			error: "unavailable",
		}, 503));
		const user = userEvent.setup();
		renderStandings();
		const alert = await screen.findByRole("alert");
		expect(within(alert).getByText("Couldn't load standings")).toBeInTheDocument();
		expect(within(alert).getByText("Check your connection and try again")).toBeInTheDocument();
		fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(STANDINGS)));
		await user.click(within(alert).getByRole("button", {
			name: "Retry",
		}));
		expect(await screen.findByText("New York Yankees")).toBeInTheDocument();
	});
});
