/**
 * S45: the Worker's bundled fixtures are the committed files, all of them that the
 * fixture client reads by name — so a new committed schedule or game can't silently
 * 404 in `pnpm dev` while Node tests pass.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import { BUNDLED_FIXTURES, bundledFixtureFiles } from "./bundled.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");

/**
 * What `FixtureClient` reads by name: `schedule-<date>`, `game-<pk>`, `plays-<pk>`, `standings-<date>`,
 * `players-*`, and from `raw/` the play-metrics recordings (S93), the GraphQL game content (S94)
 * the season calendars and World Series (S111), and each season's final and spring standings (S128).
 */
const SERVED = new RegExp(`^(${[
	String.raw`schedule-\d{4}-\d{2}-\d{2}`, String.raw`game-\d+`, String.raw`plays-\d+`, String.raw`standings-\d{4}-\d{2}-\d{2}`, "players-.+",
	String.raw`raw/playmetrics-\d+`, String.raw`raw/graphql-content-\d+`, String.raw`raw/seasons-\d{4}`, String.raw`raw/worldseries-\d{4}`,
	String.raw`raw/standings-\d{4}-(?:final|spring)`,
].join("|")})\\.json$`);

describe("bundled fixtures (S45)", () =>
{
	it("bundles exactly the committed fixtures the client serves, unchanged", () =>
	{
		const committed = [...readdirSync(FIXTURES), ...readdirSync(path.join(FIXTURES, "raw")).map((name) => `raw/${name}`)]
			.filter((name) => SERVED.test(name)).sort();
		expect(Object.keys(BUNDLED_FIXTURES).sort()).toEqual(committed);
		for (const name of committed)
		{
			expect(BUNDLED_FIXTURES[name], name).toEqual(JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8")));
		}
	});

	it("an unknown fixture rejects like a missing file", async () =>
	{
		await expect(bundledFixtureFiles.read("game-1.json")).rejects.toThrow(/no bundled fixture/);
		expect(await bundledFixtureFiles.list()).toContain("schedule-2024-07-04.json");
	});
});
