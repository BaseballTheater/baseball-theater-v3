/**
 * The six shell frames S60 builds and the steps that put the app in each one
 * (shell-scoreboard A2's `nav-drawer-*`, `shell-signed-out-*`, `shell-version-desktop`
 * and A5's `scoreboard-header-version-desktop`). One list for every story that
 * compares the shell — S60's pilot (S81) and S83's fixes — not a copy per spec
 * (ADR-025). Judged on the shell only; the scoreboard content is an expected
 * difference until S65–S68 rebuild it.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
	capture, freezeClock, hideDevControls, signInDev,
} from "./helpers.js";

const SCOREBOARD = "/games/2024-07-04";

export const SHELL_FRAMES: {
	frame: string;
	signedIn: boolean;
	drawer: boolean;
}[] = [
	{
		frame: "nav-drawer-mobile",
		signedIn: true,
		drawer: true,
	},
	{
		frame: "nav-drawer-medium",
		signedIn: true,
		drawer: true,
	},
	{
		frame: "shell-signed-out-mobile",
		signedIn: false,
		drawer: true,
	},
	{
		frame: "shell-signed-out-desktop",
		signedIn: false,
		drawer: false,
	},
	{
		frame: "shell-version-desktop",
		signedIn: true,
		drawer: false,
	},
	{
		frame: "scoreboard-header-version-desktop",
		signedIn: true,
		drawer: false,
	},
];

async function openDrawer(page: Page): Promise<void>
{
	await page.getByRole("button", {
		name: "Open navigation",
	}).click();
	// The drawer slides in; capture once its links sit fully on screen.
	await expect(page.getByRole("dialog").getByRole("link", {
		name: "Scoreboard",
	})).toBeInViewport({
		ratio: 1,
	});
	// Wait out the finite ones (the slide-in). An endless one — a live game's blinking dot
	// (LiveIndicator, since S66 puts one on the scoreboard behind the drawer) — never ends.
	await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
}

/** Registers one capture test per shell frame, each run only at its frame's pairing. */
export function captureShellFrames(): void
{
	for (const {
		frame, signedIn, drawer,
	} of SHELL_FRAMES)
	{
		test(frame, async ({ page }, testInfo) =>
		{
			test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
			await freezeClock(page);
			if (signedIn)
			{
				await signInDev(page, SCOREBOARD);
			}
			else
			{
				await page.goto(SCOREBOARD);
				await page.getByRole("button", {
					name: "Sign in",
				}).first().waitFor();
			}
			// The footer line marks a loaded page (inside <main>, so no contentinfo role in a real browser).
			await page.getByText(/baseball\.theater$/).waitFor();
			if (drawer) await openDrawer(page);
			// The wordmark's face comes from the Adobe Fonts kit; capture once it has loaded.
			await page.evaluate(async () =>
			{
				await document.fonts.ready;
			});
			await hideDevControls(page);
			await capture(page, testInfo, frame);
		});
	}
}
