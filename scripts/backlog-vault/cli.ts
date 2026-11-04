/**
 * The backlog's Obsidian notes (docs/v3/VAULT-MIGRATION.md, V3).
 *
 *   pnpm backlog:build    notes → docs/v3/BACKLOG.md; rewrite notes canonically (derived fields refreshed)
 *   pnpm backlog:check    exit 1 if build would change anything; --backlog-only compares BACKLOG.md alone
 *   pnpm backlog:import   recovery: regenerate the notes from docs/v3/BACKLOG.md
 *   cli.ts pre-commit     (the Husky hook) build from the index and re-stage; refuse hand edits of BACKLOG.md
 *   cli.ts ledger-base backlog|parity   the commit the debt checks measure drift from (ledger.ts)
 *   cli.ts done-since backlog|parity    stories completed since the newest review of that kind
 *   cli.ts review-blocked backlog|parity  prints `blocked` when that review waits for the owner, else `clear`
 *
 * build and check also cover docs/v3/audit.jsonl, the ledger's generated index (`--index <file>`),
 * and docs/v3/INDEX.md, the docs index agents start reading from (doc-index.ts; beside BACKLOG.md).
 *
 * `--dir <notes dir>` (default docs/v3/backlog), `--backlog <file>` (default docs/v3/BACKLOG.md),
 * and `--audit <file>` (default docs/v3/AUDIT.md, read for the generated review-debt line) let
 * graders and hooks work on copies. Everything is computed in
 * memory first, so a note that fails to parse changes nothing on disk.
 */

import {
	access, mkdir, readdir, readFile, rm, writeFile,
} from "node:fs/promises";
import {
	dirname, join, relative, resolve,
} from "node:path";
import { parseArgs } from "node:util";
import { buildFromNotes } from "./assemble.ts";
import type { IndexedDoc } from "./doc-index.ts";
import { docIndexFor, isIndexedDoc } from "./doc-index.ts";
import type { ReviewKind } from "./ledger.ts";
import {
	ledgerBase, parseLedger, renderLedgerIndex, reviewBlocked, storiesDoneSince,
} from "./ledger.ts";
import { parseBacklog } from "./parse.ts";
import { runPrecommit } from "./precommit.ts";
import type { SourceDocs } from "./source.ts";
import { BACKLOG_BASE, renderNotes } from "./vault.ts";

const repoRoot = resolve(import.meta.dirname, "../..");

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		dir: {
			type: "string",
			default: join(repoRoot, "docs/v3/backlog"),
		},
		backlog: {
			type: "string",
			default: join(repoRoot, "docs/v3/BACKLOG.md"),
		},
		audit: {
			type: "string",
			default: join(repoRoot, "docs/v3/AUDIT.md"),
		},
		index: {
			type: "string",
			default: join(repoRoot, "docs/v3/audit.jsonl"),
		},
		"backlog-only": {
			type: "boolean",
			default: false,
		},
		quiet: {
			type: "boolean",
			default: false,
		},
	},
});

const dir = resolve(values.dir);
const backlogPath = resolve(values.backlog);
const auditPath = resolve(values.audit);
const indexPath = resolve(values.index);

async function readAudit(): Promise<string | undefined>
{
	return readFile(auditPath, "utf8").catch(() => undefined);
}

/** FEATURES.md and INTENT.md beside the backlog, which every story's **Source:** line is checked against (rule 19). */
async function readSourceDocs(): Promise<SourceDocs>
{
	const docsDir = dirname(backlogPath);
	return {
		features: await readFile(join(docsDir, "FEATURES.md"), "utf8"),
		intent: await readFile(join(docsDir, "INTENT.md"), "utf8"),
	};
}

/** docs/v3's own Markdown docs (the directory BACKLOG.md sits in), for the docs index. */
async function readIndexedDocs(): Promise<IndexedDoc[]>
{
	const docsDir = dirname(backlogPath);
	const names = (await readdir(docsDir).catch(() => [] as string[])).filter(isIndexedDoc).sort();
	return Promise.all(names.map(async (path) => ({
		path,
		text: await readFile(join(docsDir, path), "utf8"),
	})));
}

/** Where the docs index lives: INDEX.md beside BACKLOG.md. */
const docIndexPath = () => join(dirname(backlogPath), "INDEX.md");

function log(message: string)
{
	if (!values.quiet)
	{
		console.log(`backlog: ${message}`);
	}
}

async function exists(path: string): Promise<boolean>
{
	return access(path).then(() => true, () => false);
}

/** Story and frame notes on disk, keyed like the rendered map (`stories/S1.md`). */
async function readNotes(): Promise<Map<string, string>>
{
	const files = new Map<string, string>();
	for (const sub of ["stories", "frame"])
	{
		const names = await readdir(join(dir, sub)).catch(() => [] as string[]);
		for (const name of names.sort())
		{
			if (name.endsWith(".md"))
			{
				files.set(`${sub}/${name}`, await readFile(join(dir, sub, name), "utf8"));
			}
		}
	}
	return files;
}

