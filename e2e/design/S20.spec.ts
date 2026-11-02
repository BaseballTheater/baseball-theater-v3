/**
 * S20's design match (rule 22): the scoreboard after a live refresh, in the frames it keeps
 * current — shell-scoreboard `scoreboard-mobile`, `-medium` and `-desktop` (desktop at
 * 1200px, owner 2026-10-28). The day is S66's (SF @ NYM final, 823823 CHC @ MIA in progress
 * and before first pitch), served `active`. The first schedule answer has the live game
 * 1–0; every later one has it 3–2, as a newer version. Playwright's clock moves past one
 * refresh interval (15s, `LIVE_REFRESH_MS`) and the capture waits for 3–2, so each frame
 * shows the second payload's scores without a reload.
 *
 * Judge only S20's parts (owner, 2026-10-28: "Judge only the story's own parts"): the
 * scoreboard as drawn, carrying the refreshed scores. Expected differences are earlier
 * stories' (the frames' sample day, names and lines versus the fixture games; the module
 * is S66's and the game-row slot S67's, both matched) and later ones' (the "Best of …
 * highlights" digest, S71; the Win Probability slot occupant on live and final games,
 * S108). The footer's "Fetched … ago" is the real time.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { capture, hideDevControls } from "./helpers.js";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8"));
const SCHEDULE = read("schedule-2026-09-05.json");
const MOMENTS = read("schedule-823823-moments.json");

/** The day with the live game at `away`–`home`, as `version`. */
function day(away: number, home: number, version: number)
{
	const { linescore } = MOMENTS.live;
	return {
		...SCHEDULE,
		games: [SCHEDULE.games[0], {
			...MOMENTS.live,
			linescore: {
				...linescore,
				teams: {
					away: {
						...linescore.teams.away,
						runs: away,
					},
					home: {
						...linescore.teams.home,
						runs: home,
					},
				},
			},
		}, {
			...MOMENTS.pregame,
			gamePk: 1,
		}],
		fetchedAt: new Date().toISOString(),
		windowMode: "active",
		version,
		lastChangedAt: "2026-09-05T20:57:20.000Z",
	};
}

for (const frame of ["scoreboard-mobile", "scoreboard-medium", "scoreboard-desktop"])
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		let asked = 0;
		await page.route(/\/api\/v1\/schedule\?/, (route) =>
		{
			asked += 1;
			return route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(asked === 1 ? day(1, 0, 1) : day(3, 2, 2)),
			});
		});
		await page.clock.install();
		await page.goto("/games/2026-09-05");
		const live = page.getByTestId("scoreboard-module").nth(1);
		await expect(live.getByTestId("runs")).toHaveText(["1", "0"]);
		await page.clock.runFor(16_000);
		await expect(live.getByTestId("runs")).toHaveText(["3", "2"]);
		await page.evaluate(async () =>
		{
			await document.fonts.ready;
		});
		await hideDevControls(page);
		await capture(page, testInfo, frame);
	});
}
