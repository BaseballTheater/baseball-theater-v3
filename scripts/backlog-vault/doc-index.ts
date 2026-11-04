/**
 * docs/v3/INDEX.md: where an agent starts reading the project docs.
 *
 * Owner, 2026-11-04, on cutting token sinks: "In general, a cascading linked docs approach
 * would be good whenever it is mostly lossless contextually". The big docs stay whole
 * (BACKLOG.md ~1 MB, AUDIT.md ~1 MB, ARCHITECTURE.md ~140 KB), because graders, the backlog
 * tool and people read them as they are. This index sits on top: every doc with its size,
 * the sections of the large ones with their line ranges (so a reader opens only the part it
 * needs), the backlog rules by number, and the stories by status with a link to each note.
 * It points at the text rather than summarising it, so nothing is lost by starting here.
 *
 * Generated, never hand-edited: `pnpm backlog:build` writes it, the pre-commit step rebuilds
 * it from the staged docs, and `pnpm backlog:check` fails when it is stale (cli.ts,
 * precommit.ts), as for BACKLOG.md and audit.jsonl.
 */

import type { Story } from "./parse.ts";
import { parseBacklog } from "./parse.ts";

/** A doc the index lists: its path relative to docs/v3/ and its text. */
export interface IndexedDoc
{
	path: string;
	text: string;
}

/** A heading's span: 1-based first line, last line, level (number of `#`) and title. */
export interface Section
{
	level: number;
	title: string;
	start: number;
	end: number;
}

/** Docs at least this large get their sections listed; a smaller one is cheap enough to read whole. */
const SECTION_BYTES = 8_000;

