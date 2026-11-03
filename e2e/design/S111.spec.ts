/**
 * S111's design match (rule 22): the scoreboard opened from `/`, with no day in the URL.
 * The default-date route is answered with the fixture day 2026-09-05 — a recording with every
 * slot's data (pitchers of record), unlike 2024-07-04, whose older recording leaves the Game-Row
 * Slot empty (owner, 2026-11-03: "the frame on the right side of the scoreboard is broken") — so
 * the frame is the ratified `scoreboard-mobile` (S31) reached through the new default. The story changes
 * only which day opens; judge that `/` lands on the scoreboard as drawn, with the date
 * control on the default day and nothing new on the page.
 */
import { test } from "@playwright/test";
import {
	capture, freezeClock, hideDevControls, stubApi,
} from "./helpers.js";

test("scoreboard-mobile", async ({ page }, testInfo) =>
{
	test.skip(testInfo.project.name !== "mobile", "scoreboard-mobile is drawn at the mobile pairing");
	await freezeClock(page, "2026-09-05T23:00:00.000Z");
	await stubApi(page, "/api/v1/scoreboard/default-date", 200, {
		date: "2026-09-05",
	});
	await page.goto("/");
	await page.waitForURL("**/games/2026-09-05");
	// The footer line marks a loaded page.
	await page.getByText(/baseball\.theater$/).waitFor();
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
	await capture(page, testInfo, "scoreboard-mobile");
});
