/**
 * S68's design match (rule 22): collapse non-favorites and Hide Scores in the
 * shell-scoreboard frames they build. The day is S66's (SF @ NYM final; 823823, CHC @ MIA,
 * in progress and before first pitch); the dev account signs in and its settings are
 * answered per state. With the Giants as the favorite, the final stays a full module and
 * the other two fold into bars, as the collapsed frames draw one module and two bars.
 *
 * - `scoreboard-collapsed-score-mobile` (A2), `scoreboard-collapsed-medium`, `-desktop`:
 *   Collapse Non-Favorites on.
 * - `scoreboard-slots-hidden-nonotice-mobile` (A3 + A4), `scoreboard-scores-hidden-medium`,
 *   `-desktop`: Hide Scores on.
 * - `scoreboard-collapsed-hidden-nonotice-mobile` (A3 + A4): both on.
 *
 * Expected differences, not judged (owner, 2026-10-28: "Judge only the story's own
 * parts"): the frames' sample day versus the fixture games; the medium and desktop
 * collapsed frames' "Collapsed" label is A2's score and state, and the medium / desktop
 * scores-hidden frames' "Scores hidden in settings" line is gone (A4); the scheduled bar
 * shows its start time (no frame draws a scheduled bar); the inning reads as
 * `inningLabel` writes it (`Top 3rd`); the scheduled slot shows probables, not win
 * probability (S67); the modules and slots are S66's and S67's; the header shows the
 * signed-in account; the footer's "Fetched … ago" is the real time.
 */
import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
	capture, hideDevControls, signInDev,
} from "./helpers.js";

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
	windowMode: "active",
	version: 1,
	lastChangedAt: "2026-09-05T20:57:20.000Z",
};

/** San Francisco: the final's away team, so it stays open and the CHC @ MIA games fold. */
const GIANTS = 137;

async function scoreboard(page: Page, collapse: boolean, hide: boolean): Promise<void>
{
	await page.route(/\/api\/v1\/schedule\?/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify(DAY),
	}));
	await page.route(/\/api\/v1\/me\/settings$/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({
			favoriteTeamIds: [GIANTS],
			opensFirst: "videos",
			gameRowSlot: "status",
			collapseNonFavorites: collapse,
			hideScores: hide,
			version: 1,
		}),
	}));
	await signInDev(page, "/games/2026-09-05");
	await page.getByTestId(collapse ? "collapsed-bar" : "scoreboard-module").first().waitFor();
	if (hide) await page.getByTestId("hidden-record").first().waitFor();
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
}

const FRAMES: { frame: string;
	collapse: boolean;
	hide: boolean; }[] = [
	{
		frame: "scoreboard-collapsed-score-mobile",
		collapse: true,
		hide: false,
	},
	{
		frame: "scoreboard-collapsed-medium",
		collapse: true,
		hide: false,
	},
	{
		frame: "scoreboard-collapsed-desktop",
		collapse: true,
		hide: false,
	},
	{
		frame: "scoreboard-slots-hidden-nonotice-mobile",
		collapse: false,
		hide: true,
	},
	{
		frame: "scoreboard-scores-hidden-medium",
		collapse: false,
		hide: true,
	},
	{
		frame: "scoreboard-scores-hidden-desktop",
		collapse: false,
		hide: true,
	},
	{
		frame: "scoreboard-collapsed-hidden-nonotice-mobile",
		collapse: true,
		hide: true,
	},
];

for (const {
	frame, collapse, hide,
} of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await scoreboard(page, collapse, hide);
		await capture(page, testInfo, frame);
	});
}
