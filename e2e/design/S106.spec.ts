/**
 * S106's design match (rule 22): the Live room's Win probability card, game-rooms
 * `live-medium` and `live-desktop` (desktop at 1200px, owner 2026-10-28), and with Hide Scores
 * on A5's `live-hidden-status-medium`. The game route is answered with
 * `fixtures/game-823823-live.json` plus S93's play metrics for the at-bats played by then (from
 * `fixtures/game-823823.json`), served in its window, with Playwright's WebSocket stand-in on
 * the live route, as S109's spec does.
 *
 * Judge only S106's parts (owner, 2026-10-28: "Judge only the story's own parts"): the card
 * under the status card beside the zone — its title, the current value top right, the line
 * with the area under it, the dashed 50% line and the innings along the bottom; hidden, the
 * "–" and "Hidden with scores". Expected differences are earlier stories' (the fixture's
 * CHC @ MIA in the top 3rd, so a line over three innings for MIA, versus the frames' NYY @ BOS
 * in the 7th for BOS; no headshots; the status card's own content).
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import {
	capture, hideDevControls, signInDev, stubApi,
} from "./helpers.js";

const read = (file: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${file}`, import.meta.url), "utf8"));
const LIVE = read("game-823823-live.json");
const METRICS = read("game-823823.json").playMetrics as { atBats: { atBatIndex: number }[] };
const served = () => ({
	...LIVE,
	playMetrics: {
		atBats: METRICS.atBats.filter((m) => m.atBatIndex < LIVE.plays.length),
	},
	fetchedAt: new Date().toISOString(),
	windowMode: "active",
	version: 1,
	lastChangedAt: "2026-09-05T20:57:20.000Z",
});

async function openLive(page: Page, hidden: boolean): Promise<void>
{
	if (hidden)
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
	}
	await page.routeWebSocket(/\/api\/v1\/games\/823823\/live/, (socket) =>
	{
		socket.send(JSON.stringify(served()));
	});
	await stubApi(page, "/api/v1/games/823823", 200, served());
	if (hidden) await signInDev(page, "/games/2026-09-05");
	await page.goto("/game/823823/live");
	await page.getByTestId("win-probability").waitFor();
	if (hidden) await page.getByText("Hidden with scores").waitFor();
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
}

for (const [frame, hidden] of [["live-medium", false], ["live-desktop", false], ["live-hidden-status-medium", true]] as const)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await openLive(page, hidden);
		await capture(page, testInfo, frame);
	});
}
