/**
 * S70's design match (rule 22): the video player in the game-shell frames it builds —
 * `video-player-dialog-mobile` / `-medium` (the default Dialog as game-shell A4 amends it:
 * floating with no card, "Close ✕" in the overlay, over the dimmed Videos
 * room) and `video-player-stage-mobile` / `-medium` (Stage chosen in Settings: the player
 * at the top of the Videos room) — on 823823 (CHC @ MIA). The dialog plays the room's
 * first clip as a reader would open it; the stage shows that clip waiting.
 *
 * Expected differences, not judged (owner, 2026-10-28: "Judge only the story's own
 * parts"): the frames' sample clip (Judge, NYY @ BOS, paused at 0:12 of 0:48) versus the
 * fixture's, so the still, title and time differ (the capture is paused at the start);
 * the clip keeps its 16:9 shape, so it is taller than the frames' 200px crop at medium
 * rather than cutting any of it off; below the stage, the Videos room is S69's as the
 * owner matched it (heading "Videos", owner 2026-10-30; sort, groups, Filters); the top
 * bar and tabs are S40's and S60's; the footer's "Fetched … ago" is the real time.
 */
import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
	capture, hideDevControls, signInDev,
} from "./helpers.js";

async function videos(page: Page, stage: boolean): Promise<void>
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
			videoPlayer: stage ? "stage" : "dialog",
			version: 1,
		}),
	}));
	// Captures are stills: keep the clip from loading so it rests on its poster at 0:00.
	await page.route(/\.mp4(\?|$)/, (route) => route.abort());
	// The game page has the game's own top bar, not the header's Sign in; sign in on the scoreboard first.
	await signInDev(page, "/games/2026-09-05");
	await page.goto("/game/823823/videos");
	await page.getByTestId("videos-grid").first().waitFor();
	if (stage)
	{
		await page.getByRole("region", {
			name: "Video player",
		}).waitFor();
	}
	else
	{
		await page.getByTestId("videos-grid").first().getByRole("button").first().click();
		await page.getByRole("dialog").getByTestId("video-player").waitFor();
		await page.waitForTimeout(400);
	}
	await page.waitForLoadState("networkidle");
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
}

const FRAMES: { frame: string;
	stage: boolean; }[] = [
	{
		frame: "video-player-dialog-mobile",
		stage: false,
	},
	{
		frame: "video-player-dialog-medium",
		stage: false,
	},
	{
		frame: "video-player-stage-mobile",
		stage: true,
	},
	{
		frame: "video-player-stage-medium",
		stage: true,
	},
];

for (const { frame, stage } of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await videos(page, stage);
		if (!stage)
		{
			// A full-page shot of a fixed dialog over a long page lands it mid-page; keep the shot to one screen.
			const height = testInfo.project.name === "mobile" ? 844 : 734;
			await page.addStyleTag({
				content: `html, body, #root { height: ${height}px !important; overflow: hidden !important; }`,
			});
		}
		await capture(page, testInfo, frame);
	});
}
