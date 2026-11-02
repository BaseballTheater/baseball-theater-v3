/**
 * S109's design match (rule 22): the Live room with the inning, count and outs in one
 * place, game-rooms A5's `live-mobile`, `live-medium` and `live-desktop` (desktop at
 * 1200px, owner 2026-10-28). The game route is answered with
 * `fixtures/game-823823-live.json`, served in its window, as S64's and S19's specs do;
 * the live route is answered by Playwright's WebSocket stand-in with the same moment, so
 * the page settles on the stream (S19) instead of falling back to polling.
 *
 * Judge only S109's parts (owner, 2026-10-28: "Judge only the story's own parts"): the
 * status row or card reads the inning alone beside the score, diamond and pips, and the
 * mobile matchup line has no count beside it. Expected differences are earlier stories'
 * (the fixture's CHC @ MIA, Top 3rd, 2–2 with two out, versus the frames' NYY @ BOS,
 * Bot 7th; no headshots) and later ones' (the win-probability card at medium and desktop,
 * S106). A5's two `live-hidden-status-*` frames are S75's, which masks the score.
 */
import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import {
	capture, hideDevControls, stubApi,
} from "./helpers.js";

const LIVE = JSON.parse(readFileSync(new URL("../../fixtures/game-823823-live.json", import.meta.url), "utf8"));
const served = () => ({
	...LIVE,
	fetchedAt: new Date().toISOString(),
	windowMode: "active",
	version: 1,
	lastChangedAt: "2026-09-05T20:57:20.000Z",
});

for (const frame of ["live-mobile", "live-medium", "live-desktop"])
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await page.routeWebSocket(/\/api\/v1\/games\/823823\/live/, (socket) =>
		{
			socket.send(JSON.stringify(served()));
		});
		await stubApi(page, "/api/v1/games/823823", 200, served());
		await page.goto("/game/823823/live");
		await page.getByTestId("matchup-cards").waitFor();
		await page.evaluate(async () =>
		{
			await document.fonts.ready;
		});
		await hideDevControls(page);
		await capture(page, testInfo, frame);
	});
}
