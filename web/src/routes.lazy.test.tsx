/**
 * S110: pages past the scoreboard load on demand. The standings page's import is held
 * back by a gate, so the route shows what a viewer sees while the chunk arrives
 * (ViewState's loading treatment, no other screen), then the page once it lands.
 */
import { MantineProvider } from "@mantine/core";
import {
	cleanup, render, screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { AppRoutes } from "./routes.js";

/** Opens the gate that holds back the standings chunk. */
let arrive: () => void = () => undefined;
const arrived = new Promise<void>((resolve) =>
{
	arrive = resolve;
});

vi.mock("./pages/StandingsPage.js", async () =>
{
	await arrived;
	return {
		StandingsPage: () => <h2>Standings page</h2>,
	};
});

afterEach(() =>
{
	cleanup();
});

describe("lazy pages (S110)", () =>
{
	it("fallback: while a page's chunk loads the route shows ViewState's loader alone, then the page", async () =>
	{
		render(
			<MantineProvider>
				<MemoryRouter initialEntries={["/standings"]}>
					<AppRoutes variant="mobile" />
				</MemoryRouter>
			</MantineProvider>,
		);
		expect(screen.getByLabelText("Loading")).toBeInTheDocument();
		expect(screen.queryByRole("heading")).toBeNull();
		expect(screen.queryByRole("alert")).toBeNull();

		arrive();
		expect(await screen.findByRole("heading", {
			name: "Standings page",
		})).toBeInTheDocument();
		expect(screen.queryByLabelText("Loading")).toBeNull();
	});
});
