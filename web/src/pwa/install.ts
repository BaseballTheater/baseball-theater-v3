import { useEffect, useState } from "react";

/** Chromium's install prompt event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event
{
	prompt: () => Promise<void>;
}

const CHANGED = "bt:install-changed";

/** The browser's deferred install prompt, kept from startup; null when it hasn't offered one. */
let deferred: BeforeInstallPromptEvent | null = null;
/** Set once the app is installed from this page. */
let installedHere = false;

/**
 * Listens from startup (S73; `main.tsx`), because the browser may offer to install before
 * Settings is ever opened: `beforeinstallprompt` is held for the Install app link, and
 * `appinstalled` retires it.
 */
export function captureInstallPrompt(): void
{
	window.addEventListener("beforeinstallprompt", (event) =>
	{
		event.preventDefault();
		deferred = event as BeforeInstallPromptEvent;
		window.dispatchEvent(new Event(CHANGED));
	});
	window.addEventListener("appinstalled", () =>
	{
		installedHere = true;
		deferred = null;
		window.dispatchEvent(new Event(CHANGED));
	});
}

/** Whether the app is running installed (its own window, no browser bar). */
export function isStandalone(): boolean
{
	return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

/**
 * iPhone or iPad: Safari there has no install API, so the app shows the Share steps
 * instead (owner, 2026-10-21: "iOS should show the share instructions"). An iPad that
 * reports itself as a Mac is told apart by its touch screen.
 */
export function isIos(userAgent = navigator.userAgent, touchPoints = navigator.maxTouchPoints): boolean
{
	return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
}

/** What Settings → App offers: the browser's install prompt, the iOS Share steps, or nothing. */
export type InstallOffer =
	| { kind: "prompt";
		install: () => void; }
	| { kind: "ios" }
	| null;

/**
 * The Install app row's state (S55 A1, S56 A2): nothing once installed (here or already
 * running standalone); the iOS Share steps on iPhone/iPad; the Install app link only after
 * the browser has offered to install; otherwise nothing, since that browser can't.
 */
export function useInstallOffer(): InstallOffer
{
	const [, setVersion] = useState(0);
	useEffect(() =>
	{
		const onChange = () => setVersion((v) => v + 1);
		window.addEventListener(CHANGED, onChange);
		return () => window.removeEventListener(CHANGED, onChange);
	}, []);
	if (installedHere || isStandalone()) return null;
	if (isIos()) return {
		kind: "ios",
	};
	const prompt = deferred;
	return prompt ? {
		kind: "prompt",
		install: () => void prompt.prompt(),
	} : null;
}

/** Tests only: forget a held prompt and an install between cases. */
export function resetInstall(): void
{
	deferred = null;
	installedHere = false;
}
