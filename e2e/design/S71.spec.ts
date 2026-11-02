/**
 * S71's design match (rule 22): "Best of <date> — Highlights" under the scoreboard's games,
 * in the frames that draw it — shell-scoreboard `scoreboard-mobile`, `-medium` and
 * `-desktop` (desktop at 1200px, owner 2026-10-28), and with Hide Scores on, A4's
 * `scoreboard-digest-hidden-nonotice-mobile` (the dev account signed in, its settings
 * answered with `hideScores: true`, as S68's spec does). The day is S66's (SF @ NYM final,
 * 823823 CHC @ MIA in progress and before first pitch); the digest is the dev API's own
 * `GET /api/v1/digest` for that day, so the clips, stills and ranks are the real route's.
 *
 * Judge only S71's parts (owner, 2026-10-28: "Judge only the story's own parts"): the label,
 * the gold rows (rank, still, title, duration) and the single WATCH FIRST, one column on
 * mobile and two on medium and desktop, and the digest unchanged with scores hidden.
 * Expected differences: the frames' sample day and clips versus the fixture's (the frames
 * draw two clips; the digest holds up to five, `DIGEST_SIZE`), and earlier stories' parts
 * (the modules S66, the game-row slot S67, the hidden cells S68) and later ones' (the Win
 * Probability slot occupant, S108). The footer's "Fetched … ago" is the real time.
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
	windowMode: "cache",
	version: 1,
	lastChangedAt: "2026-09-05T20:57:20.000Z",
};

async function scoreboard(page: Page, hide: boolean): Promise<void>
{
	await page.route(/\/api\/v1\/schedule\?/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify(DAY),
	}));
	if (hide)
	{
		await page.route(/\/api\/v1\/me\/settings$/, (route) => route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				favoriteTeamIds: [],
				opensFirst: "videos",
				gameRowSlot: "status",
				collapseNonFavorites: false,
				hideScores: true,
				version: 1,
			}),
		}));
		await signInDev(page, "/games/2026-09-05");
		await page.getByTestId("hidden-record").first().waitFor();
	}
	else
	{
		await page.goto("/games/2026-09-05");
	}
	await page.getByTestId("digest-item").first().waitFor();
	// Let the stills load before the capture.
	await page.waitForFunction(() => [...document.querySelectorAll("[data-testid='digest-item'] img")].every((img) => (img as HTMLImageElement).complete));
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
}

const FRAMES: { frame: string;
	hide: boolean; }[] = [
	{
		frame: "scoreboard-mobile",
		hide: false,
	},
	{
		frame: "scoreboard-medium",
		hide: false,
	},
	{
		frame: "scoreboard-desktop",
		hide: false,
	},
	{
		frame: "scoreboard-digest-hidden-nonotice-mobile",
		hide: true,
	},
];

for (const { frame, hide } of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await scoreboard(page, hide);
		await capture(page, testInfo, frame);
	});
}
