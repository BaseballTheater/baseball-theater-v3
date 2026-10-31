/**
 * S19's design match (rule 22): a game page following a game in progress live, in the
 * frames it keeps current — game-rooms `live-mobile` and game-shell
 * `game-phase-live-mobile` — after an update has arrived over the WebSocket. The phase
 * frame is drawn on the Videos tab (the game page's default room), so it is captured there,
 * with the stream still running; `live-mobile` is the Live room. The game
 * route is answered with `fixtures/game-823823-live.json` (as S64's spec does: `pnpm dev`
 * has no live game with plays), served in its window, and the live route is answered by
 * Playwright's WebSocket stand-in, which pushes the same moment as version 2. The live
 * fixture records no highlights, so the dev API's own 40 for the game are carried over for
 * the Videos tab. Vite's dev
 * proxy doesn't carry WebSockets, so the socket is routed here, not through the API.
 *
 * Judge only S19's parts (owner, 2026-10-28: "Judge only the story's own parts"): the page
 * after a streamed update is the page as drawn, with no score in the top bar and nothing
 * remounted. Expected differences are S64's (the fixture's CHC @ MIA, Top 3rd, versus the
 * frames' NYY @ BOS, Bot 7th; no win-probability chart yet, S106; no headshots); the top
 * bar, tabs and status are S40's and S3's; the footer's "Fetched … ago" is the real time.
 */
import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import {
	capture, hideDevControls, stubApi,
} from "./helpers.js";

const LIVE = JSON.parse(readFileSync(new URL("../../fixtures/game-823823-live.json", import.meta.url), "utf8"));
let highlights: unknown[] = [];
const served = (version: number) => ({
	...LIVE,
	highlights,
	fetchedAt: new Date().toISOString(),
	windowMode: "active",
	version,
	lastChangedAt: "2026-09-05T20:57:20.000Z",
});

/** Each frame's room, and what shows once it has drawn. */
const ROOMS: Record<string, { path: string;
	ready: string; }> = {
	"live-mobile": {
		path: "/game/823823/live",
		ready: "matchup-cards",
	},
	"game-phase-live-mobile": {
		path: "/game/823823/videos",
		ready: "videos-grid",
	},
};

for (const [frame, room] of Object.entries(ROOMS))
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		highlights = (await (await page.request.get("/api/v1/games/823823")).json()).highlights;
		let pushed: () => void = () => undefined;
		const arrived = new Promise<void>((resolve) =>
		{
			pushed = resolve;
		});
		await page.routeWebSocket(/\/api\/v1\/games\/823823\/live/, (socket) =>
		{
			socket.send(JSON.stringify(served(2)));
			pushed();
		});
		await stubApi(page, "/api/v1/games/823823", 200, served(1));
		await page.goto(room.path);
		await page.getByTestId(room.ready).first().waitFor();
		await arrived;
		await page.waitForTimeout(300);
		await page.evaluate(async () =>
		{
			await document.fonts.ready;
		});
		await hideDevControls(page);
		await capture(page, testInfo, frame);
	});
}
