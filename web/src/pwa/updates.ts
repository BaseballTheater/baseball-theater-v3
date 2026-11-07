import { useEffect, useState } from "react";
import type { Notice } from "../layout/NoticeSlot.js";
import { readStored, writeStored } from "../storage/storage.js";

/** S55's copy for the update notice (shell-scoreboard A1, `shell-update-*`). */
export const UPDATE_MESSAGE = "An update to Baseball Theater is ready.";

/** How long Snooze hides the notice (shell-scoreboard A6: "an hour-long snooze before it comes back"). */
export const SNOOZE_MS = 60 * 60 * 1000;

/** `vite-plugin-pwa`'s `registerSW`, or a stand-in: it registers and returns the function that activates a waiting worker. */
export type RegisterServiceWorker = (options: {
	immediate?: boolean;
	onNeedRefresh?: () => void;
}) => (reloadPage?: boolean) => Promise<void>;

const CHANGED = "bt:update-changed";

/** Set once a reload would bring something newer: a waiting worker (S73) or a retired API version (S28). */
let ready = false;
/** How to move to the waiting worker, once one is waiting; null when only a reload is needed. */
let activate: (() => Promise<void>) | null = null;

/**
 * Registers the service worker once, at startup (S73; `main.tsx`). When a new version has
 * installed and is waiting, `onNeedRefresh` fires; the app keeps how to activate it and
 * tells the shell, which shows the update notice. Nothing reloads until the reader asks.
 */
export function startUpdates(register: RegisterServiceWorker): void
{
	const update = register({
		immediate: true,
		onNeedRefresh: () => announceUpdate(() => update(true)),
	});
}

/**
 * Raises the one "reload to update" notice (ADR-025: S28 and S73 share it, with one message).
 * `next` is how to activate a waiting worker; a retired API version (`markVersionUnsupported`)
 * passes null, and Update Now then just reloads. A waiting worker, once known, is kept, since
 * activating it and reloading is the better update either way.
 */
export function announceUpdate(next: (() => Promise<void>) | null): void
{
	ready = true;
	if (next) activate = next;
	window.dispatchEvent(new Event(CHANGED));
}

/**
 * Development only: shows the update notice as a waiting worker would, reloading on Update Now.
 * The dev server runs no worker, so the Playwright flow and the design captures (S73)
 * reach the notice through this.
 */
export function exposeDevUpdateTrigger(): void
{
	(window as { btShowUpdate?: () => void }).btShowUpdate = () => announceUpdate(async () => window.location.reload());
}

/** When a snooze ends (epoch ms), 0 when none is stored. Kept in this browser so a reload within the hour stays quiet (A6). */
function snoozedUntil(): number
{
	return Number(readStored("bt.updateSnoozedUntil")) || 0;
}

/**
 * The update notice (S55's copy; shell-scoreboard A6's floating box): "An update to Baseball
 * Theater is ready." with Update Now, which activates the waiting worker (or, for a retired
 * version, just reloads), and Snooze, which hides it for an hour, after which it comes back
 * on its own without a reload. Null while nothing is newer, or while snoozed.
 */
export function useUpdateNotice(): Notice | null
{
	const [, rerender] = useState(0);
	useEffect(() =>
	{
		const onChanged = () => rerender((n) => n + 1);
		window.addEventListener(CHANGED, onChanged);
		return () => window.removeEventListener(CHANGED, onChanged);
	}, []);
	const until = snoozedUntil();
	const snoozed = until > Date.now();
	// A snooze ends while the page is open: wake once at its end so the notice comes back.
	useEffect(() =>
	{
		if (!snoozed) return;
		const timer = setTimeout(() => rerender((n) => n + 1), until - Date.now());
		return () => clearTimeout(timer);
	}, [snoozed, until]);
	if (!ready || snoozed) return null;
	return {
		id: "update",
		message: UPDATE_MESSAGE,
		update: {
			onUpdate: () => void (activate ? activate() : window.location.reload()),
			onSnooze: () =>
			{
				writeStored("bt.updateSnoozedUntil", String(Date.now() + SNOOZE_MS));
				window.dispatchEvent(new Event(CHANGED));
			},
		},
	};
}

/** Tests only: forget a waiting worker, a retired version's notice and a snooze between cases. */
export function resetUpdates(): void
{
	ready = false;
	activate = null;
	writeStored("bt.updateSnoozedUntil", null);
}
