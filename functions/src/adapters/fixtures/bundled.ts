/**
 * The committed fixtures bundled into the Worker (S45; ADR-017): a Worker has no
 * `node:fs`, so the files the API serves are static JSON imports, and the fixture
 * client reads them through the same `FixtureFiles` port Node uses. Only what
 * `FixtureClient` reads by name is here — schedules, games, plays, standings and
 * players. The recorded replay walk (`raw/`, 5+ MB) is for the Node capture tool,
 * which the Worker never runs. `bundled.test.ts` fails when a fixture the client
 * would read is missing from this list.
 */
import game744834 from "../../../../fixtures/game-744834.json" with { type: "json" };
import game745001 from "../../../../fixtures/game-745001.json" with { type: "json" };
import game823823 from "../../../../fixtures/game-823823.json" with { type: "json" };
import players823823 from "../../../../fixtures/players-823823.json" with { type: "json" };
import plays744834 from "../../../../fixtures/plays-744834.json" with { type: "json" };
import plays823823 from "../../../../fixtures/plays-823823.json" with { type: "json" };
import playMetrics823823 from "../../../../fixtures/raw/playmetrics-823823.json" with { type: "json" };
import schedule20240704 from "../../../../fixtures/schedule-2024-07-04.json" with { type: "json" };
import schedule20260905 from "../../../../fixtures/schedule-2026-09-05.json" with { type: "json" };
import standings20260905 from "../../../../fixtures/standings-2026-09-05.json" with { type: "json" };
import { FixtureClient } from "./fixture-client.js";
import type { FixtureFiles } from "./fixture-client.js";

/** Fixture name → parsed JSON, as `fixtures/<name>` holds it. */
export const BUNDLED_FIXTURES: Readonly<Record<string, unknown>> = {
	"game-744834.json": game744834,
	"game-745001.json": game745001,
	"game-823823.json": game823823,
	"players-823823.json": players823823,
	"plays-744834.json": plays744834,
	"plays-823823.json": plays823823,
	// The recorded play-metrics feed (S93): pnpm dev reads only bundled fixtures.
	"raw/playmetrics-823823.json": playMetrics823823,
	"schedule-2024-07-04.json": schedule20240704,
	"schedule-2026-09-05.json": schedule20260905,
	"standings-2026-09-05.json": standings20260905,
};

/** The bundled fixtures as a fixture source; an unknown name rejects, like a missing file. */
export const bundledFixtureFiles: FixtureFiles = {
	read: async (name) =>
	{
		if (!(name in BUNDLED_FIXTURES)) throw new Error(`no bundled fixture ${name}`);
		return BUNDLED_FIXTURES[name];
	},
	list: async () => Object.keys(BUNDLED_FIXTURES),
};

/** The fixture MLB client the Worker uses by default. */
export function createBundledFixtureClient(): FixtureClient
{
	return new FixtureClient(bundledFixtureFiles);
}
