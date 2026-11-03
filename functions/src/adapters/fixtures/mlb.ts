/**
 * The fixture MLB client for Node (local tools, tests, `local-server.ts`): reads the
 * committed JSON under `fixtures/` with `node:fs`. The Worker reads the same files
 * bundled in (`./bundled.ts`); both share `FixtureClient`.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FixtureClient } from "./fixture-client.js";
import type { FixtureFiles } from "./fixture-client.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The committed `fixtures/` folder. */
export const FIXTURES_ROOT = path.resolve(HERE, "../../../../fixtures");

/** Files under `root` as a fixture source. */
export function nodeFixtureFiles(root: string): FixtureFiles
{
	return {
		read: async (name) => JSON.parse(await readFile(path.join(root, name), "utf8")) as unknown,
		list: () => readdir(root),
	};
}

export class FixtureMlbStatsClient extends FixtureClient
{
	constructor(fixturesRoot = FIXTURES_ROOT)
	{
		super(nodeFixtureFiles(fixturesRoot));
	}
}
