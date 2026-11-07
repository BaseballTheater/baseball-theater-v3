/**
 * The only code that touches browser storage (ADR-028; the `bt/no-browser-storage`
 * lint rule rejects `localStorage`, `sessionStorage`, `indexedDB` and `caches`
 * anywhere else). Every key BT stores is listed in {@link STORAGE_KEYS} with
 * whether it is personal, so sign-out and account deletion can clear all of a
 * user's browser data in one call without each feature hand-listing its keys.
 *
 * Storage can be missing or throw (private windows, blocked site data), so every
 * access is guarded: a failed read is "nothing stored", a failed write is lost.
 */

/**
 * Every key BT stores (ADR-028's "Browser" inventory row: session token, cached settings, and
 * Logto's sign-in keys), whether it is personal, and where it lives: `"shared"` is `localStorage`,
 * seen by every tab of the site; `"tab"` is the tab's own `sessionStorage`, which survives the
 * tab's trip to Logto and back but no other tab sees (S120: a sign-in started in a second tab
 * must not overwrite the first's). Logto's browser SDK would otherwise keep its tokens and sign-in
 * session under keys of its own; the `AuthClient` (S116) hands it a storage adapter over this
 * module instead, so every key it writes is listed here, labeled personal, and gone after sign-out
 * and account deletion. Two keys say nothing about the person (S73; ADR-028's `none`): when the
 * update notice's Snooze runs out (shell-scoreboard A6) and that the Settings install tip was
 * dismissed (standings-search-settings A8). They belong to this browser, survive sign-out, and
 * never sync to the account.
 */
export const STORAGE_KEYS = {
	/** The S59 session bearer token; shared, so every tab is signed in. */
	"bt.session": {
		personal: true,
		area: "shared",
	},
	/** The S6 settings store's cached copy of the account's settings, so a reload shows them before the account answers. */
	"bt.settings": {
		personal: true,
		area: "shared",
	},
	/** Where a sign-in started (S116), so the callback can return there; set before leaving for Logto, cleared on return. This tab's. */
	"bt.signInReturnTo": {
		personal: true,
		area: "tab",
	},
	/** Logto's ID token for the moment between its sign-in and the hand-off to BT (S116); the `AuthClient` clears it right after. */
	"logto.idToken": {
		personal: true,
		area: "tab",
	},
	/** Logto's access and refresh tokens. BT asks Logto for neither, but the SDK may store them, so they are listed and cleared too. */
	"logto.accessToken": {
		personal: true,
		area: "tab",
	},
	"logto.refreshToken": {
		personal: true,
		area: "tab",
	},
	/** Logto's in-flight sign-in (its PKCE verifier and state), from leaving for Logto until the callback. This tab's (S120). */
	"logto.signInSession": {
		personal: true,
		area: "tab",
	},
	/** When the update notice's Snooze ends, in epoch ms (S73, shell-scoreboard A6), so a reload within the hour keeps it hidden. */
	"bt.updateSnoozedUntil": {
		personal: false,
		area: "shared",
	},
	/** Set once the Settings install tip is dismissed (S73, standings-search-settings A8): it stays gone in this browser. */
	"bt.installTipDismissed": {
		personal: false,
		area: "shared",
	},
} as const satisfies Record<string, { personal: boolean;
	area: "shared" | "tab"; }>;

export type StorageKey = keyof typeof STORAGE_KEYS;

/** The browser store `key` lives in. Reading the global can itself throw (blocked site data), so callers guard it. */
function areaOf(key: StorageKey): Storage
{
	return STORAGE_KEYS[key].area === "tab" ? sessionStorage : localStorage;
}

/** What `key` holds in its area (`STORAGE_KEYS`), or null when nothing is stored or storage is unavailable. */
export function readStored(key: StorageKey): string | null
{
	try
	{
		return areaOf(key).getItem(key);
	}
	catch
	{
		return null;
	}
}

/** Stores `value` under `key` in its area (`STORAGE_KEYS`), or removes the key when `value` is null. */
export function writeStored(key: StorageKey, value: string | null): void
{
	try
	{
		if (value === null) areaOf(key).removeItem(key);
		else areaOf(key).setItem(key, value);
	}
	catch
	{
		// Unavailable storage: the caller keeps its in-memory copy for this page load.
	}
}

/** Removes every key labeled personal, in both areas (sign-out and account deletion). Non-personal keys stay. */
export function clearPersonalData(): void
{
	for (const [key, { personal }] of Object.entries(STORAGE_KEYS))
	{
		if (personal) writeStored(key as StorageKey, null);
	}
}
