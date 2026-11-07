import { announceUpdate, resetUpdates } from "../pwa/updates.js";

/** Set once the API has said this app's version is retired; a reload is the only fix. */
let unsupported = false;

/**
 * Called by the API client's one middleware when an answer is 426 `version_unsupported`
 * (S28; ADR-015): the API version this app was built against is retired. It raises the one
 * "reload to update" notice, the same one a waiting service worker raises (S73; ADR-023 makes
 * the PWA's update notice where this lands; ADR-025 one implementation): `useUpdateNotice`
 * builds the Notice the shell's slot floats at the bottom (shell-scoreboard A6), with S55's
 * copy, Update Now (a reload) and Snooze. Nothing is cleared: what the page already shows
 * stays readable behind it (VISUAL-DESIGN D7).
 */
export function markVersionUnsupported(): void
{
	if (unsupported) return;
	unsupported = true;
	announceUpdate(null);
}

/** Tests only: forget a retired version (and its notice) between cases. */
export function resetVersionNotice(): void
{
	unsupported = false;
	resetUpdates();
}
