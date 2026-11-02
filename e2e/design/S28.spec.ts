/**
 * S28's design match (rule 22): the stale-client prompt in the app-level notice slot under
 * the header — shell-scoreboard `shell-notice-mobile`, `-medium` and `-desktop` (desktop at
 * 1200px, owner 2026-10-28). The scoreboard loads S66's day (SF @ NYM final, 823823 CHC @ MIA
 * in progress and before first pitch); the day digest's request is answered 426
 * `version_unsupported`, as a retired API version would answer, so the notice rises over the
 * page the reader already has.
 *
 * Judge only S28's parts (owner, 2026-10-28: "Judge only the story's own parts"): the notice
 * banner in the slot (message, Primary Reload, ✕) and the page still readable under it.
 * Expected differences: the copy is S55's final "An update to Baseball Theater is ready."
 * (shell-scoreboard A1), where S31's frames carry the placeholder the DESIGN notes call
 * placeholder; the frames' sample day versus the fixture's; no day digest (its request is the
 * one that answered 426); the footer's "Fetched … ago" is the real time.
 */
import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import { capture, hideDevControls } from "./helpers.js";

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

for (const frame of ["shell-notice-mobile", "shell-notice-medium", "shell-notice-desktop"])
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await page.route(/\/api\/v1\/schedule\?/, (route) => route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(DAY),
		}));
		await page.route(/\/api\/v1\/digest\?/, (route) => route.fulfill({
			status: 426,
			contentType: "application/json",
			body: JSON.stringify({
				error: "version_unsupported",
				hint: "This version of the app has been retired; reload to update.",
			}),
		}));
		await page.goto("/games/2026-09-05");
		await page.getByTestId("scoreboard-module").first().waitFor();
		await page.getByText("An update to Baseball Theater is ready.").waitFor();
		await page.evaluate(async () =>
		{
			await document.fonts.ready;
		});
		await hideDevControls(page);
		await capture(page, testInfo, frame);
	});
}
