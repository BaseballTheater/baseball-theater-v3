/**
 * `pnpm db:copy-baseball` end to end (S117), with its databases as two in-process PGlites and its
 * Neon API as a stand-in: no network. Production is one migration behind the code here (a
 * migration of the run's own folder that touches no baseball table), as it is whenever `stage`
 * carries a migration production hasn't had, so migrating the wrong database would show.
 */
import {
	cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import {
	describe, expect, it,
} from "vitest";
import { MIGRATIONS_FOLDER, migratedPglite } from "../adapters/postgres/migrate.js";
import type { PostgresDb } from "../adapters/postgres/repos.js";
import type { CopyRunDeps } from "./copy-baseball-run.js";
import { runCopy } from "./copy-baseball-run.js";

const SOURCE = "postgres://reader:source-pw@localhost:5432/production"; // ggignore
const TARGET = "postgres://writer:target-pw@localhost:5432/staging"; // ggignore

async function hashes(db: PostgresDb): Promise<string[]>
{
	const found = await db.execute(sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`) as unknown as { rows: { hash: string }[] };
	return found.rows.map((row) => row.hash);
}

/**
 * The run's migrations: the committed ones plus `0001_run_ahead`, which creates a table of its own and touches no
 * baseball table, so production (migrated from the committed folder alone) is one migration behind it.
 */
const RUN_FOLDER = (() =>
{
	const folder = mkdtempSync(join(tmpdir(), "bt-run-migrations-"));
	cpSync(MIGRATIONS_FOLDER, folder, {
		recursive: true,
	});
	const journalPath = join(folder, "meta", "_journal.json");
	const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { idx: number;
		when: number; }[]; };
	writeFileSync(join(folder, "0001_run_ahead.sql"), "CREATE TABLE \"run_ahead\" (\"id\" integer PRIMARY KEY);");
	journal.entries.push({
		idx: journal.entries.length,
		version: "7",
		when: journal.entries.at(-1)!.when + 1,
		tag: "0001_run_ahead",
		breakpoints: true,
	} as (typeof journal.entries)[number]);
	writeFileSync(journalPath, JSON.stringify(journal));
	return folder;
})();

/** Production one migration behind the run's folder, with a game; an empty, unmigrated target. */
async function databases(): Promise<{ source: PostgresDb;
	target: PostgresDb; }>
{
	const { db: source } = await migratedPglite();
	await source.execute(sql`INSERT INTO games (game_pk, official_date, version, document) VALUES (1, '2024-04-01', 5, '{"gamePk":1,"lastChangedAt":"2024-04-02T00:00:00.000Z"}')`);
	const target = drizzlePglite(new PGlite()) as unknown as PostgresDb;
	return {
		source,
		target,
	};
}

/** The run's stand-ins: opens map URLs to the PGlites, and every line written is kept in order. */
function deps(dbs: Record<string, PostgresDb>, fetch: CopyRunDeps["fetch"] = () => Promise.reject(new Error("no network in tests"))): CopyRunDeps & { lines: string[];
	opened: string[];
	migratedFrom: string[]; }
{
	const lines: string[] = [];
	const opened: string[] = [];
	const migratedFrom: string[] = [];
	return {
		lines,
		opened,
		migratedFrom,
		migrationsFolder: RUN_FOLDER,
		open: async (url) =>
		{
			opened.push(url);
			const db = dbs[url];
			if (!db) throw new Error("unknown database");
			return {
				db,
				close: async () => undefined,
			};
		},
		migrate: (db, folder) =>
		{
			migratedFrom.push(folder);
			return migratePglite(db as Parameters<typeof migratePglite>[0], {
				migrationsFolder: folder,
			});
		},
		fetch,
		out: (line) => lines.push(line),
		err: (line) => lines.push(line),
	};
}

describe("runCopy, the db:copy-baseball command (S117)", () =>
{
	it("production unchanged: migrates the target, never production (still one migration behind), and copies", async () =>
	{
		const { source, target } = await databases();
		const before = await hashes(source);
		const run = deps({
			[SOURCE]: source,
			[TARGET]: target,
		});
		expect(await runCopy({
			BT_SOURCE_DATABASE_URL: SOURCE,
			BT_DATABASE_URL: TARGET,
		}, [], run)).toBe(0);
		expect(await hashes(source)).toEqual(before);
		expect((await hashes(target)).length).toBe(before.length + 1);
		// One folder: the target is migrated from the same migrations the copy compares production's record against.
		expect(run.migratedFrom).toEqual([RUN_FOLDER]);
		expect(run.lines).toContain("[db:copy-baseball] migrations only the target has: 0001_run_ahead (touches no baseball table)");
		const games = await target.execute(sql`SELECT game_pk FROM games`) as unknown as { rows: unknown[] };
		expect(games.rows).toEqual([{
			game_pk: 1,
		}]);
	});

	it("refused: a target that has run a migration this checkout doesn't have exits 2, names it, and gets no row", async () =>
	{
		const { source } = await databases();
		const { db: target } = await migratedPglite();
		await target.execute(sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('from-elsewhere', 99999999999999)`);
		const run = deps({
			[SOURCE]: source,
			[TARGET]: target,
		});
		expect(await runCopy({
			BT_SOURCE_DATABASE_URL: SOURCE,
			BT_DATABASE_URL: TARGET,
		}, [], run)).toBe(2);
		expect(run.lines.at(-1)).toMatch(/^\[db:copy-baseball\] refusing: the target has run migration created_at 99999999999999 \(hash from-elsewhere\)/);
		const games = await target.execute(sql`SELECT game_pk FROM games`) as unknown as { rows: unknown[] };
		expect(games.rows).toEqual([]);
	});

	it("manual only: the copy's workflow runs on workflow_dispatch alone, and no other workflow runs the copy", () =>
	{
		const workflows = fileURLToPath(new URL("../../../.github/workflows/", import.meta.url));
		const copyWorkflow = readFileSync(join(workflows, "copy-baseball-data.yml"), "utf8");
		const on = copyWorkflow.split("\n").slice(copyWorkflow.split("\n").indexOf("on:") + 1);
		const triggers = on.slice(0, on.findIndex((line) => /^\S/.test(line))).filter((line) => /^ {4}\S/.test(line)).map((line) => line.trim().replace(/:.*$/, ""));
		expect(triggers).toEqual(["workflow_dispatch"]);
		expect(copyWorkflow).toContain("pnpm db:copy-baseball");
		for (const file of readdirSync(workflows).filter((name) => name !== "copy-baseball-data.yml"))
		{
			expect(readFileSync(join(workflows, file), "utf8"), file).not.toMatch(/db:copy-baseball|copy-baseball-run|db-copy-baseball/);
		}
	});

	it("refused: a target that may be production is never opened, and nothing but the masks is printed before the refusal", async () =>
	{
		const { source, target } = await databases();
		const hosted = "postgres://writer:target-pw@ep-somewhere.us-east-2.aws.neon.tech/neondb"; // ggignore
		const run = deps({
			[SOURCE]: source,
			[hosted]: target,
		});
		expect(await runCopy({
			BT_SOURCE_DATABASE_URL: SOURCE,
			BT_DATABASE_URL: hosted,
			GITHUB_ACTIONS: "true",
		}, [], run)).toBe(2);
		expect(run.opened).toEqual([]);
		expect(run.lines.filter((line) => !line.startsWith("::add-mask::"))).toEqual([expect.stringMatching(/^\[db:copy-baseball\] refusing ep-somewhere/)]);
		expect(await target.execute(sql`SELECT to_regclass('public.games') AS t`).then((result) => (result as unknown as { rows: unknown[] }).rows)).toEqual([{
			t: null,
		}]);
	});

	it("refused: --neon staging with no staging branch creates nothing and opens nothing", async () =>
	{
		const methods: string[] = [];
		const run = deps({}, async (input, init) =>
		{
			methods.push(init?.method ?? "GET");
			if (input.endsWith("/branches")) return Response.json({
				branches: [{
					id: "br-prod",
					name: "main",
					default: true,
				}],
			});
			return new Response("", {
				status: 404,
			});
		});
		expect(await runCopy({
			NEON_API_KEY: "key",
			NEON_PROJECT_ID: "proj",
		}, ["--neon", "staging"], run)).toBe(2);
		expect(methods.filter((method) => method !== "GET")).toEqual([]);
		expect(run.opened).toEqual([]);
		expect(run.lines.join("\n")).toMatch(/deploy staging first/);
	});

	it("masked: both connection strings and their passwords are masked before any other line, and never printed", async () =>
	{
		const { source, target } = await databases();
		const run = deps({
			[SOURCE]: source,
			[TARGET]: target,
		});
		expect(await runCopy({
			BT_SOURCE_DATABASE_URL: SOURCE,
			BT_DATABASE_URL: TARGET,
			GITHUB_ACTIONS: "true",
		}, [], run)).toBe(0);
		expect(run.lines.slice(0, 4).sort()).toEqual([`::add-mask::${SOURCE}`, `::add-mask::${TARGET}`, "::add-mask::source-pw", "::add-mask::target-pw"].sort());
		for (const line of run.lines.slice(4)) for (const secret of [SOURCE, TARGET, "source-pw", "target-pw"]) expect(line).not.toContain(secret);
		expect(run.lines.length).toBeGreaterThan(4);
	});
});
