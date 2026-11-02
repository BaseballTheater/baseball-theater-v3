/**
 * S28: a retired API version, seen by the web client. The scoreboard loads (200); when a
 * later request comes back 426 `version_unsupported`, the shell's notice slot offers Reload,
 * and the games already on screen stay readable behind it. A normal 200 raises nothing.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, render, screen,
} from "@testing-library/react";
import {
	MemoryRouter, Route, Routes,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { AppShellLayout } from "../layout/AppShellLayout.js";
import { ScoreboardPage } from "../pages/ScoreboardPage.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { createQueryClient } from "./queryClient.js";
import { scheduleKey } from "./schedule.js";
import type { ScheduleDayPayload } from "./schedule.js";
import { resetVersionNotice, useVersionNotice } from "./versionNotice.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

const DAY: ScheduleDayPayload = {
	...JSON.parse(readFileSync(join(FIXTURES, "schedule-2024-07-04.json"), "utf8")) as ScheduleDayPayload,
	fetchedAt: "2024-07-04T23:00:00.000Z",
	windowMode: "cache",
	version: 1,
	lastChangedAt: "2024-07-04T23:00:00.000Z",
};

const MESSAGE = "An update to Baseball Theater is ready.";

/** The API: the day and an empty digest, until `retire()` makes every answer 426. */
function serve()
{
	let retired = false;
	vi.stubGlobal("fetch", vi.fn((request: Request) =>
	{
		const { pathname } = new URL(request.url);
		if (retired) return Promise.resolve(jsonResponse({
			error: "version_unsupported",
			hint: "This version of the app has been retired; reload to update.",
		}, 426));
		if (pathname === "/api/v1/me") return Promise.resolve(jsonResponse({
			error: "unauthorized",
		}, 401));
		if (pathname === "/api/v1/digest") return Promise.resolve(jsonResponse({
			date: "2024-07-04",
			items: [],
		}));
		return Promise.resolve(jsonResponse(DAY));
	}));
	return {
		retire: () =>
		{
			retired = true;
		},
	};
}

function Shell()
{
	return (
		<AppShellLayout notice={useVersionNotice()}>
			{(variant) => (
				<Routes>
					<Route path="/games/:date" element={<ScoreboardPage variant={variant} />} />
				</Routes>
			)}
		</AppShellLayout>
	);
}

async function renderApp()
{
	const client = createQueryClient();
	render(
		<MantineProvider>
			<QueryClientProvider client={client}>
				<SessionProvider>
					<MemoryRouter initialEntries={["/games/2024-07-04"]}>
						<Shell />
					</MemoryRouter>
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>,
	);
	await screen.findAllByTestId("scoreboard-module");
	return client;
}

afterEach(() =>
{
	cleanup();
	resetVersionNotice();
	vi.unstubAllGlobals();
});

describe("a retired API version (S28)", () =>
{
	it("200: a normal answer raises no notice", async () =>
	{
		serve();
		await renderApp();
		expect(screen.queryByText(MESSAGE)).toBeNull();
	});

	it("426: the next answer being 426 raises the reload notice through the notice slot", async () =>
	{
		const api = serve();
		const client = await renderApp();
		api.retire();
		await act(() => client.refetchQueries({
			queryKey: scheduleKey("2024-07-04"),
		}));
		const notice = await screen.findByRole("status");
		expect(notice).toHaveTextContent(MESSAGE);
		expect(screen.getByRole("button", {
			name: "Reload",
		})).toBeInTheDocument();
	});

	it("readable: the games already on screen stay behind the notice", async () =>
	{
		const api = serve();
		const client = await renderApp();
		const before = screen.getAllByTestId("scoreboard-module").map((m) => m.textContent);
		api.retire();
		await act(() => client.refetchQueries({
			queryKey: scheduleKey("2024-07-04"),
		}));
		await screen.findByText(MESSAGE);
		expect(screen.getAllByTestId("scoreboard-module").map((m) => m.textContent)).toEqual(before);
		expect(screen.queryByRole("alert")).toBeNull();
	});
});
