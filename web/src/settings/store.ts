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
	AccountSettings, GameRowSlot, OpensFirst, VideoPlayerMode,
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

/**
 * Whose settings the store holds, and a count bumped whenever that changes (S120). A read or save
 * answers for the account it was sent for; if the store has since been reset or moved to another
 * account, the answer is dropped, so one account's settings never land in another's store and are
 * never saved to it from there.
 */
let owner: string | null = null;
let generation = 0;

/** Keeps whichever copy is newer, so a slow server answer never rolls back a newer local change (ADR-022), unless the account changed meanwhile. */
function keepNewer(incoming: AccountSettings, sentIn: number): void
{
	if (sentIn !== generation) return;
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
	const sentIn = generation;
	try
	{
		keepNewer(await saveSettings(next), sentIn);
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

/** Where videos play (S70): a dialog over the page, or a stage in the Videos room. */
export function setVideoPlayer(mode: VideoPlayerMode): Promise<void>
{
	return save({
		videoPlayer: mode,
	});
}

/**
 * Reads account `uid`'s settings into the store (after sign-in). When the store held another
 * account's, it goes back to the house defaults first, so nothing of theirs shows or is saved
 * while `uid`'s are read (S120). The first hydrate after a reload keeps the cached copy until the
 * account answers.
 */
export async function hydrateSettings(uid: string): Promise<void>
{
	if (owner !== null && owner !== uid) resetSettings();
	owner = uid;
	const sentIn = generation;
	const settings = await fetchSettings();
	if (sentIn !== generation) return;
	settingsStore.setState({
		settings,
	});
}

/** Back to the house defaults (on sign-out, or before another account's settings are read); answers still on their way are dropped. */
export function resetSettings(): void
{
	owner = null;
	generation++;
	settingsStore.setState({
		settings: DEFAULT_SETTINGS,
	});
}
