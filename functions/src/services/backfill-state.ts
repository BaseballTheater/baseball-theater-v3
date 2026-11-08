/**
 * The backfill's resume file (S122 AC 8): each extra source's give-up streak, kept per target
 * database in a git-ignored folder (`.backfill/` at the repo root by default), so a resumed run
 * doesn't re-probe a source it gave up and a different database starts fresh. The file is
 * named by the database's host and name only — never its connection string, which carries a
 * password. Everything else a resumed run needs is in the database itself.
 */
import { randomUUID } from "node:crypto";
import {
	mkdir, readFile, rename, writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceStreak } from "@bt/domain";
import { isCalendarDate } from "@bt/domain";
import type {
	BackfillState, ExtraSource, ResumeStore,
} from "./backfill.js";
import { EXTRA_SOURCES } from "./backfill.js";

/** The default folder, git-ignored: `<repo>/.backfill/`. */
export const DEFAULT_STATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.backfill");

/** `<dir>/<host>--<database>.json`, with anything but letters, digits, dots and dashes made `_`. */
export function resumeFilePath(dir: string, target: { host: string;
	name: string; }): string
{
	const safe = (part: string) => part.replace(/[^A-Za-z0-9.-]/g, "_");
	return path.join(dir, `${safe(target.host)}--${safe(target.name)}.json`);
}

/** Why `value` isn't a {@link SourceStreak}, or undefined when it is one. */
function streakProblem(value: unknown): string | undefined
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return "not an object";
	const streak = value as Record<string, unknown>;
	if (!Number.isInteger(streak.streak) || (streak.streak as number) < 0) return "streak is not a whole number";
	for (const key of ["lastCountedDay", "givenUpAt"])
	{
		const day = streak[key];
		if (day !== undefined && (typeof day !== "string" || !isCalendarDate(day))) return `${key} is not a date`;
	}
	return undefined;
}

/**
 * Reads a saved file's text as {@link BackfillState}, throwing a message that names the file
 * and says to delete it when the text isn't one (an empty file, a half-written one, a hand
 * edit): a raw `SyntaxError` wouldn't tell the owner which file or what to do.
 */
function parseState(file: string, text: string): BackfillState
{
	const fail = (why: string): never =>
	{
		throw new Error(`${file} is not a readable backfill resume file (${why}); delete it to start the extra sources' give-up streaks fresh`);
	};
	let saved: unknown;
	try
	{
		saved = JSON.parse(text);
	}
	catch (error)
	{
		return fail(error instanceof Error ? error.message : String(error));
	}
	if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return fail("not an object");
	const sources = (saved as { sources?: unknown }).sources ?? {};
	if (typeof sources !== "object" || sources === null || Array.isArray(sources)) return fail("sources is not an object");
	const state: BackfillState = {
		sources: {},
	};
	for (const [source, streak] of Object.entries(sources))
	{
		if (!(EXTRA_SOURCES as readonly string[]).includes(source)) return fail(`unknown source ${source}`);
		const problem = streakProblem(streak);
		if (problem) return fail(`${source}: ${problem}`);
		state.sources[source as ExtraSource] = streak as SourceStreak;
	}
	return state;
}

/** The resume state for one database, in its own file under `dir`; a missing file is a fresh start. */
export function fileResumeStore(dir: string, target: { host: string;
	name: string; }): ResumeStore
{
	const file = resumeFilePath(dir, target);
	return {
		async load()
		{
			let text: string;
			try
			{
				text = await readFile(file, "utf8");
			}
			catch (error)
			{
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return {
					sources: {},
				};
				throw error;
			}
			return parseState(file, text);
		},
		async save(state)
		{
			await mkdir(dir, {
				recursive: true,
			});
			// Write then rename, so a stop mid-write never leaves half a file; the temp name is
			// unique, so two runs saving at once can't rename each other's temp file away.
			const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
			await writeFile(temp, `${JSON.stringify({
				database: target,
				...state,
			}, null, "\t")}\n`);
			await rename(temp, file);
		},
	};
}
