/**
 * Build `BACKLOG.md` from the notes under docs/v3/backlog/ (docs/v3/VAULT-MIGRATION.md, V3).
 * Pure: path → content in, markdown + canonical notes out.
 */

import { parse as parseYaml } from "yaml";
import {
	GENERATED_LINES, parseBacklog, STATUS_TABLE_MARKER, storyIds,
} from "./parse.ts";
import { parseLedger, storiesDoneSince } from "./ledger.ts";
import type { SourceDocs } from "./source.ts";
import { sourceProblems } from "./source.ts";
import { renderNotes } from "./vault.ts";

export class VaultAssembleError extends Error
{
	constructor(message: string)
	{
		super(message);
		this.name = "VaultAssembleError";
	}
}

interface StoryNote
{
	id: string;
	title: string;
	tableTitle: string;
	priority: number;
	status: string;
	content: string;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n?---\n/;

function readStoryNote(path: string, content: string): StoryNote
{
	const fail = (why: string) => new VaultAssembleError(`${path}: ${why}`);
	const match = FRONTMATTER.exec(content);
	if (!match)
	{
		throw fail("no frontmatter");
	}
	let data: unknown;
	try
	{
		data = parseYaml(match[1] ?? "");
	}
	catch (error)
	{
		throw fail(`frontmatter is not valid YAML: ${(error as Error).message}`);
	}
	const fields = (data ?? {}) as Record<string, unknown>;

	const text = (key: string) =>
	{
		const value = fields[key];
		if (typeof value !== "string" || value === "")
		{
			throw fail(`frontmatter '${key}' must be a non-empty string`);
		}
		return value;
	};

	const id = text("id");
	const fileId = /(S\d+)\.md$/.exec(path)?.[1];
	if (id !== fileId)
	{
		throw fail(`frontmatter id '${id}' does not match the file name`);
	}
	const priority = fields.priority;
	if (typeof priority !== "number" || !Number.isInteger(priority))
	{
		throw fail("frontmatter 'priority' must be an integer");
	}
	const status = text("status");
	if (!/^[a-z]+$/.test(status))
	{
		throw fail(`frontmatter 'status' must be a lowercase word, got '${status}'`);
	}

	const body = content.slice(match[0].length).replace(/^\n+/, "").replace(/\s+$/, "");
	if (body === "")
	{
		throw fail("story body is empty");
	}
	// The build writes these from frontmatter; a copy in the body would silently disagree with it.
	const duplicate = /^(### S\d+ —|\*\*Status:\*\*).*$/m.exec(body);
	if (duplicate)
	{
		throw fail(`story body must not contain "${duplicate[0]}" — the build writes the heading and Status line from frontmatter`);
	}
	return {
		id,
		title: text("title"),
		tableTitle: text("table_title"),
		priority,
		status,
		content: body,
	};
}

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
export function headingAnchor(heading: string): string
{
	return heading.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "").replace(/ /g, "-");
}

function statusRow(story: StoryNote): string
{
	return `| ${story.priority} | [${story.id}](#${headingAnchor(`${story.id} — ${story.title}`)}) | ${story.tableTitle} | \`${story.status}\` |`;
}

function storySection(story: StoryNote): string
{
	return `### ${story.id} — ${story.title}\n\n${story.content}\n\n**Status:** \`${story.status}\``;
}

/** Review debt is due at this many `done` stories since the last review (BACKLOG rule 11; doubled from 3 by the owner, 2026-10-21; a single drift event still triggers it). */
const REVIEW_BACKSTOP = 6;

/** What the Next line needs to know about a story. */
export interface NextCandidate
{
	id: string;
	priority: number;
	status: string;
	/** Design stories named on its `**Design:**` line (rule 18). */
	design: string[];
	/** Its `**Source:**` is an open question for the owner (rule 19). */
	openSource?: boolean;
}

/**
 * `**Next (generated):**` — the story in progress, else the lowest-priority `todo` whose
 * design stories are all `done` (rule 18) and whose reason to exist is settled (rule 19),
 * naming the gated `todo` stories it skipped.
 */
export function nextStoryLine(stories: NextCandidate[]): string
{
	const byPriority = [...stories].sort((a, b) => a.priority - b.priority);
	const statusById = new Map(stories.map((s) => [s.id, s.status]));
	const designGated = (s: NextCandidate) => s.design.some((id) => statusById.get(id) !== "done");
	const gated = (s: NextCandidate) => designGated(s) || s.openSource === true;
	const doing = byPriority.filter((s) => s.status === "doing");
	const todo = byPriority.filter((s) => s.status === "todo");
	const next = todo.find((s) => !gated(s));
	const skipped = todo.filter((s) => gated(s) && (next === undefined || s.priority < next.priority));
	const skippedFor = (why: string, ids: string[]) => (ids.length > 0 ? ` Skipped, ${why}: ${ids.join(", ")}.` : "");
	const skippedNote = skippedFor("waiting on design (rule 18)", skipped.filter(designGated).map((s) => s.id))
		+ skippedFor("waiting on the owner to say why (rule 19)", skipped.filter((s) => !designGated(s)).map((s) => s.id));
	let text: string;
	if (doing.length > 0)
	{
		text = `${doing.map((s) => `**${s.priority} / ${s.id}**`).join(", ")} in progress (\`doing\`) — finish and commit before starting another story (rule 6).`;
	}
	else if (next)
	{
		text = `**${next.priority} / ${next.id}** — the lowest **Priority** \`todo\` story not waiting on a design.${skippedNote}`;
	}
	else if (skipped.length > 0)
	{
		text = `every \`todo\` story is waiting on a design or the owner.${skippedNote}`;
	}
	else
	{
		text = "no `todo` stories remain.";
	}
	return `${GENERATED_LINES.next.prefix}${text}`;
}

/**
 * `**Review debt (generated …):**` — stories completed since the newest backlog review in AUDIT.md.
 * The count is ledger.ts's {@link storiesDoneSince}, the same one `pnpm review:debt` reports.
 */
export function reviewDebtLine(audit: string): string
{
	const { review, stories: since } = storiesDoneSince(parseLedger(audit), "backlog");
	const count = `${since.length} of ${REVIEW_BACKSTOP} stories \`done\` since the last backlog review`;
	const when = review ? ` (${review.date}, verdict \`${review.verdict}\`)` : " (no review logged yet)";
	const which = since.length > 0 ? `: ${since.join(", ")}` : "";
	const verdict = since.length >= REVIEW_BACKSTOP
		? " **A review is due before the next story starts.**"
		: " A drift event makes a review due regardless of this count.";
	return `${GENERATED_LINES.reviewDebt.prefix}${count}${when}${which}.${verdict}`;
}

/** `audit` is docs/v3/AUDIT.md; required only when a frame note carries the review-debt marker. */
export function assembleBacklog(files: Map<string, string>, audit?: string): string
{
	const stories = new Map<string, StoryNote>();
	for (const [path, content] of files)
	{
		if (/^stories\/S\d+\.md$/.test(path))
		{
			const note = readStoryNote(path, content);
			stories.set(note.id, note);
		}
	}

	const frameLines = [...files.keys()]
		.filter((path) => /^frame\/\d+ .*\.md$/.test(path))
		.sort()
		.map((path) => files.get(path) ?? "")
		.join("\n")
		.split("\n");
	if (frameLines.length <= 1)
	{
		throw new VaultAssembleError("no frame notes");
	}

	const embedOrder: string[] = [];
	for (const line of frameLines)
	{
		const id = /^!\[\[(S\d+)\]\]$/.exec(line)?.[1];
		if (id === undefined)
		{
			continue;
		}
		if (!stories.has(id))
		{
			throw new VaultAssembleError(`frame embeds ${id}, which has no story note`);
		}
		if (embedOrder.includes(id))
		{
			throw new VaultAssembleError(`frame embeds ${id} more than once`);
		}
		embedOrder.push(id);
	}
	const orphans = [...stories.keys()].filter((id) => !embedOrder.includes(id));
	if (orphans.length > 0)
	{
		throw new VaultAssembleError(`story notes not embedded in any frame note: ${orphans.join(", ")}`);
	}

	const rows = embedOrder
		.map((id, order) => ({
			note: stories.get(id) as StoryNote,
			order,
		}))
		.sort((a, b) => a.note.priority - b.note.priority || a.order - b.order)
		.map(({ note }) => statusRow(note));

	return frameLines.map((line) =>
	{
		if (line === STATUS_TABLE_MARKER)
		{
			return rows.join("\n");
		}
		if (line === GENERATED_LINES.next.marker)
		{
			return nextStoryLine([...stories.values()].map((note) => ({
				...note,
				design: storyIds(/^\*\*Design:\*\*(.*)$/m.exec(note.content)?.[1]),
				openSource: /^\*\*Source:\*\* Open:/m.test(note.content),
			})));
		}
		if (line === GENERATED_LINES.reviewDebt.marker)
		{
			if (audit === undefined)
			{
				throw new VaultAssembleError("a frame note needs the review-debt line, but no AUDIT.md was provided");
			}
			return reviewDebtLine(audit);
		}
		const id = /^!\[\[(S\d+)\]\]$/.exec(line)?.[1];
		return id === undefined ? line : storySection(stories.get(id) as StoryNote);
	}).join("\n");
}

/** What `pnpm backlog:build` writes: BACKLOG.md, and every note in canonical form with derived fields refreshed. */
export interface BuiltBacklog
{
	backlog: string;
	notes: Map<string, string>;
}

/** `docs`, when given, checks every story's `**Source:**` line against FEATURES.md and INTENT.md (rule 19). */
export function buildFromNotes(files: Map<string, string>, audit?: string, docs?: SourceDocs): BuiltBacklog
{
	const backlog = assembleBacklog(files, audit);
	const parsed = parseBacklog(backlog);
	const problems = docs === undefined ? [] : sourceProblems(parsed.stories, docs);
	if (problems.length > 0)
	{
		throw new VaultAssembleError(`stories without a valid reason to exist:\n- ${problems.join("\n- ")}`);
	}
	return {
		backlog,
		notes: renderNotes(parsed),
	};
}