/** Write `wanted`, removing story/frame notes it no longer contains (a renamed frame heading, a removed story). */
async function writeNotes(current: Map<string, string>, wanted: Map<string, string>)
{
	for (const path of current.keys())
	{
		if (!wanted.has(path))
		{
			await rm(join(dir, path));
			log(`removed ${path}`);
		}
	}
	for (const [path, content] of wanted)
	{
		if (current.get(path) !== content)
		{
			await mkdir(dirname(join(dir, path)), {
				recursive: true,
			});
			await writeFile(join(dir, path), content);
		}
	}
	if (!(await exists(join(dir, "Backlog.base"))))
	{
		await writeFile(join(dir, "Backlog.base"), BACKLOG_BASE);
	}
}

async function build()
{
	const notes = await readNotes();
	const built = buildFromNotes(notes, await readAudit(), await readSourceDocs());
	await writeNotes(notes, built.notes);
	await writeFile(backlogPath, built.backlog);
	log(`built ${backlogPath} from ${built.notes.size} notes`);
	const audit = await readAudit();
	if (audit !== undefined)
	{
		await writeFile(indexPath, renderLedgerIndex(parseLedger(audit)));
		log(`built ${indexPath} from ${auditPath}`);
	}
	await writeFile(docIndexPath(), docIndexFor(built.backlog, built.notes, await readIndexedDocs()));
	log(`built ${docIndexPath()}`);
}

async function check()
{
	const notes = await readNotes();
	const built = buildFromNotes(notes, await readAudit(), await readSourceDocs());
	const stale: string[] = [];
	if ((await readFile(backlogPath, "utf8").catch(() => undefined)) !== built.backlog)
	{
		stale.push(backlogPath);
	}
	if (!values["backlog-only"])
	{
		for (const path of new Set([...notes.keys(), ...built.notes.keys()]))
		{
			if (notes.get(path) !== built.notes.get(path))
			{
				stale.push(join(dir, path));
			}
		}
	}
	const audit = await readAudit();
	if (!values["backlog-only"] && audit !== undefined
		&& (await readFile(indexPath, "utf8").catch(() => undefined)) !== renderLedgerIndex(parseLedger(audit)))
	{
		stale.push(indexPath);
	}
	if (!values["backlog-only"]
		&& (await readFile(docIndexPath(), "utf8").catch(() => undefined)) !== docIndexFor(built.backlog, built.notes, await readIndexedDocs()))
	{
		stale.push(docIndexPath());
	}
	if (stale.length > 0)
	{
		console.error(`backlog: out of date — run pnpm backlog:build. Would change:\n  ${stale.join("\n  ")}`);
		process.exitCode = 1;
		return;
	}
	log("notes and BACKLOG.md are in sync");
}

async function importBacklog()
{
	const wanted = renderNotes(parseBacklog(await readFile(backlogPath, "utf8")));
	await writeNotes(await readNotes(), wanted);
	log(`imported ${wanted.size} notes into ${dir} from ${backlogPath}`);
}

async function preCommit()
{
	const result = runPrecommit(repoRoot);
	if (!result.ok)
	{
		console.error(`pre-commit: ${result.message}`);
		process.exitCode = 1;
		return;
	}
	if (result.restaged.length > 0)
	{
		log(`rebuilt and re-staged ${result.restaged.join(", ")}`);
	}
}

/** The review kind named after a ledger command (`ledger-base backlog`). */
function reviewKind(): ReviewKind
{
	const kind = positionals[1];
	if (kind !== "backlog" && kind !== "parity")
	{
		throw new Error(`${positionals[0]} needs 'backlog' or 'parity'`);
	}
	return kind;
}

/** Prints the short sha of the commit the debt checks measure from, or nothing when no review is logged. */
async function printLedgerBase()
{
	const base = ledgerBase(repoRoot, relative(repoRoot, auditPath), reviewKind());
	if (base)
	{
		console.log(base);
	}
}

/** Prints the stories completed since the newest review of the kind, comma-separated (empty when none). */
async function printDoneSince()
{
	const audit = await readAudit();
	console.log(audit === undefined ? "" : storiesDoneSince(parseLedger(audit), reviewKind()).stories.join(", "));
}

/** Prints `blocked` when the review waits for the owner (ledger.ts reviewBlocked), else `clear`; an error prints neither. */
async function printReviewBlocked()
{
	const audit = await readAudit();
	console.log(audit !== undefined && reviewBlocked(parseLedger(audit), reviewKind()) ? "blocked" : "clear");
}

const commands: Record<string, () => Promise<void>> = {
	build,
	check,
	import: importBacklog,
	"pre-commit": preCommit,
	"ledger-base": printLedgerBase,
	"done-since": printDoneSince,
	"review-blocked": printReviewBlocked,
};

// lint-staged and hooks may append file paths; only the first positional is the command.
const command = commands[positionals[0] ?? ""];
if (!command)
{
	console.error("usage: cli.ts <build|check|import|pre-commit|ledger-base|done-since|review-blocked <kind>> [--dir <notes dir>] [--backlog <file>] [--audit <file>] [--index <file>] [--backlog-only] [--quiet]");
	process.exitCode = 2;
}
else
{
	try
	{
		await command();
	}
	catch (error)
	{
		console.error(`backlog: ${(error as Error).message}`);
		process.exitCode = 1;
	}
}
