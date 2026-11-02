/**
 * The update notice (S73; S55 shell-scoreboard A1, ADR-026 "cover the main flows"): when a
 * new version is waiting, "An update to Baseball Theater is ready." shows under the header
 * with Reload and ✕. `pnpm dev` runs no service worker, so the flow raises the notice
 * through the development trigger the app exposes (`btShowUpdate`, `src/pwa/updates.ts`),
 * which stands in for a waiting worker and reloads on Reload.
 */
import { expect, test } from "@playwright/test";

const MESSAGE = "An update to Baseball Theater is ready.";

test("update notice: ✕ dismisses it; Reload reloads the page without it", async ({ page }) =>
{
	await page.goto("/games/2024-07-04");
	await page.getByTestId("scoreboard-module").first().waitFor();
	await expect(page.getByText(MESSAGE)).toHaveCount(0);

	await page.evaluate(() => (window as { btShowUpdate?: () => void }).btShowUpdate?.());
	await expect(page.getByText(MESSAGE)).toBeVisible();
	await page.getByRole("button", {
		name: "Dismiss",
	}).click();
	await expect(page.getByText(MESSAGE)).toHaveCount(0);

	await page.evaluate(() => (window as { btShowUpdate?: () => void }).btShowUpdate?.());
	await expect(page.getByText(MESSAGE)).toBeVisible();
	await Promise.all([
		page.waitForEvent("load"),
		page.getByRole("button", {
			name: "Reload",
		}).click(),
	]);
	await page.getByTestId("scoreboard-module").first().waitFor();
	await expect(page.getByText(MESSAGE)).toHaveCount(0);
});
