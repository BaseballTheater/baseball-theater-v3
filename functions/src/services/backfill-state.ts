/**
 * The backfill's resume file (S122 AC 8): each extra source's give-up streak, kept per target
 * database in a git-ignored folder (`.backfill/` at the repo root by default), so a resumed run
 * doesn't re-probe a source it gave up and a different database starts fresh. The file is
 * named by the database's host and name only — never its connection string, which carries a
 * password. Everything else a resumed run needs is in the database itself.
 */
import {
	mkdir, readFile, rename, writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BackfillState, ResumeStore } from "./backfill.js";

/** The default folder, git-ignored: `<repo>/.backfill/`. */
export const DEFAULT_STATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.backfill");

/** `<dir>/<host>--<database>.json`, with anything but letters, digits, dots and dashes made `_`. */
export function resumeFilePath(dir: string, target: { host: string;
	name: string; }): string
{
	const safe = (part: string) => part.replace(/[^A-Za-z0-9.-]/g, "_");
	return path.join(dir, `${safe(target.host)}--${safe(target.name)}.json`);
}

/** The resume state for one database, in its own file under `dir`; a missing file is a fresh start. */
export function fileResumeStore(dir: string, target: { host: string;
	name: string; }): ResumeStore
{
	const file = resumeFilePath(dir, target);
	return {
		async load()
		{
			try
			{
				const saved = JSON.parse(await readFile(file, "utf8")) as Partial<BackfillState>;
				return {
					sources: saved.sources ?? {},
				};
			}
			catch (error)
			{
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return {
					sources: {},
				};
				throw error;
			}
		},
		async save(state)
		{
			await mkdir(dir, {
				recursive: true,
			});
			// Write then rename, so a stop mid-write never leaves half a file.
			const temp = `${file}.tmp`;
			await writeFile(temp, `${JSON.stringify({
				database: target,
				...state,
			}, null, "\t")}\n`);
			await rename(temp, file);
		},
	};
}
