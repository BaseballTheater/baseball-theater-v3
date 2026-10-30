/**
 * The settings store (S6, ADR-024/027/028): setters save to the account, it
 * hydrates after sign-in and resets on sign-out, and its cached copy lives in
 * `web/src/storage/` under a personal key that sign-out's clear-all removes.
 * `fetch` answers like the API, keeping one settings document per test.
 */
import type { AccountSettings } from "@bt/domain";
import { DEFAULT_SETTINGS } from "@bt/domain";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, renderHook, waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import { DEV_SIGN_IN_TOKEN, useSession } from "../session/session.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { setSessionToken } from "../session/token.js";
import { clearPersonalData, readStored } from "../storage/storage.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { DEV_ACCOUNT } from "../test/meApi.js";
import { SettingsSync } from "./SettingsSync.js";
import {
	hydrateSettings, resetSettings, setFavoriteTeams, setGameRowSlot, setOpensFirst, useSettings,
} from "./store.js";

/** Stubs the API: `/me` for the dev session, and settings as one stored document with apply-if-newer. */
function stubAccountApi(stored: AccountSettings = DEFAULT_SETTINGS)
{
	let doc = stored;
	const puts: AccountSettings[] = [];
	vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
	{
		const { pathname } = new URL(request.url);
		if (pathname === "/api/v1/me") return jsonResponse(DEV_ACCOUNT);
		if (pathname === "/api/v1/me/settings" && request.method === "PUT")
		{
			const body = await request.json() as AccountSettings;
			puts.push(body);
			if (body.version > doc.version) doc = body;
			return jsonResponse(doc);
		}
		if (pathname === "/api/v1/me/settings") return jsonResponse(doc);
		return jsonResponse({
			error: "not_found",
		}, 404);
	}));
	return {
		puts,
		stored: () => doc,
	};
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	setSessionToken(null);
	resetSettings();
	clearPersonalData();
});

describe("settings store", () =>
{
	it("starts at the house defaults and is read with useSettings()", () =>
	{
		const { result } = renderHook(() => useSettings());
		expect(result.current).toEqual(DEFAULT_SETTINGS);
	});

	it("setters update at once and save the whole document to the account with the next version", async () =>
	{
		const api = stubAccountApi();
		const { result } = renderHook(() => useSettings());

		await act(() => setFavoriteTeams([147, 111]));
		expect(result.current.favoriteTeamIds).toEqual([147, 111]);
		await act(() => setOpensFirst("box"));
		await act(() => setGameRowSlot("roomMenu"));
		expect(result.current).toEqual({
			favoriteTeamIds: [147, 111],
			opensFirst: "box",
			gameRowSlot: "roomMenu",
			version: 3,
		});
		expect(api.puts.map((p) => p.version)).toEqual([1, 2, 3]);
		expect(api.stored()).toEqual(result.current);
	});

	it("keeps a local change when the save fails", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
			error: "unavailable",
		}, 503)));
		const { result } = renderHook(() => useSettings());
		await act(() => setOpensFirst("live"));
		expect(result.current.opensFirst).toBe("live");
	});

	it("hydrates from the account after sign-in and resets to the house defaults on sign-out", async () =>
	{
		const saved = {
			favoriteTeamIds: [121],
			opensFirst: "live" as const,
			gameRowSlot: "status" as const,
			version: 4,
		};
		stubAccountApi(saved);
		setSessionToken(DEV_SIGN_IN_TOKEN);
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={createQueryClient()}>
				<SessionProvider>
					<SettingsSync />
					{children}
				</SessionProvider>
			</QueryClientProvider>
		);
		const { result } = renderHook(() => ({
			settings: useSettings(),
			session: useSession(),
		}), {
			wrapper,
		});
		await waitFor(() => expect(result.current.settings).toEqual(saved));

		act(() => result.current.session.signOut());
		await waitFor(() => expect(result.current.settings).toEqual(DEFAULT_SETTINGS));
		// The cached copy no longer holds the account's favorites.
		expect(readStored("bt.settings") ?? "").not.toContain("121");
	});

	it("keeps its copy through web/src/storage/ under bt.settings, which clearPersonalData removes", async () =>
	{
		stubAccountApi();
		await act(() => setFavoriteTeams([147]));
		expect(JSON.parse(readStored("bt.settings")!)).toMatchObject({
			state: {
				settings: {
					favoriteTeamIds: [147],
				},
			},
		});
		clearPersonalData();
		expect(readStored("bt.settings")).toBeNull();
	});

	it("hydrateSettings replaces the store with the account's copy", async () =>
	{
		stubAccountApi({
			favoriteTeamIds: [111],
			opensFirst: "box",
			gameRowSlot: "status",
			version: 9,
		});
		await hydrateSettings();
		const { result } = renderHook(() => useSettings());
		expect(result.current.opensFirst).toBe("box");
	});
});
