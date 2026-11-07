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
 * Every `localStorage` key BT uses (ADR-028's "Browser" inventory row: session token, cached
 * settings, and Logto's sign-in keys). Logto's browser SDK would otherwise keep its tokens in
 * `localStorage` and its sign-in session in `sessionStorage` under keys of its own; the
 * `AuthClient` (S116) hands it a storage adapter over this module instead, so every key it
 * writes is listed here, labeled personal, and gone after sign-out and account deletion.
 */
export const STORAGE_KEYS = {
	/** The S59 session bearer token. */
	"bt.session": {
		personal: true,
	},
	/** The S6 settings store's cached copy of the account's settings, so a reload shows them before the account answers. */
	"bt.settings": {
		personal: true,
	},
	/** Where a sign-in started (S116), so the callback can return there; set before leaving for Logto, cleared on return. */
	"bt.signInReturnTo": {
		personal: true,
	},
	/** Logto's ID token for the moment between its sign-in and the hand-off to BT (S116); the `AuthClient` clears it right after. */
	"logto.idToken": {
		personal: true,
	},
	/** Logto's access and refresh tokens. BT asks Logto for neither, but the SDK may store them, so they are listed and cleared too. */
	"logto.accessToken": {
		personal: true,
	},
	"logto.refreshToken": {
		personal: true,
	},
	/** Logto's in-flight sign-in (its PKCE verifier and state), from leaving for Logto until the callback. */
	"logto.signInSession": {
		personal: true,
	},
} as const satisfies Record<string, { personal: boolean }>;

export type StorageKey = keyof typeof STORAGE_KEYS;

export function readStored(key: StorageKey): string | null
{
	try
	{
		return localStorage.getItem(key);
	}
	catch
	{
		return null;
	}
}

/** Stores `value` under `key`, or removes the key when `value` is null. */
export function writeStored(key: StorageKey, value: string | null): void
{
	try
	{
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	}
	catch
	{
		// Unavailable storage: the caller keeps its in-memory copy for this page load.
	}
}

/** Removes every key labeled personal (sign-out now; account deletion in S79). Non-personal keys stay. */
export function clearPersonalData(): void
{
	for (const [key, { personal }] of Object.entries(STORAGE_KEYS))
	{
		if (personal) writeStored(key as StorageKey, null);
	}
}
