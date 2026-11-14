/**
 * The main flows (S62; ADR-026: Playwright "cover[s] the main flows … against
 * fixtures"): scoreboard → game → every room tab, plus standings, search and
 * settings signed in through the dev sign-in. Runs at all three pairings from
 * S81's config, on the fixture-backed app `pnpm dev` serves. `pnpm e2e` runs it;
 * `pnpm verify` never does (law P8).
 *
 * The fixtures hold one in-progress game (745001: Videos, Live, Plays, Box), a
 * final without a recap (744834: Videos, Plays, Box — S10 shows Recap only when one
 * exists) and a final with one (823823, on 2026-09-05: Videos, Plays, Box, Recap), so
 * between them every room opens.
 *
 * They run on several workers, each test twice in CI (S89), so none may depend on another:
 * each gets its own browser context, and the one signed-in flow only reads Settings, so the
 * shared dev account is never changed.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openSettings, signInDev } from "../design/helpers.js";

const SCOREBOARD = "/games/2024-07-04";

/** From a day's scoreboard, open a game's card and click through each room tab. */
async function walkGame(page: Page, gamePk: number, rooms: readonly string[], scoreboard = SCOREBOARD): Promise<void>
{
	await page.goto(scoreboard);
	await page.locator(`a[href="/game/${gamePk}"]`).click();
	await expect(page).toHaveURL(new RegExp(`/game/${gamePk}`));
	for (const room of rooms)
	{
		const tab = page.getByRole("tab", {
			name: room,
		});
		await tab.click();
		await expect(tab).toHaveAttribute("aria-selected", "true");
		await expect(page).toHaveURL(new RegExp(`/game/${gamePk}/${room.toLowerCase()}$`));
		await expect(page.getByRole("tabpanel")).toBeVisible();
	}
}

test("scoreboard → a live game → each of its rooms", async ({ page }) =>
{
	await walkGame(page, 745001, ["Videos", "Live", "Plays", "Box"]);
});

test("scoreboard → a final game → each of its rooms", async ({ page }) =>
{
	await walkGame(page, 744834, ["Videos", "Plays", "Box"]);
});

test("scoreboard → a final game with a recap → each of its rooms", async ({ page }) =>
{
	await walkGame(page, 823823, ["Videos", "Plays", "Box", "Recap"], "/games/2026-09-05");
});

test("standings", async ({ page }) =>
{
	await page.goto("/standings");
	await expect(page.getByRole("heading", {
		name: "Standings",
	})).toBeVisible();
});

test("search", async ({ page }) =>
{
	await page.goto("/search");
	await expect(page.getByRole("heading", {
		name: "Search",
	})).toBeVisible();
});

test("settings, signed in through the dev sign-in", async ({ page }) =>
{
	await signInDev(page, SCOREBOARD);
	await openSettings(page);
	await expect(page).toHaveURL(/\/settings$/);
	await expect(page.getByRole("heading", {
		name: "Settings",
	})).toBeVisible();
});
