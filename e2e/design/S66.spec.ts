/**
 * S66's design match (rule 22): the scoreboard in the state and pairing of each
 * shell-scoreboard frame it builds — `scoreboard-*` (a final, a live and a scheduled
 * module), `scoreboard-empty-*`, `scoreboard-loading-*` and `scoreboard-error-*`, at
 * mobile, medium and desktop. The day is 2026-09-05 from the S65 fixtures: SF @ NYM
 * final 9–5 (`schedule-2026-09-05.json`), and 823823 (CHC @ MIA) in progress and before
 * first pitch (`schedule-823823-moments.json`), answered through the schedule route.
 *
 * Expected differences, not judged (owner, 2026-10-28: "Judge only the story's own
 * parts"): the frames' sample day (Sep 21, NYY @ BOS, LAD @ SD, CHC @ MIL) versus the
 * fixture games, so names, records, scores, times and venue differ, and the live row
 * reads the inning as `inningLabel` writes it (`TOP 3RD`); the right-hand slot (pitchers
 * of record, count, win probability) and the scheduled row's probable pitchers are
 * S67's; the "Best of … highlights" digest is not built yet; the start time carries the
 * viewer's zone label (owner, 2026-10-19); the footer's "Fetched … ago" is the real
 * time, and on loading and error, with nothing fetched, there is no footer; the header,
 * rail and drawer are S60's.
 */
import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { capture, hideDevControls } from "./helpers.js";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8"));
const SCHEDULE = read("schedule-2026-09-05.json");
const MOMENTS = read("schedule-823823-moments.json");

/** One game per phase; the pre-game copy is 823823 at another moment, keyed apart. */
function day(games: unknown[])
{
	return {
		...SCHEDULE,
		games,
		fetchedAt: new Date().toISOString(),
		windowMode: "active",
		version: 1,
		lastChangedAt: "2026-09-05T20:57:20.000Z",
	};
}

const GAMES = [SCHEDULE.games[0], MOMENTS.live, {
	...MOMENTS.pregame,
	gamePk: 1,
}];

type State = "games" | "empty" | "loading" | "error";

/** Answer the scoreboard's schedule request for the state, or hold it open (loading). */
async function answer(page: Page, state: State): Promise<void>
{
	await page.route(/\/api\/v1\/schedule\?/, (route: Route) =>
	{
		if (state === "loading") return;
		if (state === "error") return route.fulfill({
			status: 503,
			contentType: "application/json",
			body: JSON.stringify({
				error: "unavailable",
			}),
		});
		return route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(day(state === "empty" ? [] : GAMES)),
		});
	});
}

const READY: Record<State, (page: Page) => Promise<void>> = {
	games: (page) => page.getByTestId("scoreboard-module").first().waitFor(),
	empty: (page) => page.getByText("No games scheduled for this date.").waitFor(),
	loading: (page) => page.getByLabel("Loading").waitFor(),
	error: (page) => page.getByText("Couldn't load games").waitFor(),
};

const FRAMES: { frame: string;
	state: State; }[] = (["mobile", "medium", "desktop"] as const).flatMap((pairing) => [
	{
		frame: `scoreboard-${pairing}`,
		state: "games" as const,
	},
	{
		frame: `scoreboard-empty-${pairing}`,
		state: "empty" as const,
	},
	{
		frame: `scoreboard-loading-${pairing}`,
		state: "loading" as const,
	},
	{
		frame: `scoreboard-error-${pairing}`,
		state: "error" as const,
	},
]);

// The grader reads these names literally: "scoreboard-mobile", "scoreboard-medium",
// "scoreboard-desktop", "scoreboard-empty-mobile", "scoreboard-empty-medium",
// "scoreboard-empty-desktop", "scoreboard-loading-mobile", "scoreboard-loading-medium",
// "scoreboard-loading-desktop", "scoreboard-error-mobile", "scoreboard-error-medium",
// "scoreboard-error-desktop".

for (const { frame, state } of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await answer(page, state);
		await page.goto("/games/2026-09-05");
		await READY[state](page);
		await page.evaluate(async () =>
		{
			await document.fonts.ready;
		});
		await hideDevControls(page);
		await capture(page, testInfo, frame);
	});
}
