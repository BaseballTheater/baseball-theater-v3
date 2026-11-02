/**
 * S73: the update notice (S55 shell-scoreboard A1, `shell-update-*`) through the real
 * shell, with `registerSW` replaced by a stand-in that says a new worker is waiting.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, render, screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import { AppShellLayout } from "../layout/AppShellLayout.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { stubMeApi } from "../test/meApi.js";
import type { RegisterServiceWorker } from "./updates.js";
import {
	UPDATE_MESSAGE, exposeDevUpdateTrigger, resetUpdates, startUpdates, useUpdateNotice,
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
	vi.unstubAllGlobals();
});

describe("the update notice (S73)", () =>
{
	it("update notice: nothing until a worker waits, then the notice with Reload and ✕", async () =>
	{
		const sw = fakeRegister();
		startUpdates(sw.register);
		renderShell();
		expect(screen.queryByText(UPDATE_MESSAGE)).toBeNull();
		await sw.waiting();
		const notice = screen.getByRole("status");
		expect(notice).toHaveTextContent("An update to Baseball Theater is ready.");
		expect(screen.getByRole("button", {
			name: "Reload",
		})).toBeInTheDocument();
		expect(screen.getByRole("button", {
			name: "Dismiss",
		})).toBeInTheDocument();
	});

	it("Reload activates the waiting worker and reloads; ✕ hides the notice", async () =>
	{
		const user = userEvent.setup();
		const sw = fakeRegister();
		startUpdates(sw.register);
		renderShell();
		await sw.waiting();
		await user.click(screen.getByRole("button", {
			name: "Reload",
		}));
		expect(sw.activate).toHaveBeenCalledWith(true);
		await user.click(screen.getByRole("button", {
			name: "Dismiss",
		}));
		expect(screen.queryByText(UPDATE_MESSAGE)).toBeNull();
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
