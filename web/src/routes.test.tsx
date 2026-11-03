/**
 * Settings are signed-in only (ADR-027, S59): signed out, the nav item is
 * absent and `/settings` redirects to the scoreboard; signed in, both render.
 * Renders the real shell and routes with the session read from a stubbed API;
 * at the default (mobile) pairing the nav lives in the drawer, so the tests open it.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "./api/queryClient.js";
import { AppShellLayout } from "./layout/AppShellLayout.js";
import { AppRoutes } from "./routes.js";
import { SessionProvider } from "./session/SessionProvider.js";
import { DEV_SIGN_IN_TOKEN } from "./session/session.js";
import { setSessionToken } from "./session/token.js";
import { jsonResponse } from "./test/jsonResponse.js";
import { stubMeApi } from "./test/meApi.js";

/** Shows the router's current path, to observe redirects. */
function CurrentPath()
{
	return <output aria-label="path">{useLocation().pathname}</output>;
}

function renderApp(path: string)
{
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<SessionProvider>
					<MemoryRouter initialEntries={[path]}>
						<AppShellLayout>
							{(variant) => <AppRoutes variant={variant} />}
						</AppShellLayout>
						<CurrentPath />
					</MemoryRouter>
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

beforeEach(() =>
{
	setSessionToken(null);
	stubMeApi();
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

describe("Settings gating", () =>
{
	it("signed out: no Settings nav item, and /settings redirects to the scoreboard", async () =>
	{
		renderApp("/settings");
		// Signed out, /settings first asks the server whether the account was just deleted (S79, S87).
		// The scoreboard's default day stays unanswered here (S111), so the path rests on /games.
		await waitFor(() => expect(screen.getByLabelText("path")).toHaveTextContent(/^\/games$/));
		await userEvent.click(screen.getByRole("button", {
			name: "Open navigation",
		}));
		expect(await screen.findByRole("link", {
			name: "Scoreboard",
		})).toBeInTheDocument();
		expect(screen.queryByRole("link", {
			name: "Settings",
		})).toBeNull();
	});

	it("signed in: the Settings nav item and /settings both render", async () =>
	{
		setSessionToken(DEV_SIGN_IN_TOKEN);
		renderApp("/settings");
		await userEvent.click(await screen.findByRole("button", {
			name: "Open navigation",
		}));
		expect(await screen.findByRole("link", {
			name: "Settings",
		})).toBeInTheDocument();
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/settings$/);
		// The settings page is its own chunk (S110), so its heading arrives once it loads.
		expect(await screen.findByRole("heading", {
			name: /settings/i,
		})).toBeInTheDocument();
	});
});

describe("default day (S111)", () =>
{
	it.each(["/", "/games"])("default day: %s opens the day the server names", async (path) =>
	{
		const me = stubMeApi();
		vi.stubGlobal("fetch", vi.fn((request: Request) => new URL(request.url).pathname === "/api/v1/scoreboard/default-date"
			? Promise.resolve(jsonResponse({
				date: "2026-10-28",
			}))
			: me(request)));
		renderApp(path);
		await waitFor(() => expect(screen.getByLabelText("path")).toHaveTextContent(/^\/games\/2026-10-28$/));
	});
});
