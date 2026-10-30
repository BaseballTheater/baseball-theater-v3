/**
 * S67's design match (rule 22): the scoreboard's game-row slot in the frames it builds —
 * `scoreboard-mobile`, `-medium`, `-desktop` with the default Status occupants (pitchers
 * of record on the final, the count on the live game, the probables on the scheduled
 * one), and `scoreboard-slot-room-menu-mobile` with Room Menu chosen (the dev account's
 * settings answered with `gameRowSlot: "roomMenu"`). The day is S66's: SF @ NYM final
 * and 823823 (CHC @ MIA) in progress and before first pitch, from the S65 fixtures.
 *
 * Expected differences, not judged (owner, 2026-10-28: "Judge only the story's own
 * parts"): the frames' sample day, names and lines versus the fixture games; the
 * scheduled slot shows the probables, not win probability (owner, 2026-10-19: Status is
 * pitchers / count / probables; win probability is left out at launch), and the
 * scheduled module body no longer repeats them; probables carry no throwing hand (the
 * scoreboard data has none); the count is the shared ball / strike / out pips beside the
 * bases (the story reuses `BsoPips`) rather than the frame's "0-2, 2 out" text; the
 * module itself is S66's; the "Best of … highlights" digest is not built yet; the room
 * menu frame's signed-in header shows the account icon; the footer's "Fetched … ago"
 * is the real time.
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

async function scoreboard(page: Page, roomMenu: boolean): Promise<void>
{
	await page.route(/\/api\/v1\/schedule\?/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify(DAY),
	}));
	if (roomMenu)
	{
		await page.route(/\/api\/v1\/me\/settings$/, (route) => route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				favoriteTeamIds: [],
				opensFirst: "videos",
				gameRowSlot: "roomMenu",
				version: 1,
			}),
		}));
		await signInDev(page, "/games/2026-09-05");
		await page.getByTestId("slot-room-menu").first().waitFor();
	}
	else
	{
		await page.goto("/games/2026-09-05");
		await page.getByTestId("game-row-slot").first().waitFor();
	}
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
}

const FRAMES: { frame: string;
	roomMenu: boolean; }[] = [
	{
		frame: "scoreboard-mobile",
		roomMenu: false,
	},
	{
		frame: "scoreboard-medium",
		roomMenu: false,
	},
	{
		frame: "scoreboard-desktop",
		roomMenu: false,
	},
	{
		frame: "scoreboard-slot-room-menu-mobile",
		roomMenu: true,
	},
];

for (const { frame, roomMenu } of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await scoreboard(page, roomMenu);
		await capture(page, testInfo, frame);
	});
}
