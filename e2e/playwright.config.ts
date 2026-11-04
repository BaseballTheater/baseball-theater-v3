/**
 * The browser harness (S81; ADR-026 as amended 2026-10-28, backlog rule 22).
 * It runs the app the way `pnpm dev` does — fixture-backed API on :8787 and the
 * Vite app on :5173 — and opens it at the three host pairings. Desktop is
 * 1200px wide, where the app's layout host switches to the rail (owner,
 * 2026-10-28: "Capture at 1200px"), not the frames' 1008px.
 *
 * Not part of `pnpm verify`: browsers start only through `pnpm design:capture`
 * and S62's flows. `BT_E2E_OUTPUT` moves Playwright's own output (traces,
 * failure shots) out of the tree, which graders need (they may not write it).
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	outputDir: process.env.BT_E2E_OUTPUT ?? "test-results",
	fullyParallel: false,
	// One worker for the design specs, which share the dev account and its settings; `pnpm e2e`
	// runs the flows with --workers=4 (S89), since each flow keeps its state in its own browser.
	workers: 1,
	reporter: [["list"]],
	use: {
		baseURL: "http://localhost:5173",
	},
	webServer: {
		command: "pnpm dev",
		cwd: "..",
		url: "http://localhost:5173",
		reuseExistingServer: true,
		timeout: 60_000,
	},
	projects: [
		{
			name: "mobile",
			use: {
				viewport: {
					width: 390,
					height: 844,
				},
			},
		},
		{
			name: "medium",
			use: {
				viewport: {
					width: 768,
					height: 1024,
				},
			},
		},
		{
			name: "desktop",
			use: {
				viewport: {
					width: 1200,
					height: 844,
				},
			},
		},
	],
});
