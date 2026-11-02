/**
 * S4's design match (rule 22): Standings as standings-search-settings draws it —
 * `standings-mobile`, `-medium` and `-desktop` (desktop at 1200px, owner 2026-10-28). The
 * standings route is answered with the committed recording, `fixtures/standings-2026-09-05.json`.
 *
 * Judge only S4's parts (owner, 2026-10-28: "Judge only the story's own parts"): the title,
 * the division tables (swatch and name, abbreviation, W, L, PCT, GB with "—" for the
 * leader) in one column that widens with the host, and the footer line. Expected
 * differences: the frames' sample records versus the recording's (2026-09-05, so Tampa Bay
 * leads the AL East), and the recording's six divisions where the frames show the AL's
 * three (the NL's follow below the fold); the footer's "Fetched … ago" is the real time.
 */
import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import {
	capture, hideDevControls, stubApi,
} from "./helpers.js";

const STANDINGS = JSON.parse(readFileSync(new URL("../../fixtures/standings-2026-09-05.json", import.meta.url), "utf8"));

for (const frame of ["standings-mobile", "standings-medium", "standings-desktop"])
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await stubApi(page, "/api/v1/standings", 200, {
			...STANDINGS,
			fetchedAt: new Date().toISOString(),
		});
		await page.goto("/standings");
		await page.getByTestId("division-table").first().waitFor();
		await page.evaluate(async () =>
		{
			await document.fonts.ready;
		});
		await hideDevControls(page);
		await capture(page, testInfo, frame);
	});
}
