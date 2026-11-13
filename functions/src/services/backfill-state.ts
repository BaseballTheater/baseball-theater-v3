/**
 * The backfill's resume file (S122 AC 8): each extra source's counted stretches, kept per target
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
import type { SourceStreak, SourceStretch } from "@bt/domain";
import { GIVE_UP_AFTER_DAYS, isCalendarDate } from "@bt/domain";
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

/** Why `record[key]` isn't a calendar date (or absent, when `optional`), or undefined when it is. */
function dateProblem(record: Record<string, unknown>, key: string, optional: boolean): string | undefined
{
	const day = record[key];
	if (day === undefined && optional) return undefined;
	return typeof day === "string" && isCalendarDate(day) ? undefined : `${key} is not a date`;
}

/** Why `record[key]` isn't a whole number of days at least 0, or undefined when it is one. */
function wholeProblem(record: Record<string, unknown>, key: string): string | undefined
{
	const value = record[key];
	return Number.isInteger(value) && (value as number) >= 0 ? undefined : `${key} is not a whole number`;
}

/**
 * The shape saved before streaks were kept per stretch, `{ streak, lastCountedDay?, givenUpAt? }`,
 * as one stretch at its last counted day. The file never said which newer days it counted, so
 * the stretch is marked not all failed, with no failures at its newest end: days a resume counts
 * again just above it join it without adding to its streak (no early give-up from counting them
 * twice), the walk below carries its streak on as before, and a newer range counts a streak of
 * its own. One narrow case can still
 * give up early: a resume that recounts 14 or more days left incomplete among answered ones,
 * failing in a row on the second asking. And the file can't say which days its streak covers,
 * so a streak or `givenUpAt` the old code counted across ranges that didn't touch is taken as it
 * was: the walk below carries such a streak on, and such a give-up still holds for older days.
 * A `givenUpAt` must be what the old code wrote (its last counted day, with a streak of 14 or
 * more).
 */
function readOldStreak(record: Record<string, unknown>): SourceStreak | string
{
	const problem = wholeProblem(record, "streak") ?? dateProblem(record, "lastCountedDay", true) ?? dateProblem(record, "givenUpAt", true);
	if (problem) return problem;
	const streak = record.streak as number;
	const oldest = record.lastCountedDay as string | undefined;
	const givenUp = record.givenUpAt !== undefined;
	if (givenUp && (record.givenUpAt !== oldest || streak < GIVE_UP_AFTER_DAYS)) return "givenUpAt is not its last counted day of a full streak";
	if (!givenUp && streak >= GIVE_UP_AFTER_DAYS) return "a full streak has no givenUpAt";
	if (oldest === undefined) return {
		stretches: [],
	};
	return {
		stretches: [{
			newest: oldest,
			oldest,
			streak,
			newestStreak: 0,
			allFailed: false,
			givenUp,
		}],
	};
}

/**
 * `value` as a {@link SourceStreak}, or why it isn't one. Each stretch is rebuilt from its
 * checked fields (anything else in the file is dropped), and stretches may not overlap. The old
 * shape is read too ({@link readOldStreak}), so a resume file from an earlier run still loads.
 */
function readStreak(value: unknown): SourceStreak | string
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return "not an object";
	const record = value as Record<string, unknown>;
	if (!("stretches" in record)) return readOldStreak(record);
	if (!Array.isArray(record.stretches)) return "stretches is not a list";
	const stretches: SourceStretch[] = [];
	for (const stretch of record.stretches as unknown[])
	{
		if (typeof stretch !== "object" || stretch === null || Array.isArray(stretch)) return "a stretch is not an object";
		const fields = stretch as Record<string, unknown>;
		const problem = wholeProblem(fields, "streak") ?? wholeProblem(fields, "newestStreak") ?? dateProblem(fields, "newest", false) ?? dateProblem(fields, "oldest", false);
		if (problem) return problem;
		if (typeof fields.allFailed !== "boolean") return "allFailed is not true or false";
		if (typeof fields.givenUp !== "boolean") return "givenUp is not true or false";
		const streak = fields.streak as number;
		const newestStreak = fields.newestStreak as number;
		if (fields.allFailed && (streak === 0 || newestStreak !== streak)) return "a stretch is all failed but its streaks don't say so";
		if (!fields.givenUp && Math.max(streak, newestStreak) >= GIVE_UP_AFTER_DAYS) return "a full streak is not given up";
		if ((fields.oldest as string) > (fields.newest as string)) return "a stretch's oldest day is after its newest";
		stretches.push({
			newest: fields.newest as string,
			oldest: fields.oldest as string,
			streak,
			newestStreak,
			allFailed: fields.allFailed,
			givenUp: fields.givenUp,
		});
	}
	stretches.sort((a, b) => (a.oldest < b.oldest ? 1 : -1));
	for (let i = 1; i < stretches.length; i++)
	{
		if (stretches[i]!.newest >= stretches[i - 1]!.oldest) return "stretches overlap";
	}
	return {
		stretches,
	};
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
		const read = readStreak(streak);
		if (typeof read === "string") return fail(`${source}: ${read}`);
		state.sources[source as ExtraSource] = read;
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
