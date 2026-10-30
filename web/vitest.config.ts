import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		name: "web",
		environment: "jsdom",
		include: ["src/**/*.test.{ts,tsx}"],
		setupFiles: ["./src/test/setup.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary"],
			include: ["src/**/*.{ts,tsx}"],
			// `src/api/generated/**` is committed codegen output (S29) — not ours to test.
			exclude: ["src/**/*.test.{ts,tsx}", "src/main.tsx", "src/test/**", "src/api/generated/**", "dist/**"],
			thresholds: {
				// Raised 2026-09-15 by S25: the query-cache migration added real tests
				// for `src/api/*` (descriptors, typed cache writes, two readers sharing
				// one entry) — lines/statements 5.15% -> 11.67%, branches 55% -> 68.75%,
				// functions unchanged at 55.55%. Floors sit just under measured, with
				// headroom. Still low overall: `GamePage.tsx` and `ScoreboardPage.tsx`
				// now read through hooks but have no component tests of their own, and
				// `SearchPage.tsx`, `SettingsPage.tsx`, `App.tsx`, `routes.tsx`, and most
				// of `components/pitch/*` have none either — S2–S5/S10 are expected to
				// raise this further as they land the tab content they own (rule: a story
				// touching a zero-tested surface raises this, never just holds it flat).
				// Raised 2026-09-18 by S29: `src/api/codegen.ts` arrived with its drift
				// test (lines/statements 11.67% -> 14.46%, functions 55.55% -> 57.89%,
				// branches 68.57%); the committed `src/api/generated/**` is excluded above.
				// Ratchet (S54, ADR-026; backlog rule 21): floors now sit at the measured
				// value rounded down and only ever go up. Measured 2026-10-20: lines
				// 47.35, functions 69.81, branches 84, statements 47.35. Target: 85 lines /
				// 80 branches by the end of the UI band; `components/pitch/*`,
				// `ScoreboardPage`, `SearchPage` and `SettingsPage` are the gap.
				// Raised 2026-10-23 by S59 (session provider, dev sign-in and Settings gating tests;
				// S49's untaken gain folded in): lines 54.3, functions 77.27, branches 88.8, statements 54.3.
				// Raised 2026-10-24 by S6 (S76's lag folded in; settings store, Settings page and Opens First tests):
				// lines 60.29, functions 82.02, branches 91.51, statements 60.29.
				// Raised 2026-10-28 by S60 (layout host, rail, drawer, notice slot, footer, ViewState, LiveIndicator tests):
				// lines 65.7, functions 84, branches 92.72, statements 65.7.
				// Raised 2026-10-28 by S83 (rail, header and wordmark Figma-value tests): lines 66.08, statements 66.08.
				// Raised 2026-10-28 by S79 (download and delete tests): lines 70.88, functions 86.92, branches 93.7, statements 70.88.
				// Raised 2026-10-29 by S79's A5 rework (deleted page tests): functions 87.78, branches 94.21.
				// Raised 2026-10-29 by S61 (team edge, swatch and matchup tests): lines 71.62, functions 88.14, statements 71.62.
				// Raised 2026-10-29 by S3 (live status tests; the parked S2 / S10 rooms' tests folded in):
				// lines 75.63, functions 88.88, branches 96.09, statements 75.63.
				// Raised 2026-10-29 by S64 (Live pitch theater, catcher's view, Plays replays): lines 97.29, functions 94.68, branches 96.81.
				// Raised 2026-10-29 by S41 (Plays room: inning sidebar, half-inning rows, scoring plays): functions 95.83, branches 97.16.
				// Raised 2026-10-30 by S67 (S66's scoreboard, S69's Videos room and S67's slot folded in):
				// lines 99.1, functions 97.16, branches 98.11, statements 99.1.
				lines: 99,
				functions: 97,
				branches: 98,
				statements: 99,
			},
		},
	},
});
