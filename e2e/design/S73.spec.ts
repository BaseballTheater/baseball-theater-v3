/**
 * S73's design match (rule 22): the installed app's frames — shell-scoreboard A1
 * `scoreboard-standalone-mobile` and `shell-update-mobile` / `-medium` / `-desktop`, and
 * standings-search-settings A1 `settings-install-mobile` / `-desktop` and A2
 * `settings-install-ios-mobile` (desktop at 1200px, owner 2026-10-28).
 *
 * - Standalone: Chromium is told the display mode is standalone (DevTools protocol), so
 *   the installed CSS applies. A desktop browser has no notch or home indicator, so
 *   `env(safe-area-inset-*)` is 0: the frame's 47px status bar and 34px home-indicator
 *   strip are an expected difference (the CSS that makes them is tested in
 *   `src/pwa/standalone.test.ts`).
 * - Update: the dev server runs no service worker, so the notice is raised through the
 *   app's development trigger (`btShowUpdate`), as the update flow does.
 * - Install: the dev account signs in with settings like the frames' (NYY and BOS
 *   favorites, Room Menu, Collapse on, Opens First Live, Dialog); Chromium's install offer
 *   is fired as a `beforeinstallprompt` event; for iOS the page reports an iPhone's user agent.
 *
 * Judge only S73's parts (owner, 2026-10-28: "Judge only the story's own parts"): the
 * standalone ground, the update notice, and Settings → App above Account. Expected
 * differences: the scoreboard's fixture day versus the frames' sample day; Settings'
 * Account group as S6 / S79 built it (signed in, download and delete) where the frames
 * draw the signed-out magic-link button; the footer's "Fetched … ago" is the real time.
 */
import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
	capture, hideDevControls, signInDev,
} from "./helpers.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8"));
const SCHEDULE = read("schedule-2026-09-05.json");
const MOMENTS = read("schedule-823823-moments.json");
const DAY = {
	...SCHEDULE,
	games: [SCHEDULE.games[0], MOMENTS.live, {
		...MOMENTS.pregame,
		gamePk: 1,
	}],
	fetchedAt: new Date().toISOString(),
	windowMode: "cache",
	version: 1,
	lastChangedAt: "2026-09-05T20:57:20.000Z",
};

async function scoreboard(page: Page): Promise<void>
{
	await page.route(/\/api\/v1\/schedule\?/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify(DAY),
	}));
	await page.goto("/games/2026-09-05");
	await page.getByTestId("scoreboard-module").first().waitFor();
}

async function settings(page: Page, ios: boolean): Promise<void>
{
	if (ios)
	{
		await page.addInitScript((ua) => Object.defineProperty(navigator, "userAgent", {
			get: () => ua,
		}), IPHONE);
	}
	await page.route(/\/api\/v1\/me\/settings$/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({
			favoriteTeamIds: [147, 111],
			opensFirst: "live",
			gameRowSlot: "roomMenu",
			collapseNonFavorites: true,
			hideScores: false,
			videoPlayer: "dialog",
			version: 1,
		}),
	}));
	// Signed out, /settings goes to the scoreboard; sign in there, then open Settings.
	await signInDev(page, "/games/2026-09-05");
	await page.getByRole("link", {
		name: "Account",
	}).click();
	await page.getByRole("heading", {
		name: "Account",
	}).waitFor();
	if (!ios)
	{
		await page.evaluate(() => window.dispatchEvent(Object.assign(new Event("beforeinstallprompt", {
			cancelable: true,
		}), {
			prompt: () => Promise.resolve(),
		})));
	}
	await page.getByRole("heading", {
		name: "App",
	}).waitFor();
}

const FRAMES: Record<string, (page: Page) => Promise<void>> = {
	"scoreboard-standalone-mobile": async (page) =>
	{
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Emulation.setEmulatedMedia", {
			features: [{
				name: "display-mode",
				value: "standalone",
			}],
		});
		await scoreboard(page);
	},
	"shell-update-mobile": async (page) => update(page),
	"shell-update-medium": async (page) => update(page),
	"shell-update-desktop": async (page) => update(page),
	"settings-install-mobile": async (page) => settings(page, false),
	"settings-install-desktop": async (page) => settings(page, false),
	"settings-install-ios-mobile": async (page) => settings(page, true),
};

async function update(page: Page): Promise<void>
{
	await scoreboard(page);
	await page.evaluate(() => (window as { btShowUpdate?: () => void }).btShowUpdate?.());
	await page.getByText("An update to Baseball Theater is ready.").waitFor();
}

for (const [frame, open] of Object.entries(FRAMES))
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await open(page);
		await page.evaluate(async () =>
		{
			await document.fonts.ready;
		});
		await hideDevControls(page);
		await capture(page, testInfo, frame);
	});
}
