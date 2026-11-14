/**
 * The deleted-account page (S79, to standings-search-settings A5): signed out on
 * `/settings`, the app asks the server once whether this browser's account was just
 * deleted (S87's `HttpOnly` cookie) and shows the page, or redirects as before.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../../api/queryClient.js";
import { AppShellLayout } from "../../layout/AppShellLayout.js";
import { AppRoutes } from "../../routes.js";
import { SessionProvider } from "../../session/SessionProvider.js";
import { setSessionToken } from "../../session/token.js";
import { jsonResponse } from "../../test/jsonResponse.js";

/** The server's answer to a signed-out `/api/v1/me`, counting the calls. */
function stubMe(answer: "account_deleted" | "unauthorized" | "network" | "pending"): { meCalls: () => number }
{
	let calls = 0;
	vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
	{
		if (new URL(request.url).pathname !== "/api/v1/me") return new Promise<Response>(() => undefined);
		calls++;
		if (answer === "pending") return new Promise<Response>(() => undefined);
		if (answer === "network") throw new TypeError("Failed to fetch");
		return jsonResponse({
			error: answer,
		}, 401);
	}));
	return {
		meCalls: () => calls,
	};
}

/** Answers `(min-width: Nem)` as a viewport `width` px wide. */
function viewport(width: number): void
{
	vi.spyOn(window, "matchMedia").mockImplementation((query: string) =>
	{
		const min = /min-width:\s*([\d.]+)em/.exec(query);
		return {
			matches: min ? width >= Number(min[1]) * 16 : false,
			media: query,
			onchange: null,
			addListener: () => undefined,
			removeListener: () => undefined,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			dispatchEvent: () => false,
		};
	});
}

function Path(): ReactNode
{
	return <output aria-label="path">{useLocation().pathname}</output>;
}

function renderSettings(): void
{
	render(
		<StrictMode>
			<MantineProvider>
				<QueryClientProvider client={createQueryClient()}>
					<SessionProvider>
						<MemoryRouter initialEntries={["/settings"]}>
							<AppShellLayout>{(variant) => <AppRoutes variant={variant} />}</AppShellLayout>
							<Path />
						</MemoryRouter>
					</SessionProvider>
				</QueryClientProvider>
			</MantineProvider>
		</StrictMode>,
	);
}

beforeEach(() =>
{
	setSessionToken(null);
});

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("the deleted-account page (A5)", () =>
{
	it("deleted page: under StrictMode a signed-out /settings asks /me exactly once, and shows the page on account_deleted", async () =>
	{
		const { meCalls } = stubMe("account_deleted");
		renderSettings();
		expect(await screen.findByText("Your account and your data are deleted.")).toBeInTheDocument();
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/settings$/);
		expect(meCalls()).toBe(1);
	});

	it("deleted page: while the request is in flight the page area is empty and nothing redirects", async () =>
	{
		const { meCalls } = stubMe("pending");
		renderSettings();
		await waitFor(() => expect(meCalls()).toBe(1));
		expect(screen.getByRole("main")).toBeEmptyDOMElement();
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/settings$/);
	});

	it("deleted page: a plain 401 redirects to the scoreboard as before", async () =>
	{
		stubMe("unauthorized");
		renderSettings();
		await waitFor(() => expect(screen.getByLabelText("path")).toHaveTextContent(/^\/games/));
	});

	it("deleted page: a network error redirects to the scoreboard as before", async () =>
	{
		stubMe("network");
		renderSettings();
		await waitFor(() => expect(screen.getByLabelText("path")).toHaveTextContent(/^\/games/));
	});

	for (const [variant, width] of [["mobile", 390], ["desktop", 1200]] as const)
	{
		it(`deleted page: at ${variant}, Sign in in the header, no footer, and no rail item active or bold`, async () =>
		{
			viewport(width);
			stubMe("account_deleted");
			renderSettings();
			await screen.findByText("Your account and your data are deleted.");
			expect(screen.getByRole("button", {
				name: "Sign in",
			})).toBeInTheDocument();
			expect(screen.queryByText(/baseball\.theater$/)).toBeNull();
			if (variant === "desktop")
			{
				const rail = screen.getByRole("navigation", {
					name: "Main",
				});
				// The section items, not the wordmark's link home above them.
				for (const link of within(within(rail).getByRole("list")).getAllByRole("link"))
				{
					expect(link).not.toHaveAttribute("aria-current");
					const label = link.querySelector("span");
					expect(label?.style.fontWeight).toBe("400");
				}
			}
		});
	}
});