/** Lines inside fenced code blocks, which can hold `#` lines that are not headings. */
function fencedLines(lines: string[]): Set<number>
{
	const fenced = new Set<number>();
	let open = false;
	lines.forEach((line, i) =>
	{
		if (/^\s*(```|~~~)/.test(line))
		{
			open = !open;
			fenced.add(i);
		}
		else if (open)
		{
			fenced.add(i);
		}
	});
	return fenced;
}

/**
 * The `#`–`###` headings of `text` with the line range each covers: up to the line before the
 * next heading at its level or above, or the end of the text. A level-1 title is left out
 * (it covers the whole doc).
 */
export function sections(text: string, maxLevel = 3): Section[]
{
	const lines = text.split("\n");
	const fenced = fencedLines(lines);
	const found: Omit<Section, "end">[] = [];
	lines.forEach((line, i) =>
	{
		const m = /^(#{2,6}) +(.+?)\s*$/.exec(line);
		if (m && !fenced.has(i) && m[1]!.length <= maxLevel)
		{
			found.push({
				level: m[1]!.length,
				title: m[2]!,
				start: i + 1,
			});
		}
	});
	const last = lines.at(-1) === "" ? lines.length - 1 : lines.length;
	return found.map((s, i) =>
	{
		const next = found.slice(i + 1).find((n) => n.level <= s.level);
		return {
			...s,
			end: next ? next.start - 1 : last,
		};
	});
}

/** Plain text for an index line: no emphasis, code ticks or link targets; the first sentence, at most 90 characters. */
function plain(text: string): string
{
	const flat = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*`]/g, "").trim();
	const sentence = /^(.+?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
	return sentence.length > 90 ? `${sentence.slice(0, 89).trimEnd()}…` : sentence;
}

/**
 * The numbered backlog rules (`17. The Current baseline moves …`) with their line ranges: the
 * numbered list in the note's opening section, before its first sub-heading. A rule runs to the
 * line before the next rule, or before the first unindented line after a blank one.
 */
export function numberedRules(text: string): Section[]
{
	const lines = text.split("\n");
	const firstSub = lines.findIndex((l, i) => i > 0 && /^#{2,6} /.test(l));
	const scope = firstSub === -1 ? lines.length : firstSub;
	const starts: { start: number;
		title: string }[] = [];
	for (let i = 0; i < scope; i++)
	{
		const m = /^(\d+)\. (.+)$/.exec(lines[i]!);
		if (m)
		{
			starts.push({
				start: i + 1,
				title: `${m[1]}. ${plain(m[2]!)}`,
			});
		}
	}
	return starts.map((r, k) =>
	{
		let end = (starts[k + 1]?.start ?? scope + 1) - 1;
		for (let j = r.start; j < end; j++)
		{
			if (lines[j - 1] === "" && /^\S/.test(lines[j]!))
			{
				end = j;
				break;
			}
		}
		while (end > r.start && lines[end - 1] === "")
		{
			end--;
		}
		return {
			level: 0,
			title: r.title,
			start: r.start,
			end,
		};
	});
}

const kb = (text: string) => `${Math.max(1, Math.round(Buffer.byteLength(text) / 1024))} KB`;

/** A Markdown link target that survives spaces and parentheses in file names. */
const target = (path: string) => (/[\s()]/.test(path) ? `<${path}>` : path);

/** The doc's `# ` title, or its file name. */
function docTitle(doc: IndexedDoc): string
{
	return /^# +(.+)$/m.exec(doc.text)?.[1]?.trim() ?? doc.path;
}

function sectionLines(list: Section[], baseLevel: number): string[]
{
	return list.map((s) => `${"  ".repeat(Math.max(0, s.level - baseLevel))}- \`${s.start}–${s.end}\` ${s.title}`);
}

/** One doc's entry: link, size, and (when large) its sections, plus the rules when asked. */
function docEntry(doc: IndexedDoc, label: string, rules = false): string[]
{
	const out = [`- [${label}](${target(doc.path)}) — ${kb(doc.text)}`];
	if (Buffer.byteLength(doc.text) < SECTION_BYTES)
	{
		return out;
	}
	const list = sections(doc.text);
	const base = Math.min(...list.map((s) => s.level));
	out.push(...sectionLines(list, base).map((l) => `  ${l}`));
	if (rules)
	{
		const numbered = numberedRules(doc.text);
		if (numbered.length > 0)
		{
			out.push("  - Rules, by number:");
			out.push(...numbered.map((r) => `    - \`${r.start}–${r.end}\` ${r.title}`));
		}
	}
	return out;
}

const OPEN = ["doing", "todo", "blocked"];

/** The stories by status: open ones with what they wait on, the rest as linked ID lists. */
function storyLines(stories: Story[]): string[]
{
	const link = (s: Story) => `[${s.id}](backlog/stories/${s.id}.md)`;
	const open = stories.filter((s) => OPEN.includes(s.status))
		.sort((a, b) => OPEN.indexOf(a.status) - OPEN.indexOf(b.status) || a.priority - b.priority);
	const out = [
		"| Priority | Story | Status | Depends on | Design |",
		"|---|---|---|---|---|",
		...open.map((s) => `| ${s.priority} | ${link(s)} ${s.tableTitle.replace(/\|/g, "\\|")} | \`${s.status}\` | ${s.dependsOn.join(", ") || "—"} | ${s.design.join(", ") || "—"} |`),
		"",
	];
	for (const status of [...new Set(stories.map((s) => s.status))].filter((st) => !OPEN.includes(st)).sort())
	{
		const ids = stories.filter((s) => s.status === status).sort((a, b) => a.priority - b.priority).map(link);
		out.push(`**\`${status}\`** (${ids.length}): ${ids.join(", ")}`, "");
	}
	return out;
}

/** The whole of docs/v3/INDEX.md. `docs` are docs/v3's own Markdown files; `frame` the backlog's frame notes. */
export function renderDocIndex(input: { docs: IndexedDoc[];
	frame: IndexedDoc[];
	stories: Story[] }): string
{
	const big = new Set(["BACKLOG.md", "AUDIT.md", "INDEX.md"]);
	const docs = input.docs.filter((d) => !big.has(d.path)).sort((a, b) => a.path.localeCompare(b.path));
	return [
		"# Baseball Theater v3 — docs index",
		"",
		"<!-- Generated by `pnpm backlog:build` (scripts/backlog-vault/doc-index.ts) — do not edit. -->",
		"",
		"**Start here, then open only what you need.** Each entry links to the text itself; for a large doc, the numbers are the "
		+ "line range of each section, so read just that range (e.g. the Read tool's offset and limit) instead of the whole file. "
		+ "Nothing below summarises a doc, so starting here loses nothing.",
		"",
		"- **A story:** its note, `backlog/stories/S<N>.md` (linked below). The note holds the story's whole text — Gap, Impact, "
		+ "Source, ACs, `/goal` line — and its status, priority and dependencies in frontmatter. [BACKLOG.md](BACKLOG.md) (~"
		+ "1 MB) is generated from the notes for graders and tools; don't open it whole.",
		"- **The ledger:** [audit.jsonl](audit.jsonl), one JSON line per entry with the line it starts at in "
		+ "[AUDIT.md](AUDIT.md) (~1 MB); read only that entry.",
		"- **The backlog's rules and scheduling:** the frame notes below, by rule number or section.",
		"",
		"## Backlog frame notes",
		"",
		"Assembled, in this order and around the stories, into BACKLOG.md.",
		"",
		...input.frame.flatMap((d, i) => docEntry(d, d.path.replace(/^backlog\/frame\//, "").replace(/\.md$/, ""), i === 0)),
		"",
		"## Product and architecture docs",
		"",
		...docs.flatMap((d) => docEntry(d, `${d.path} — ${docTitle(d)}`)),
		"",
		"## Stories",
		"",
		"Open stories, in order (`doing`, then `todo`, then `blocked`; by priority within each):",
		"",
		...storyLines(input.stories),
	].join("\n").replace(/\n+$/, "\n");
}

/** Is `path` (relative to docs/v3/) one of the docs the index lists: a Markdown file directly in docs/v3/? */
export function isIndexedDoc(path: string): boolean
{
	return /^[^/]+\.md$/.test(path) && path !== "INDEX.md";
}

/** INDEX.md for a built backlog: its frame notes and stories, plus docs/v3's own docs (paths relative to docs/v3/). */
export function docIndexFor(backlog: string, notes: Map<string, string>, docs: IndexedDoc[]): string
{
	const frame = [...notes].filter(([key]) => key.startsWith("frame/")).sort(([a], [b]) => a.localeCompare(b)).map(([key, text]) => ({
		path: `backlog/${key}`,
		text,
	}));
	return renderDocIndex({
		docs: docs.filter((d) => isIndexedDoc(d.path)),
		frame,
		stories: parseBacklog(backlog).stories,
	});
}
