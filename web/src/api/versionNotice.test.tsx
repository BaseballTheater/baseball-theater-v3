/**
 * S28: a retired API version, seen by the web client. The scoreboard loads (200); when a
 * later request comes back 426 `version_unsupported`, the shell floats the one update notice
 * with Update Now (shell-scoreboard A6 replaced Reload), and the games already on screen stay
 * readable behind it. A normal 200 raises nothing.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, render, screen, waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import {
	ACTIVATE_TIMEOUT_MS, updateToNewVersion, useUpdateNotice,
} from "../pwa/updates.js";
import { resetVersionNotice } from "./versionNotice.js";

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

/**
 * A stand-in for `navigator.serviceWorker` after a deploy: nothing waits yet; `update()` finds
 * the new worker, which installs on the next tick and, told `SKIP_WAITING`, takes control.
 * Each step is written to `log`, so a test can check the order. `fault` breaks one step, to
 * check that a failed update never reloads a page the old worker controls (`controlled`).
 */
function fakeServiceWorkers(log: string[], { controlled = false, fault }: {
	controlled?: boolean;
	fault?: "update-stalls" | "update-fails" | "install-fails" | "install-stalls" | "takeover-stalls";
} = {}): ServiceWorkerContainer
{
	const container = new EventTarget();
	const worker = Object.assign(new EventTarget(), {
		state: "installing" as ServiceWorkerState,
		postMessage: (message: { type: string }) =>
		{
			log.push(message.type);
			if (fault === "takeover-stalls") return;
			worker.state = "activated";
			container.dispatchEvent(new Event("controllerchange"));
		},
	});
	const registration = {
		waiting: null as typeof worker | null,
		installing: null as typeof worker | null,
		update: () =>
		{
			log.push("update");
			if (fault === "update-stalls") return new Promise<never>(() => undefined);
			if (fault === "update-fails") return Promise.reject(new TypeError("Failed to update a ServiceWorker"));
			registration.installing = worker;
			if (fault !== "install-stalls") setTimeout(() =>
			{
				worker.state = fault === "install-fails" ? "redundant" : "installed";
				registration.installing = null;
				if (fault !== "install-fails") registration.waiting = worker;
				worker.dispatchEvent(new Event("statechange"));
			}, 0);
			return Promise.resolve(registration);
		},
	};
	return Object.assign(container, {
		controller: controlled ? {} : null,
		getRegistration: () => Promise.resolve(registration),
	}) as unknown as ServiceWorkerContainer;
}

/** Runs Update Now on fake timers, past every step's `ACTIVATE_TIMEOUT_MS`, and returns whether it finished. */
async function updateWithTimeouts(container: ServiceWorkerContainer, reload: () => void): Promise<boolean>
{
	vi.useFakeTimers();
	let finished = false;
	void updateToNewVersion(container, reload).then(() =>
	{
		finished = true;
	});
	await vi.advanceTimersByTimeAsync(ACTIVATE_TIMEOUT_MS * 3 + 1);
	vi.useRealTimers();
	return finished;
}

function Shell()
{
	return (
		<AppShellLayout notice={useUpdateNotice()}>
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
	vi.restoreAllMocks();
});

describe("a retired API version (S28)", () =>
{
	it("200: a normal answer raises no notice", async () =>
	{
		serve();
		await renderApp();
		expect(screen.queryByText(MESSAGE)).toBeNull();
	});

	it("426: the next answer being 426 raises the reload notice through the notice slot, with Update Now and Snooze", async () =>
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
			name: "Update Now",
		})).toBeInTheDocument();
		expect(screen.getByRole("button", {
			name: "Snooze",
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

	it("426: Update Now asks the service worker for the new version, activates it, then reloads (not a bare reload onto the old cached shell)", async () =>
	{
		const log: string[] = [];
		await updateToNewVersion(fakeServiceWorkers(log), () => log.push("reload"));
		expect(log).toEqual(["update", "SKIP_WAITING", "reload"]);
	});

	it("426: Update Now with no service worker (dev, old browsers) still reloads", async () =>
	{
		const reload = vi.fn();
		await updateToNewVersion(undefined, reload);
		expect(reload).toHaveBeenCalledOnce();
	});

	it("426: Update Now on a page the old worker controls reloads once the new worker takes control", async () =>
	{
		const log: string[] = [];
		await updateToNewVersion(fakeServiceWorkers(log, {
			controlled: true,
		}), () => log.push("reload"));
		expect(log).toEqual(["update", "SKIP_WAITING", "reload"]);
	});

	it("426: an update request that never answers stops Update Now waiting, without reloading, so it can be tried again", async () =>
	{
		const reload = vi.fn();
		const finished = await updateWithTimeouts(fakeServiceWorkers([], {
			fault: "update-stalls",
		}), reload);
		expect(finished).toBe(true);
		expect(reload).not.toHaveBeenCalled();
	});

	// Reloading here would let the old worker serve its cached copy of the retired app: 426 again, readable screen lost.
	for (const fault of ["update-fails", "install-fails", "install-stalls", "takeover-stalls"] as const)
	{
		it(`426: ${fault}: a page the old worker controls is not reloaded; Update Now finishes and stays available`, async () =>
		{
			const log: string[] = [];
			const finished = await updateWithTimeouts(fakeServiceWorkers(log, {
				controlled: true,
				fault,
			}), () => log.push("reload"));
			expect(finished).toBe(true);
			expect(log).not.toContain("reload");
		});

		it(`426: ${fault}: a page no worker controls still reloads, since the network answers it`, async () =>
		{
			const log: string[] = [];
			const finished = await updateWithTimeouts(fakeServiceWorkers(log, {
				fault,
			}), () => log.push("reload"));
			expect(finished).toBe(true);
			expect(log.at(-1)).toBe("reload");
		});
	}

	it("426: after a failed update the notice and its Update Now stay on screen for a retry", async () =>
	{
		const log: string[] = [];
		vi.stubGlobal("navigator", Object.assign(Object.create(navigator) as Navigator, {
			serviceWorker: fakeServiceWorkers(log, {
				controlled: true,
				fault: "update-fails",
			}),
		}));
		const api = serve();
		const client = await renderApp();
		api.retire();
		await act(() => client.refetchQueries({
			queryKey: scheduleKey("2024-07-04"),
		}));
		await userEvent.click(await screen.findByRole("button", {
			name: "Update Now",
		}));
		await waitFor(() => expect(log).toEqual(["update"]));
		expect(screen.getByText(MESSAGE)).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", {
			name: "Update Now",
		}));
		await waitFor(() => expect(log).toEqual(["update", "update"]));
	});

	it("426: the notice's Update Now takes that path: it asks the service worker for the new version", async () =>
	{
		const log: string[] = [];
		vi.stubGlobal("navigator", Object.assign(Object.create(navigator) as Navigator, {
			serviceWorker: fakeServiceWorkers(log),
		}));
		// jsdom can't navigate: the closing reload only logs "not implemented".
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const api = serve();
		const client = await renderApp();
		api.retire();
		await act(() => client.refetchQueries({
			queryKey: scheduleKey("2024-07-04"),
		}));
		await userEvent.click(await screen.findByRole("button", {
			name: "Update Now",
		}));
		await waitFor(() => expect(log).toEqual(["update", "SKIP_WAITING"]));
	});
});
