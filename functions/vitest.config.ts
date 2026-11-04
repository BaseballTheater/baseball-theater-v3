import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "functions",
		environment: "node",
		include: ["src/**/*.test.ts"],
		// `*.workerd.test.ts` run inside workerd under vitest.workers.config.ts (S45).
		exclude: ["src/**/*.workerd.test.ts"],
		// Many tests build their own migrated PGlite (S51): ~1 s locally, but 5–6 s on a loaded
		// 2-core CI runner, which the 5 s default timed out (live.test.ts, worker-app.test.ts).
		// No test asserts on speed; this only stops slow setup reading as a failure.
		testTimeout: 20_000,
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary"],
			include: ["src/**/*.ts"],
			exclude: [
				"src/**/*.test.ts",
				"src/**/*.d.ts",
				"src/local-server.ts",
				"src/scripts/**",
			],
			thresholds: {
				// Ratchet (S54, ADR-026; backlog rule 21): floors sit at the measured value
				// rounded down and only ever go up. Measured 2026-10-20: lines 80.01, functions 87.77, branches 78.21, statements 80.01.
				// Raised 2026-10-23 by S46 (repository contract + versioning tests; S44's gain folded in):
				// lines 82.45, functions 90, branches 80.04, statements 82.45. Target: 85 lines / 80 branches.
				// Raised 2026-10-23 by S8 (session, sign-in and /me tests): lines 87.99, functions 92.53, branches 82.61,
				// statements 87.99. Target met: 85 lines / 80 branches.
				// Raised 2026-10-24 by S77 (S76's lag folded in; export/delete, deletion log and manifest tests):
				// lines 89.85, branches 85.54, statements 89.85.
				// Raised 2026-10-24 by S6 (settings routes, repository and deletion case (i)): lines 90.26, functions 93.4,
				// branches 85.98, statements 90.26.
				// Raised 2026-10-28 by S80 (download routes, stores and mailer; S6's branch lag folded in): lines 91.33,
				// functions 94.58, branches 86.57, statements 91.33.
				// Raised 2026-10-29 by S63 (live fixture, mapLive, the HTTP client's recorded-fixture
				// test and the box score / recap mappers): lines 95.62, functions 95.08, statements 95.62.
				// Raised 2026-10-29 by S65 (scoreboard summary mappers, folded summaries, schedule route): lines 96.04,
				// branches 88.36, statements 96.04.
				lines: 96,
				functions: 95,
				// Raised 2026-10-29 by S87 (deletion cookie and cookie-law tests): branches 87.18.
				// Raised 2026-10-30 by S67 (S45's Worker composition and S69's keyword mapping folded in): branches 89.62.
				// Raised 2026-10-30 by S48 (the per-game ingest object, hub leases and their tests): branches 90.62.
				// Raised 2026-10-30 by S18 (the live hub, its route and their tests): branches 91.19.
				branches: 91,
				statements: 96,
			},
		},
	},
});
