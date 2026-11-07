/**
 * S73: the Settings install tip (S55 standings-search-settings A1 `settings-install-*`; S56 A2
 * `settings-install-ios-mobile`; laid out by A8: at the very top, outside the Settings and
 * Account frames, with a Tip mark, dismissable for good in this browser). It shows only when
 * the browser has offered to install, or on iPhone/iPad as the Share steps, and never once
 * the app is installed.
 */
import { DEFAULT_SETTINGS } from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, render, screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	afterEach, beforeAll, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../../api/queryClient.js";
import {
	captureInstallPrompt, isIos, resetInstall,
} from "../../pwa/install.js";
import { DEV_SIGN_IN_TOKEN } from "../../session/session.js";
import { clearPersonalData, readStored } from "../../storage/storage.js";
import { SessionProvider } from "../../session/SessionProvider.js";
import { setSessionToken } from "../../session/token.js";
import { resetSettings } from "../../settings/store.js";
import { jsonResponse } from "../../test/jsonResponse.js";
import { DEV_ACCOUNT } from "../../test/meApi.js";
import { SettingsPage } from "../SettingsPage.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

function renderSettings()
{
	vi.stubGlobal("fetch", vi.fn((request: Request) =>
	{
		const { pathname } = new URL(request.url);
		if (pathname === "/api/v1/me") return Promise.resolve(jsonResponse(DEV_ACCOUNT));
		if (pathname.startsWith("/api/v1/me/download")) return Promise.resolve(jsonResponse({
			error: "not_found",
		}, 404));
		return Promise.resolve(jsonResponse(DEFAULT_SETTINGS));
	}));
	setSessionToken(DEV_SIGN_IN_TOKEN);
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<SessionProvider>
					<SettingsPage variant="mobile" />
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

/** Chromium's install offer, as the browser fires it; returns its `prompt`. */
function offerInstall()
{
	const prompt = vi.fn(() => Promise.resolve());
	const event = Object.assign(new Event("beforeinstallprompt", {
		cancelable: true,
	}), {
		prompt,
	});
	act(() =>
	{
		window.dispatchEvent(event);
	});
	expect(event.defaultPrevented).toBe(true);
	return prompt;
}

/** The page's parts, top to bottom: the install tip (when shown), then A8's two frames. */
function groups(): string[]
{
	return [...document.querySelectorAll("[aria-label='Install tip'], section[aria-label='Settings'], section[aria-label='Account']")]
		.map((el) => el.getAttribute("aria-label") ?? "");
}

beforeAll(() => captureInstallPrompt());

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	setSessionToken(null);
	resetSettings();
	resetInstall();
});

describe("Settings install tip (S73; A8)", () =>
{
	it("install row: no tip until the browser offers; then it sits at the very top, above both frames, and Install app prompts", async () =>
	{
		const user = userEvent.setup();
		renderSettings();
		await screen.findByText(/Signed in as/);
		expect(groups()).toEqual(["Settings", "Account"]);

		const prompt = offerInstall();
		expect(groups()).toEqual(["Install tip", "Settings", "Account"]);
		expect(screen.getByText("Tip")).toBeInTheDocument();
		expect(screen.getByText("Open Baseball Theater from your home screen, without the browser bar.")).toBeInTheDocument();
		await user.click(screen.getByRole("button", {
			name: "Install app",
		}));
		expect(prompt).toHaveBeenCalledTimes(1);
	});

	it("installed: once the app installs, or when it already runs standalone, there is no install tip", async () =>
	{
		renderSettings();
		await screen.findByText(/Signed in as/);
		offerInstall();
		expect(groups()).toContain("Install tip");
		act(() =>
		{
			window.dispatchEvent(new Event("appinstalled"));
		});
		expect(groups()).not.toContain("Install tip");
		cleanup();
		resetInstall();

		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: query === "(display-mode: standalone)",
			media: query,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			onchange: null,
			dispatchEvent: () => false,
		}));
		renderSettings();
		await screen.findByText(/Signed in as/);
		offerInstall();
		expect(groups()).not.toContain("Install tip");
	});

	it("iOS: on iPhone the tip shows the Share steps without any offer, and no install link", async () =>
	{
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE);
		renderSettings();
		await screen.findByText(/Signed in as/);
		expect(groups()).toEqual(["Install tip", "Settings", "Account"]);
		expect(screen.getByText("Install Baseball Theater from Safari:")).toBeInTheDocument();
		expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Tap Share", "Choose “Add to Home Screen”"]);
		expect(screen.queryByRole("button", {
			name: "Install app",
		})).toBeNull();
	});

	it("install row tip: ✕ dismisses it for good in this browser, through sign-out and a new visit (A8)", async () =>
	{
		const user = userEvent.setup();
		renderSettings();
		await screen.findByText(/Signed in as/);
		offerInstall();
		await user.click(screen.getByRole("button", {
			name: "Dismiss tip",
		}));
		expect(groups()).toEqual(["Settings", "Account"]);
		expect(readStored("bt.installTipDismissed")).toBe("1");
		cleanup();
		clearPersonalData();

		renderSettings();
		await screen.findByText(/Signed in as/);
		offerInstall();
		expect(groups()).toEqual(["Settings", "Account"]);
	});

	it("iOS: an iPad that reports itself as a Mac is told apart by its touch screen; a Mac isn't", () =>
	{
		const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
		expect(isIos(IPHONE, 5)).toBe(true);
		expect(isIos(mac, 5)).toBe(true);
		expect(isIos(mac, 0)).toBe(false);
	});
});
