import { useEffect, useState } from "react";
import type { Notice } from "../layout/NoticeSlot.js";

/** S55's copy for the update notice (shell-scoreboard A1, `shell-update-*`). */
export const UPDATE_MESSAGE = "An update to Baseball Theater is ready.";

/** `vite-plugin-pwa`'s `registerSW`, or a stand-in: it registers and returns the function that activates a waiting worker. */
export type RegisterServiceWorker = (options: {
	immediate?: boolean;
	onNeedRefresh?: () => void;
}) => (reloadPage?: boolean) => Promise<void>;

const READY = "bt:update-ready";

/** How to move to the waiting worker, once one is waiting; null until then. */
let activate: (() => Promise<void>) | null = null;
/** How many times a worker has come to wait: each is its own notice, so ✕ on one doesn't hide the next. */
let announced = 0;

/**
 * Registers the service worker once, at startup (S73; `main.tsx`). When a new version has
 * installed and is waiting, `onNeedRefresh` fires; the app keeps how to activate it and
 * tells the shell, which shows the update notice. Nothing reloads until the reader asks.
 */
export function startUpdates(register: RegisterServiceWorker): void
{
	const update = register({
		immediate: true,
		onNeedRefresh: () => announce(() => update(true)),
	});
}

function announce(next: () => Promise<void>): void
{
	activate = next;
	announced += 1;
	window.dispatchEvent(new Event(READY));
}

/**
 * Development only: shows the update notice as a waiting worker would, reloading on Reload.
 * The dev server runs no worker, so the Playwright flow and the design captures (S73)
 * reach the notice through this.
 */
export function exposeDevUpdateTrigger(): void
{
	(window as { btShowUpdate?: () => void }).btShowUpdate = () => announce(async () => window.location.reload());
}

/**
 * The update notice (S55): "An update to Baseball Theater is ready." with Reload, which
 * activates the waiting worker and reloads, and ✕, which hides it until the next one.
 * Null while no worker waits.
 */
export function useUpdateNotice(): Notice | null
{
	const [ready, setReady] = useState(announced);
	useEffect(() =>
	{
		const onReady = () => setReady(announced);
		window.addEventListener(READY, onReady);
		return () => window.removeEventListener(READY, onReady);
	}, []);
	if (ready === 0) return null;
	return {
		id: `update-${ready}`,
		message: UPDATE_MESSAGE,
		action: {
			label: "Reload",
			onClick: () => void activate?.(),
		},
		dismissible: true,
	};
}

/** Tests only: forget a waiting worker between cases. */
export function resetUpdates(): void
{
	activate = null;
	announced = 0;
}
