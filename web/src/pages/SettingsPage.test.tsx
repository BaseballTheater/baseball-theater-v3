/**
 * Settings to the ratified frames (S6; standings-search-settings, A3): the three
 * groups, one column on mobile and two on medium / desktop, the Account group
 * with "Signed in as {email}" and a "Sign out" text link, Favorite Teams that
 * survive a remount, and Opens First's three rooms.
 */
import type { AccountSettings } from "@bt/domain";
import { DEFAULT_SETTINGS } from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import type { LayoutVariant } from "../layout/variant.js";
import { DEV_SIGN_IN_TOKEN } from "../session/session.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { getSessionToken, setSessionToken } from "../session/token.js";
import { SettingsSync } from "../settings/SettingsSync.js";
import { resetSettings } from "../settings/store.js";
import { clearPersonalData } from "../storage/storage.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { DEV_ACCOUNT } from "../test/meApi.js";
import { SettingsPage } from "./SettingsPage.js";

/** The API as the server answers the dev session: `/me`, and one settings document with apply-if-newer. */
function stubAccountApi(stored: AccountSettings = DEFAULT_SETTINGS)
{
	let doc = stored;
	vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
	{
		const { pathname } = new URL(request.url);
		if (pathname === "/api/v1/me") return jsonResponse(DEV_ACCOUNT);
		// No data download yet (S79's Account rows read it).
		if (pathname.startsWith("/api/v1/me/download")) return jsonResponse({
			error: "not_found",
		}, 404);
		if (request.method === "PUT")
		{
			const body = await request.json() as AccountSettings;
			if (body.version > doc.version) doc = body;
		}
		return jsonResponse(doc);
	}));
}

function renderSettings(variant: LayoutVariant = "mobile")
{
	setSessionToken(DEV_SIGN_IN_TOKEN);
	return render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<SessionProvider>
					<SettingsSync />
					<SettingsPage variant={variant} />
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	setSessionToken(null);
	resetSettings();
	clearPersonalData();
});

