/**
 * S97's design match (rule 22): the video play links and the Plays room opened on a play —
 * game-shell A5's `game-videos-{grid,list}-playlink-*` and `video-player-dialog-playlink-*`,
 * game-rooms A6's `plays-opened-*` (desktop at 1200px, owner 2026-10-28). The page reads the
 * fixture API (`pnpm dev`) for 823823, the final game, as S70's and S41's specs do.
 *
 * Judge only S97's parts (owner, 2026-10-28: "Judge only the story's own parts"): the
 * `Play · <half> <inning> →` line under each linked clip's meta line, in grid and list; no
 * play icon on any thumbnail; the play link at top left of the player; the Plays room opened
 * on the play (its inning chosen, its at-bat open, the bar down its left edge) and the
 * `Video: <clip title>` line above every at-bat with a clip. Expected differences are earlier
 * stories' (the fixture's CHC @ MIA clips and innings versus the frames' NYY @ BOS; which
 * clips have plays; the room's own content).
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import {
	capture, hideDevControls, signInDev,
} from "./helpers.js";

const GAME = JSON.parse(readFileSync(new URL("../../fixtures/game-823823.json", import.meta.url), "utf8"));
/** The clip the player and Plays frames open: Griffin Conine's two-run home run. */
const CONINE = (GAME.highlights as { title: string;
	playId: string | null }[]).find((h) => h.title === "Griffin Conine's two-run home run (15)")!;

async function settle(page: Page): Promise<void>
{
	await page.waitForLoadState("networkidle");
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
}

async function signIn(page: Page): Promise<void>
{
	await page.route(/\/api\/v1\/me\/settings$/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({
			favoriteTeamIds: [],
			opensFirst: "videos",
			gameRowSlot: "status",
			collapseNonFavorites: false,
			hideScores: false,
			videoPlayer: "dialog",
			version: 1,
		}),
	}));
	// Captures are stills: keep a clip from loading so it rests on its poster at 0:00.
	await page.route(/\.mp4(\?|$)/, (route) => route.abort());
	await signInDev(page, "/games/2026-09-05");
}

const frames: [string, (page: Page) => Promise<void>][] = [];
for (const pairing of ["mobile", "medium", "desktop"])
{
	frames.push([`game-videos-grid-playlink-${pairing}`, async (page) =>
	{
		await page.goto("/game/823823/videos");
		await page.getByTestId("play-link").first().waitFor();
	}]);
	frames.push([`game-videos-list-playlink-${pairing}`, async (page) =>
	{
		await page.goto("/game/823823/videos");
		// The segmented control's radio is hidden under its icon label; click the label (as S69's spec does).
		await page.locator("label[for$='-list']").click();
		await page.getByTestId("videos-list").first().waitFor();
		await page.getByTestId("play-link").first().waitFor();
	}]);
	frames.push([`plays-opened-${pairing}`, async (page) =>
	{
		await page.goto(`/game/823823/plays?play=${encodeURIComponent(CONINE.playId!)}`);
		await page.locator("[data-marked]").waitFor();
		await page.waitForTimeout(600);
	}]);
}
for (const pairing of ["mobile", "medium"])
{
	frames.push([`video-player-dialog-playlink-${pairing}`, async (page) =>
	{
		await page.goto("/game/823823/videos");
		await page.getByRole("button", {
			name: `Play ${CONINE.title}`,
		}).first().click();
		await page.getByRole("dialog").getByTestId("player-play-link").waitFor();
		await page.waitForTimeout(400);
	}]);
}

for (const [frame, open] of frames)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await signIn(page);
		await open(page);
		await settle(page);
		await capture(page, testInfo, frame);
	});
}
