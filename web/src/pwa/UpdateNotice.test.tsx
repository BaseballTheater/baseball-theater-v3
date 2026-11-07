/**
 * S73: the update notice (S55 shell-scoreboard A1's copy; A6's floating box with Snooze and
 * Update Now) through the real shell, with `registerSW` replaced by a stand-in that says a new
 * worker is waiting.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, fireEvent, render, screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import { AppShellLayout } from "../layout/AppShellLayout.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { readStored, writeStored } from "../storage/storage.js";
import { stubMeApi } from "../test/meApi.js";
import type { RegisterServiceWorker } from "./updates.js";
import {
	SNOOZE_MS, UPDATE_MESSAGE, exposeDevUpdateTrigger, resetUpdates, startUpdates, useUpdateNotice,
} from "./updates.js";

function Shell()
{
	return (
		<AppShellLayout notice={useUpdateNotice()}>
			{() => <p>page</p>}
		</AppShellLayout>
	);
}

function renderShell()
{
	stubMeApi();
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<SessionProvider>
					<MemoryRouter>
						<Shell />
					</MemoryRouter>
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

/** A `registerSW` stand-in: records its options and returns a mocked activate. */
function fakeRegister()
{
	const activate = vi.fn((_reload?: boolean) => Promise.resolve());
	let needRefresh: (() => void) | undefined;
	const register: RegisterServiceWorker = (options) =>
	{
		needRefresh = options.onNeedRefresh;
		expect(options.immediate).toBe(true);
		return activate;
	};
	return {
		register,
		activate,
		waiting: () => act(() => needRefresh?.()),
	};
}

afterEach(() =>
{
	cleanup();
	resetUpdates();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("the update notice (S73)", () =>
{
	it("update notice: nothing until a worker waits, then the floating notice with Snooze and Update Now, and no ✕ (A6)", async () =>
	{
		const sw = fakeRegister();
		startUpdates(sw.register);
		renderShell();
		expect(screen.queryByText(UPDATE_MESSAGE)).toBeNull();
		await sw.waiting();
		const notice = screen.getByRole("status");
		expect(notice).toHaveTextContent("An update to Baseball Theater is ready.");
		expect(screen.getByTestId("notice-float")).toContainElement(notice);
		expect(screen.queryByTestId("notice-slot")).toBeNull();
		for (const name of ["Snooze", "Update Now"])
		{
			expect(screen.getByRole("button", {
				name,
			})).toBeInTheDocument();
		}
		expect(screen.queryByRole("button", {
			name: "Dismiss",
		})).toBeNull();
	});

	it("Update Now, A6's replacement for Reload, activates the waiting worker and reloads", async () =>
	{
		const user = userEvent.setup();
		const sw = fakeRegister();
		startUpdates(sw.register);
		renderShell();
		await sw.waiting();
		await user.click(screen.getByRole("button", {
			name: "Update Now",
		}));
		expect(sw.activate).toHaveBeenCalledWith(true);
	});

	it("Snooze hides the notice for an hour, then it comes back on its own, without a reload", async () =>
	{
		vi.useFakeTimers();
		const sw = fakeRegister();
		startUpdates(sw.register);
		renderShell();
		await sw.waiting();
		fireEvent.click(screen.getByRole("button", {
			name: "Snooze",
		}));
		expect(screen.queryByText(UPDATE_MESSAGE)).toBeNull();
		act(() => vi.advanceTimersByTime(SNOOZE_MS - 1000));
		expect(screen.queryByText(UPDATE_MESSAGE)).toBeNull();
		act(() => vi.advanceTimersByTime(1000));
		expect(screen.getByText(UPDATE_MESSAGE)).toBeInTheDocument();
		expect(sw.activate).not.toHaveBeenCalled();
	});

	it("Snooze is remembered in this browser: a reload within the hour that finds the worker still waiting stays quiet", async () =>
	{
		vi.useFakeTimers();
		const sw = fakeRegister();
		startUpdates(sw.register);
		renderShell();
		await sw.waiting();
		fireEvent.click(screen.getByRole("button", {
			name: "Snooze",
		}));
		// A reload: the page's memory is gone, the stored snooze is not, and the worker still waits.
		cleanup();
		const snoozed = readStored("bt.updateSnoozedUntil");
		resetUpdates();
		writeStored("bt.updateSnoozedUntil", snoozed);
		const again = fakeRegister();
		startUpdates(again.register);
		renderShell();
		await again.waiting();
		expect(screen.queryByText(UPDATE_MESSAGE)).toBeNull();
		act(() => vi.advanceTimersByTime(SNOOZE_MS));
		expect(screen.getByText(UPDATE_MESSAGE)).toBeInTheDocument();
	});

	it("a worker that was already waiting when the shell mounts shows at once; the dev trigger shows it too", async () =>
	{
		const sw = fakeRegister();
		startUpdates(sw.register);
		await sw.waiting();
		renderShell();
		expect(screen.getByText(UPDATE_MESSAGE)).toBeInTheDocument();
		cleanup();
		resetUpdates();

		exposeDevUpdateTrigger();
		renderShell();
		act(() => (window as { btShowUpdate?: () => void }).btShowUpdate?.());
		expect(screen.getByText(UPDATE_MESSAGE)).toBeInTheDocument();
	});
});
