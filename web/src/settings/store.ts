/**
 * The one settings store (ADR-024): a Zustand store read with `useSettings()`
 * and written only through the named setters below. Settings live on the
 * account (ADR-027), so every setter saves to `PUT /api/v1/me/settings`; the
 * store is the in-memory copy views read, hydrated from the account after
 * sign-in and reset to the house defaults on sign-out (`SettingsSync`).
 *
 * A cached copy persists through `web/src/storage/` under `bt.settings`, which
 * is labeled personal there, so sign-out's `clearPersonalData()` removes it
 * (ADR-028). It only spares a reload from flashing the defaults; the account
 * stays the source of truth.
 */
import type {
	AccountSettings, GameRowSlot, OpensFirst,
} from "@bt/domain";
import { applyIfNewer, DEFAULT_SETTINGS } from "@bt/domain";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { fetchSettings, saveSettings } from "../api/client.js";
import { readStored, writeStored } from "../storage/storage.js";

type SettingsState = { settings: AccountSettings };

const settingsStore = create<SettingsState>()(persist(() => ({
	settings: DEFAULT_SETTINGS,
}), {
	name: "bt.settings",
	storage: createJSONStorage(() => ({
		getItem: () => readStored("bt.settings"),
		setItem: (_name, value) => writeStored("bt.settings", value),
		removeItem: () => writeStored("bt.settings", null),
	})),
}));

/** The current settings; re-renders the caller when they change. */
export function useSettings(): AccountSettings
{
	return settingsStore((state) => state.settings);
}

/** Keeps whichever copy is newer, so a slow server answer never rolls back a newer local change (ADR-022). */
function keepNewer(incoming: AccountSettings): void
{
	settingsStore.setState((state) => ({
		settings: applyIfNewer(state.settings, incoming),
	}));
}

/**
 * Applies a change locally at once (the UI updates without waiting), then saves
 * the whole document with the next version. A failed save keeps the local
 * change; the next hydrate from the account settles it.
 */
async function save(change: Partial<Omit<AccountSettings, "version">>): Promise<void>
{
	const current = settingsStore.getState().settings;
	const next: AccountSettings = {
		...current,
		...change,
		version: current.version + 1,
	};
	settingsStore.setState({
		settings: next,
	});
	try
	{
		keepNewer(await saveSettings(next));
	}
	catch
	{
		// Offline or rejected: the local copy stands until the account is read again.
	}
}

export function setFavoriteTeams(teamIds: number[]): Promise<void>
{
	return save({
		favoriteTeamIds: teamIds,
	});
}

export function setOpensFirst(room: OpensFirst): Promise<void>
{
	return save({
		opensFirst: room,
	});
}

/** What the scoreboard shows at the right of each game (S67): Status or Room Menu. */
export function setGameRowSlot(slot: GameRowSlot): Promise<void>
{
	return save({
		gameRowSlot: slot,
	});
}

/** Fold games without a favorite team into slim bars on the scoreboard (S68). */
export function setCollapseNonFavorites(on: boolean): Promise<void>
{
	return save({
		collapseNonFavorites: on,
	});
}

/**
 * Turn Hide Scores on or off (S68). Views never read it back directly: they ask
 * `useScoresHidden`, which asks `shouldHideScores` (owner, 2026-10-21).
 */
export function setHideScores(on: boolean): Promise<void>
{
	return save({
		hideScores: on,
	});
}

/** Reads the account's settings into the store (after sign-in). */
export async function hydrateSettings(): Promise<void>
{
	settingsStore.setState({
		settings: await fetchSettings(),
	});
}

/** Back to the house defaults (on sign-out). */
export function resetSettings(): void
{
	settingsStore.setState({
		settings: DEFAULT_SETTINGS,
	});
}
