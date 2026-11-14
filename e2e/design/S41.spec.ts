/**
 * S41's design match (rule 22): the Plays room in the state and pairing of each
 * game-rooms frame it builds — `plays-mobile`, `plays-medium`, `plays-desktop` (the
 * default view: the 9th, with its last at-bat opened by the spec, since the frames draw it
 * open but nothing opens by itself any more — owner, 2026-11-12: "the plays view shouldn't
 * expand any plays by default") and `plays-scoring-mobile` (Runs chosen), on the 823823
 * fixture (CHC @ MIA, Final 6–5).
 *
 * Expected differences, not judged (owner, 2026-10-28: "Judge only the story's own
 * parts"): the frames' sample game (NYY @ BOS, 5–3) versus the fixture game, so names,
 * results, pitch counts, scores and how many at-bats each half has differ; the open
 * at-bat's header carries its matchup, count and description (owner, 2026-10-29: "When
 * expanded, can the accordion header show the data that's in this box"); the catcher's
 * view and its "Animate pitch" / "Side view" / "Top view" links are S64's as the owner
 * reviewed them; the footer's "Fetched … ago" is the real time; the top bar, tabs and
 * rail are S40's and S60's; the linescore is S2's.
 */
import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
	capture, hideDevControls, openLastAtBat,
} from "./helpers.js";

async function plays(page: Page, runs: boolean): Promise<void>
{
	await page.goto("/game/823823/plays");
	const nav = page.getByRole("navigation", {
		name: "Inning sidebar",
	});
	await nav.waitFor();
	if (runs)
	{
		await nav.getByRole("button", {
			name: "Runs",
		}).click();
		await page.getByText("Scoring plays").waitFor();
	}
	else
	{
		await openLastAtBat(page);
	}
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
}

const FRAMES: { frame: string;
	runs: boolean; }[] = [
	{
		frame: "plays-mobile",
		runs: false,
	},
	{
		frame: "plays-medium",
		runs: false,
	},
	{
		frame: "plays-desktop",
		runs: false,
	},
	{
		frame: "plays-scoring-mobile",
		runs: true,
	},
];

for (const { frame, runs } of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await plays(page, runs);
		await capture(page, testInfo, frame);
	});
}
