import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "domain",
		environment: "node",
		include: ["src/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary"],
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/index.ts"],
			thresholds: {
				// Ratchet (S54, ADR-026; backlog rule 21): floors sit at the measured value
				// rounded down and only ever go up. Measured 2026-10-20: lines 95.95, functions 94.28, branches 87.5, statements 95.95.
				// Raised 2026-10-23 by S46 (stampVersion and its tests): lines 96.17, functions 94.59, branches 88.14, statements 96.17. Target: 95 lines (met).
				// Raised 2026-10-24 by S6 (settings, teams, openingRoom and the S77 routes): lines 97.31, functions 95, branches 89.8, statements 97.31.
				// Raised 2026-10-28 by S80 (download rules): branches 90.24.
				// Raised 2026-10-29 by S61 (team colors, contrast, division names): functions 96.15, branches 91.44.
				// Raised 2026-10-29 by S63 (live, inning, linescore and recap-room rules): branches 93.07.
				// Raised 2026-10-29 by S64 (catcher's view, flights, replay schedule, field charts): lines 98.89, functions 97.82, branches 95.14.
				// Raised 2026-10-30 by S67 (S66's record / date labels and S69's highlight filters folded in):
				// lines 99.04, functions 98.13, branches 96, statements 99.04.
				lines: 99,
				functions: 98,
				branches: 96,
				statements: 99,
			},
		},
	},
});
