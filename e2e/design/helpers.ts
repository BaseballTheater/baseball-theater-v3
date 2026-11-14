/**
 * What a design-match spec (rule 22) needs to put the app in a drawn state and
 * photograph it. Specs live at `e2e/design/<story ID>.spec.ts`; each capture is
 * named after the ratified frame it is compared with.
 *
 * Captures are committed files, so they show only the dev fixture account
 * (ADR-028): no other personal data ever reaches a screenshot.
 */
import { mkdirSync } from "node:fs";
import {
	basename, dirname, join,
} from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, TestInfo } from "@playwright/test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** The pairing a frame is drawn at, from its `<screen>[-<state>]-<pairing>` name. */
function framePairing(frame: string): string
{
	return /-(mobile|medium|desktop)$/.exec(frame)?.[1] ?? "";
}

/**
 * Sign in as the dev fixture account through the header's "Sign in", which is
 * the dev sign-in locally (S59). Leaves the page on `path`.
 */
export async function signInDev(page: Page, path = "/games/2024-07-04"): Promise<void>
{
	await page.goto(path);
	await page.getByRole("button", {
		name: "Sign in",
	}).first().click();
	await page.getByRole("button", {
		name: "Account",
	}).waitFor();
}

/**
 * Open Settings the way a signed-in reader does: the header's Account icon opens a menu
 * (owner, 2026-11-12: "the user icon should provide a menu on click that offers: Settings,
 * Sign Out"), and its Settings item goes there.
 */
export async function openSettings(page: Page): Promise<void>
{
	await page.getByRole("button", {
		name: "Account",
	}).click();
	await page.getByRole("menuitem", {
		name: "Settings",
	}).click();
}

/**
 * Open the Plays room's last at-bat, which the ratified frames draw open (game-rooms DESIGN)
 * but which no longer opens by itself (owner, 2026-11-12: "the plays view shouldn't expand any
 * plays by default"). Waits for its catcher's view and for the pitch replay to end (the
 * selected pitch's ring, `r=10`, is drawn only once the replay is over), then scrolls back to
 * the top, since opening an at-bat scrolls it into view.
 */
export async function openLastAtBat(page: Page): Promise<void>
{
	await page.locator("[id^=\"at-bat-\"]").last().locator("button[aria-expanded]").first().click();
	await page.getByTestId("catcher-view").waitFor();
	await page.locator("g[role=button][aria-pressed=\"true\"] circle[r=\"10\"]").first().waitFor();
	await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * Freeze the page's clock so dates and "Fetched … ago" don't move between runs.
 * Call before the first navigation.
 */
export async function freezeClock(page: Page, iso = "2024-07-04T23:00:00.000Z"): Promise<void>
{
	await page.clock.setFixedTime(new Date(iso));
}

/**
 * Answer one API path with a fixed status and JSON body, to reach states the dev
 * app can't (refusals, failures). With `method`, only that method is answered and
 * others go on to the app (a GET and a POST on one path can differ).
 */
export async function stubApi(page: Page, path: string, status: number, body: unknown, method?: string): Promise<void>
{
	await page.route(`**${path}`, (route) =>
	{
		if (method && route.request().method() !== method) return route.fallback();
		return route.fulfill({
			status,
			contentType: "application/json",
			body: JSON.stringify(body),
		});
	});
}

/** Hide the dev-only sign-in control (S59), which no frame draws. Call after the view is on screen. */
export async function hideDevControls(page: Page): Promise<void>
{
	await page.getByRole("button", {
		name: /^Dev sign-(in|out)/,
	}).evaluateAll((buttons) =>
	{
		for (const b of buttons) (b as HTMLElement).style.visibility = "hidden";
	});
}

/**
 * Photograph the page for `frame`. Under `pnpm design:capture` the file goes to
 * `docs/v3/design-checks/<story ID>/<frame>.png`, never beside the frames (their
 * folders are sealed by manifests); otherwise to Playwright's output folder, so
 * a plain run writes nothing to the tree. Refuses a frame drawn at another pairing.
 */
export async function capture(page: Page, testInfo: TestInfo, frame: string): Promise<void>
{
	if (framePairing(frame) !== testInfo.project.name)
	{
		throw new Error(`${frame} is drawn at ${framePairing(frame) || "no pairing"}, but this run is ${testInfo.project.name}`);
	}
	let path = testInfo.outputPath(`${frame}.png`);
	if (process.env.BT_DESIGN_CAPTURE === "1")
	{
		// The spec that loaded the test names the story, even when a shared module
		// (shell-frames.ts) registered it: the root of the title path is that spec file.
		const story = basename(testInfo.titlePath[0] ?? testInfo.file).replace(/\.spec\.ts$/, "");
		if (!/^S\d+$/.test(story)) throw new Error(`design captures run from e2e/design/<story ID>.spec.ts, not ${story}`);
		const dir = join(REPO, "docs/v3/design-checks", story);
		mkdirSync(dir, {
			recursive: true,
		});
		path = join(dir, `${frame}.png`);
	}
	// No frame draws a hover: park the pointer off every control (the last click left it on
	// one) and wait out the hover transitions (0.3–0.4s, styles.css) before the photograph.
	await page.mouse.move(0, 0);
	await page.waitForTimeout(500);
	await page.screenshot({
		path,
		fullPage: true,
	});
}