describe("SettingsPage layout", () =>
{
	it("renders the Game List, Game Detail and Account groups", async () =>
	{
		stubAccountApi();
		renderSettings();
		for (const name of ["Game List", "Game Detail", "Account"])
		{
			expect(screen.getByRole("heading", {
				name,
			})).toBeInTheDocument();
		}
	});

	it("A8: two bordered frames, Settings (Game List then Game Detail) and Account", () =>
	{
		stubAccountApi();
		renderSettings();
		const settingsFrame = screen.getByRole("region", {
			name: "Settings",
		});
		expect(within(settingsFrame).getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Game List", "Game Detail"]);
		expect(screen.getByRole("region", {
			name: "Account",
		})).toBeInTheDocument();
		expect(screen.getByRole("heading", {
			level: 1,
		})).toHaveTextContent("Settings");
	});

	it("is one column on mobile and two on medium and desktop", () =>
	{
		stubAccountApi();
		const grid = (variant: LayoutVariant) =>
		{
			const { container, unmount } = renderSettings(variant);
			const columns = container.querySelector("[data-columns]")?.getAttribute("data-columns");
			unmount();
			return columns;
		};
		expect(grid("mobile")).toBe("1");
		expect(grid("medium")).toBe("2");
		expect(grid("desktop")).toBe("2");
	});
});

describe("SettingsPage Account", () =>
{
	it("Account shows Signed in as {email}, a Sign out text link that signs out, and no Patreon row", async () =>
	{
		stubAccountApi();
		renderSettings();
		const account = within(screen.getByRole("region", {
			name: "Account",
		}));
		expect(await account.findByText(`Signed in as ${DEV_ACCOUNT.email}`)).toBeInTheDocument();
		expect(account.queryByRole("button", {
			name: "Sign out",
		})).toBeNull();
		expect(account.queryByText(/patreon/i)).toBeNull();

		await userEvent.click(account.getByRole("link", {
			name: "Sign out",
		}));
		expect(getSessionToken()).toBeNull();
		await waitFor(() => expect(account.queryByText(/Signed in as/)).toBeNull());
	});
});

describe("SettingsPage Favorite Teams", () =>
{
	it("Favorite Teams: picking a team saves it, and it is still selected after a remount with a freshly hydrated store", async () =>
	{
		stubAccountApi();
		const first = renderSettings();
		await screen.findByText(`Signed in as ${DEV_ACCOUNT.email}`);
		await userEvent.click(screen.getByRole("textbox", {
			name: "Favorite Teams",
		}));
		await userEvent.click(await screen.findByRole("option", {
			name: "New York Yankees",
		}));
		first.unmount();

		// A fresh store, as on another device: only the account remembers the choice.
		resetSettings();
		clearPersonalData();
		renderSettings();
		const pills = await screen.findByText("Yankees");
		expect(pills).toBeInTheDocument();
	});

	it("the dropdown lists city and club (Chicago Cubs); the chosen team's pill reads the club alone (Cubs); typing a city finds its clubs", async () =>
	{
		stubAccountApi();
		renderSettings();
		await screen.findByText(`Signed in as ${DEV_ACCOUNT.email}`);
		const input = screen.getByRole("textbox", {
			name: "Favorite Teams",
		});
		await userEvent.click(input);
		const options = await screen.findAllByRole("option");
		expect(options).toHaveLength(30);
		expect(options.map((option) => option.textContent)).toContain("Chicago Cubs");
		expect(options.map((option) => option.textContent)).not.toContain("Cubs");

		await userEvent.type(input, "chicago");
		expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["Chicago Cubs", "Chicago White Sox"]);
		await userEvent.click(screen.getByRole("option", {
			name: "Chicago Cubs",
		}));
		// The chosen team stays marked in the dropdown.
		expect(screen.getByRole("option", {
			name: "Chicago Cubs",
		}).querySelector("svg")).not.toBeNull();
		// The pill is the club name; the full name shows only in the dropdown.
		const field = input.closest(".mantine-MultiSelect-root") as HTMLElement;
		expect(within(field).getByText("Cubs")).toBeInTheDocument();
		expect(within(field).queryByText("Chicago Cubs")).toBeNull();
	});
});

describe("SettingsPage Opens First", () =>
{
	it("Opens First offers exactly Videos, Live and Box, and picking one checks it", async () =>
	{
		stubAccountApi();
		renderSettings();
		const group = within(screen.getByRole("radiogroup", {
			name: "Opens First",
		}));
		expect(group.getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["videos", "live", "box"]);
		expect(group.getByRole("radio", {
			name: "Videos",
		})).toBeChecked();
		await userEvent.click(group.getByRole("radio", {
			name: "Box",
		}));
		await waitFor(() => expect(group.getByRole("radio", {
			name: "Box",
		})).toBeChecked());
	});
});

describe("SettingsPage Video Player (S70)", () =>
{
	it("Video Player offers Dialog then Stage, Dialog by default, and picking Stage saves it to the account", async () =>
	{
		const put = vi.fn();
		stubAccountApi();
		const stubbed = fetch;
		vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
		{
			if (request.method === "PUT") put(await request.clone().json());
			return stubbed(request);
		}));
		renderSettings();
		const group = within(screen.getByRole("radiogroup", {
			name: "Video Player",
		}));
		expect(group.getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["dialog", "stage"]);
		expect(group.getByRole("radio", {
			name: "Dialog",
		})).toBeChecked();
		await userEvent.click(group.getByRole("radio", {
			name: "Stage",
		}));
		await waitFor(() => expect(put).toHaveBeenCalledWith(expect.objectContaining({
			videoPlayer: "stage",
		})));
		expect(group.getByRole("radio", {
			name: "Stage",
		})).toBeChecked();
	});
});
