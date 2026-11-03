/**
 * S75's design match (rule 22): Hide Scores in the game rooms, the frames that draw them
 * with no "Scores hidden" text — game-rooms A5 `live-hidden-status-mobile` /
 * `-medium` (which supersede A4's `live-hidden-nonotice-*`), A4
 * `plays-hidden-nonotice-mobile`, `plays-scoring-hidden-nonotice-mobile`,
 * `recap-hidden-nonotice-mobile`, `box-hidden-nonotice-mobile`, and game-shell A3
 * `game-videos-hidden-nonotice-mobile`. The dev account signs in and its settings answer
 * with Hide Scores on. Live is answered with `fixtures/game-823823-live.json` in its window
 * (as S109's spec does); the other rooms are the API's own 823823 final.
 *
 * Judge only S75's parts (owner, 2026-10-28: "Judge only the story's own parts"): the
 * Live score reads `CHC – · MIA –`; an in-play pitch reads "IN PLAY"; Plays' linescore
 * reads `–` in every inning and R·H·E; each Runs row ends with `–`; the Recap is headed
 * "Recap"; on Videos the recap clip reads "Recap (score hidden)"; Box is unchanged; nothing
 * says scores are hidden. Expected differences are other stories': the fixture's CHC @ MIA
 * (Top 3rd on Live, Final 6–5 elsewhere) versus the frames' NYY @ BOS; no headshots; the
 * open at-bat's header (owner, 2026-10-29) and the pitch-sequence casing are S41's and
 * S64's; the win-probability card at medium (S106); the Videos room's search, filters,
 * sort and groups (S69, owner 2026-10-30); the header shows the signed-in account; the
 * footer's "Fetched … ago" is the real time.
 */
import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
	capture, hideDevControls, signInDev, stubApi,
} from "./helpers.js";

const LIVE = JSON.parse(readFileSync(new URL("../../fixtures/game-823823-live.json", import.meta.url), "utf8"));
const served = () => ({
	...LIVE,
	fetchedAt: new Date().toISOString(),
	windowMode: "active",
	version: 1,
	lastChangedAt: "2026-09-05T20:57:20.000Z",
});

/** Signs in with Hide Scores on, then opens `/game/823823/<tab>` and waits for `ready`. */
async function room(page: Page, tab: string, ready: (page: Page) => Promise<void>): Promise<void>
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
			videoPlayer: "dialog",
			version: 1,
		}),
	}));
	if (tab === "live")
	{
		await page.routeWebSocket(/\/api\/v1\/games\/823823\/live/, (socket) =>
		{
			socket.send(JSON.stringify(served()));
		});
		await stubApi(page, "/api/v1/games/823823", 200, served());
	}
	await signInDev(page, "/games/2026-09-05");
	await page.goto(`/game/823823/${tab}`);
	await ready(page);
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
}

const FRAMES: { frame: string;
	tab: string;
	ready: (page: Page) => Promise<void>; }[] = [
	{
		frame: "live-hidden-status-mobile",
		tab: "live",
		ready: (page) => page.getByTestId("hidden-score").first().waitFor(),
	},
	{
		frame: "live-hidden-status-medium",
		tab: "live",
		ready: (page) => page.getByTestId("hidden-score").first().waitFor(),
	},
	{
		frame: "plays-hidden-nonotice-mobile",
		tab: "plays",
		ready: async (page) =>
		{
			await page.getByTestId("hidden-score").first().waitFor();
			await page.getByTestId("catcher-view").waitFor();
		},
	},
	{
		frame: "plays-scoring-hidden-nonotice-mobile",
		tab: "plays",
		ready: async (page) =>
		{
			await page.getByRole("navigation", {
				name: "Inning sidebar",
			}).getByRole("button", {
				name: "Runs",
			}).click();
			await page.getByText("Scoring plays").waitFor();
			await page.getByTestId("hidden-score").first().waitFor();
		},
	},
	{
		frame: "recap-hidden-nonotice-mobile",
		tab: "recap",
		ready: (page) => page.getByRole("heading", {
			name: "Recap",
			exact: true,
		}).waitFor(),
	},
	{
		frame: "box-hidden-nonotice-mobile",
		tab: "box",
		ready: (page) => page.getByRole("table", {
			name: "Linescore",
		}).waitFor(),
	},
	{
		frame: "game-videos-hidden-nonotice-mobile",
		tab: "videos",
		ready: (page) => page.getByRole("button", {
			name: "Play Recap (score hidden)",
		}).waitFor(),
	},
];

for (const {
	frame, tab, ready,
} of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await room(page, tab, ready);
		await capture(page, testInfo, frame);
	});
}
