/**
 * S69's design match (rule 22): the Videos room in the game-shell frames it builds —
 * `game-videos-grid-mobile`, `-medium`, `-desktop` (grid mode, two / three / four
 * columns) and `game-videos-list-mobile` (List chosen) — on 823823 (CHC @ MIA), whose 40
 * recorded videos the dev API serves impact-ranked. The search row is A1's (no Filter
 * button), so `game-videos-no-filter-mobile` is matched by the grid-mobile capture.
 *
 * Owner-directed changes from the frames (2026-10-30): cards top-aligned; a sort pill
 * (Impact / Newest / Oldest) left of the Grid / List control, which shows icons; the
 * quick filters are rounded rectangles of one height and show as many as fit, then a
 * Filters button opening a bottom drawer — on mobile, Stat / viz then Filters; the videos
 * show in Pre-game / Game highlights / Statcast / Post-game groups, empty ones left out.
 *
 * Expected differences, not judged (owner, 2026-10-28: "Judge only the story's own
 * parts"): the frames' sample game (NYY @ BOS, five clips) versus the fixture's 40, so
 * stills, titles, durations, dates and order differ; the meta line names each video's
 * kind (Highlight / Recap / Condensed game / Video) and its date in the reader's zone;
 * the Featured team chip carries a chevron because it opens a picker of the game's two
 * teams (owner, 2026-10-30); the desktop grid sits in the 1200px app's narrower canvas beside the rail; the top
 * bar and tabs are S40's and S60's; the footer's "Fetched … ago" is the real time.
 */
import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { capture, hideDevControls } from "./helpers.js";

async function videos(page: Page, list: boolean): Promise<void>
{
	await page.goto("/game/823823/videos");
	await page.getByTestId("videos-grid").first().waitFor();
	if (list)
	{
		// The segmented control's radio is hidden under its icon label; click the label.
		await page.locator("label[for$='-list']").click();
		await page.getByTestId("videos-list").first().waitFor();
	}
	// Stills load from MLB's image CDN; wait for those on screen so the capture shows them.
	await page.waitForLoadState("networkidle");
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
}

const FRAMES: { frame: string;
	list: boolean; }[] = [
	{
		frame: "game-videos-grid-mobile",
		list: false,
	},
	{
		frame: "game-videos-grid-medium",
		list: false,
	},
	{
		frame: "game-videos-grid-desktop",
		list: false,
	},
	{
		frame: "game-videos-list-mobile",
		list: true,
	},
];

for (const { frame, list } of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await videos(page, list);
		await capture(page, testInfo, frame);
	});
}

// The filter drawer (owner, 2026-10-30) has no ratified frame; captured so the owner can judge it.
test("game-videos-filters-drawer-mobile", async ({ page }, testInfo) =>
{
	test.skip(testInfo.project.name !== "mobile", "drawn at mobile only");
	await videos(page, false);
	await page.getByRole("button", {
		name: "Filters",
	}).click();
	await page.getByRole("button", {
		name: "Apply",
	}).waitFor();
	await page.waitForTimeout(400);
	// A full-page shot of a fixed drawer over a long page lands it mid-page; keep the shot to one phone screen.
	await page.addStyleTag({
		content: "html, body, #root { height: 844px !important; overflow: hidden !important; }",
	});
	await capture(page, testInfo, "game-videos-filters-drawer-mobile");
});
