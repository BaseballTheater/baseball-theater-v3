/**
 * The update notice (S73; S55 shell-scoreboard A1's copy, A6's floating box; ADR-026 "cover
 * the main flows"): when a new version is waiting, "An update to Baseball Theater is ready."
 * floats at the bottom of the screen with Snooze and Update Now. `pnpm dev` runs no service
 * worker, so the flow raises the notice through the development trigger the app exposes
 * (`btShowUpdate`, `src/pwa/updates.ts`), which stands in for a waiting worker and reloads
 * on Update Now. The hour Snooze waits is a fake-timer unit test (`UpdateNotice.test.tsx`);
 * here a reload within it stays quiet, because the snooze is remembered in the browser.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const MESSAGE = "An update to Baseball Theater is ready.";

async function showUpdate(page: Page): Promise<void>
{
	await page.evaluate(() => (window as { btShowUpdate?: () => void }).btShowUpdate?.());
}

test("update notice: Update Now reloads the page without it; Snooze hides it, through a reload", async ({ page }) =>
{
	await page.goto("/games/2024-07-04");
	await page.getByTestId("scoreboard-module").first().waitFor();
	await expect(page.getByText(MESSAGE)).toHaveCount(0);

	await showUpdate(page);
	await expect(page.getByText(MESSAGE)).toBeVisible();
	await expect(page.getByTestId("notice-float")).toBeVisible();
	await expect(page.getByRole("button", {
		name: "Dismiss",
	})).toHaveCount(0);
	await Promise.all([
		page.waitForEvent("load"),
		page.getByRole("button", {
			name: "Update Now",
		}).click(),
	]);
	await page.getByTestId("scoreboard-module").first().waitFor();
	await expect(page.getByText(MESSAGE)).toHaveCount(0);

	await showUpdate(page);
	await expect(page.getByText(MESSAGE)).toBeVisible();
	await page.getByRole("button", {
		name: "Snooze",
	}).click();
	await expect(page.getByText(MESSAGE)).toHaveCount(0);

	await page.reload();
	await page.getByTestId("scoreboard-module").first().waitFor();
	await showUpdate(page);
	await expect(page.getByText(MESSAGE)).toHaveCount(0);
});
