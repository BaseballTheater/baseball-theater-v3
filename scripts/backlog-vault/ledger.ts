/**
 * The verification ledger (docs/v3/AUDIT.md), read as data.
 *
 * AUDIT.md stays the human record: Markdown entries that scripts/audit.sh appends, newest
 * last. This module is the one place that reads its entry headings. Everything that needs
 * the ledger as data goes through it: the generated review-debt line in BACKLOG.md
 * (assemble.ts), the debt checks (scripts/review-debt.sh, scripts/parity-debt.sh, through
 * `cli.ts ledger-base` / `done-since`), the review gate hook (scripts/review-gate.sh,
 * through `cli.ts review-blocked`), and the generated index docs/v3/audit.jsonl (one
 * JSON object per entry, for tools and agents that want an entry's kind, story, verdict
 * or line without reading a ~1 MB Markdown file).
 *
 * Owner, 2026-11-03, on making these structures "more code friendly": "do the jsonl for
 * audit rather than splitting by month". The index is generated, never hand-edited: the
 * pre-commit hook rebuilds it from the staged AUDIT.md and `pnpm backlog:check` fails when
 * it is stale, as for BACKLOG.md.
 */

import { execFileSync } from "node:child_process";

/** The line in AUDIT.md after which every `## ` heading of the entry shapes below is an entry. */
export const LEDGER_MARKER = "<!-- entries below; newest last; appended by scripts/audit.sh -->";

/** Which review a review, answers or skip entry belongs to. */
export type ReviewKind = "backlog" | "parity";

/** What an entry records; each kind is one heading shape scripts/audit.sh writes. */
export type LedgerKind =
	| "completed" // a story finished: its grader and pnpm verify ran (`audit.sh story`)
	| "re-verified" // a shipped story's grader re-run at its shipping commit (`--reverify`)
	| "backfill" // an entry written later for a story that shipped before the ledger
	| "design-match" // an owner's design-match verdict on its own (`audit.sh design`)
	| "review" // a backlog or doc parity review pass (`audit.sh review` / `parity`)
	| "answers" // the owner's answers to a review's questions (`audit.sh answers`)
	| "skip"; // the owner declined a review for a drift event (`audit.sh skip`)

/** One ledger entry, from its heading. Optional fields are present only for the kinds that carry them. */
export interface LedgerEntry
{
	/** 1-based line of the heading in AUDIT.md. */
	line: number;
	/** The date in the heading (`YYYY-MM-DD` in every entry audit.sh writes). */
	date: string;
	kind: LedgerKind;
	/** The story an entry is about (`S75`), for completed / re-verified / backfill / design-match. */
	story?: string;
	/** The review a review / answers / skip entry belongs to. */
	review?: ReviewKind;
	/** A review's verdict (`continue`, `amended`, `blocked`). */
	verdict?: string;
	/** For answers: the date of the review answered. */
	answers?: string;
	/** For a re-verification: the shipping commit it re-ran at, when the heading names it. */
	at?: string;
	heading: string;
}

const REVIEW_NAMES: Record<string, ReviewKind> = {
	"backlog": "backlog",
	"doc parity": "parity",
};

/** Each heading shape audit.sh writes, and how it maps to an entry. Order doesn't matter: the shapes are disjoint. */
const SHAPES: { pattern: RegExp;
	entry: (m: RegExpExecArray) => Omit<LedgerEntry, "line" | "date" | "heading"> }[] = [
	{
		pattern: /^(S\d+) completed$/,
		entry: (m) => ({
			kind: "completed",
			story: m[1],
		}),
	},
	{
		pattern: /^(S\d+) re-verified(?: at `([0-9a-f]+)`)?$/,
		entry: (m) => ({
			kind: "re-verified",
			story: m[1],
			...(m[2] ? {
				at: m[2],
			} : {}),
		}),
	},
	{
		pattern: /^(S\d+) verified \(backfill(?:, no grader)?\)$/,
		entry: (m) => ({
			kind: "backfill",
			story: m[1],
		}),
	},
	{
		pattern: /^(S\d+) design match$/,
		entry: (m) => ({
			kind: "design-match",
			story: m[1],
		}),
	},
	{
		pattern: /^(backlog|doc parity) review \(`([a-z]+)`\)$/,
		entry: (m) => ({
			kind: "review",
			review: REVIEW_NAMES[m[1]!],
			verdict: m[2],
		}),
	},
	{
		pattern: /^(backlog|doc parity) review answers \((\S+)\)$/,
		entry: (m) => ({
			kind: "answers",
			review: REVIEW_NAMES[m[1]!],
			answers: m[2],
		}),
	},
	{
		pattern: /^(backlog|doc parity) review skipped$/,
		entry: (m) => ({
			kind: "skip",
			review: REVIEW_NAMES[m[1]!],
		}),
	},
];

/** Thrown when a dated heading among the entries matches no shape audit.sh writes (a hand-written entry). */
export class LedgerParseError extends Error
{
	override name = "LedgerParseError";
}

/**
 * Every entry in `audit`, in ledger order (oldest first).
 *
 * Only headings after {@link LEDGER_MARKER} count (the preamble above it describes entries;
 * a ledger without the marker, as in tests, is read from the top). An entry heading is
 * `## <date> — <shape>`; a review's own findings use `## ` sub-headings too ("## Check 1 —
 * coverage"), which are skipped because their first word is not followed by " — ".
 * A `## YYYY-MM-DD — …` heading that matches no shape throws: every entry comes from
 * audit.sh, so an unknown one is a hand-written entry or a new shape this parser must learn.
 */
export function parseLedger(audit: string): LedgerEntry[]
{
	const lines = audit.split("\n");
	const marker = lines.indexOf(LEDGER_MARKER);
	const entries: LedgerEntry[] = [];
	for (let i = marker + 1; i < lines.length; i++)
	{
		const heading = /^## (\S+) — (.+)$/.exec(lines[i]!);
		if (!heading)
		{
			continue;
		}
		const [, date, rest] = heading as unknown as [string, string, string];
		const shape = SHAPES.map(({ pattern, entry }) =>
		{
			const m = pattern.exec(rest);
			return m ? entry(m) : undefined;
		}).find((e) => e !== undefined);
		if (shape)
		{
			entries.push({
				line: i + 1,
				date,
				...shape,
				heading: lines[i]!,
			});
		}
		else if (/^\d{4}-\d{2}-\d{2}$/.test(date))
		{
			throw new LedgerParseError(`AUDIT.md line ${i + 1}: "${lines[i]}" is not an entry scripts/audit.sh writes`);
		}
	}
	return entries;
}

/** The stories completed since the newest review of a kind, and that review. */
export interface DoneSince
{
	/** The newest review entry of the kind, or undefined when none is logged. */
	review?: LedgerEntry;
	/** Story IDs with a `completed` entry after it, each once, in ledger order. */
	stories: string[];
}

/**
 * The review counter: stories `done` since the newest `kind` review.
 *
 * Only a review itself resets it. An answers entry finishes a review and a skip declines
 * one; neither reviews the stories, so neither resets the count (owner, 2026-11-03: "Skip
 * notes should not reset the counter, they should just avoid incrementing it, and if the
 * counter is already at the target, the skip should leave the counter as it is so the
 * next time triggers the review"). Re-verifications, backfills and design matches are not
 * completions.
 */
export function storiesDoneSince(entries: LedgerEntry[], kind: ReviewKind): DoneSince
{
	let review: LedgerEntry | undefined;
	let stories: string[] = [];
	for (const entry of entries)
	{
		if (entry.kind === "review" && entry.review === kind)
		{
			review = entry;
			stories = [];
		}
		else if (entry.kind === "completed" && entry.story && !stories.includes(entry.story))
		{
			stories.push(entry.story);
		}
	}
	return {
		review,
		stories,
	};
}

/**
 * Whether the `kind` review waits for the owner: its newest review or answers entry is a
 * `blocked` review (scripts/review-gate.sh then reports it and never runs it on its own).
 * An answers entry after it unblocks it; a skip does not, since declining a review for a
 * drift event doesn't answer a blocked review's questions.
 */
export function reviewBlocked(entries: LedgerEntry[], kind: ReviewKind): boolean
{
	const newest = entries.filter((e) => e.review === kind && (e.kind === "review" || e.kind === "answers")).at(-1);
	return newest?.kind === "review" && newest.verdict === "blocked";
}

/** The review, answers and skip entries of a kind, as one comparable string (line numbers left out: they move when an earlier entry is edited). */
function reviewTrail(audit: string, kind: ReviewKind): string
{
	return parseLedger(audit)
		.filter((e) => e.review === kind)
		.map((e) => e.heading)
		.join("\n");
}

/**
 * The commit the debt checks measure drift from: the newest commit that added (or removed)
 * a review, answers or skip entry of `kind` in the ledger at `ledgerPath` (repo-relative).
 * Undefined when no commit ever logged one.
 *
 * Walks the commits that touched the ledger, newest first, comparing each one's trail of
 * review entries with the commit before it, so edits to an entry's body (a correction)
 * don't move the base. Reads committed history only.
 */
export function ledgerBase(repo: string, ledgerPath: string, kind: ReviewKind): string | undefined
{
	const git = (args: string[]) => execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		stdio: ["ignore", "pipe", "ignore"],
	});
	let commits: string[];
	try
	{
		commits = git(["log", "--format=%h", "--", ledgerPath]).split("\n").filter(Boolean);
	}
	catch
	{
		return undefined;
	}
	const trailAt = (commit: string | undefined) =>
	{
		if (commit === undefined)
		{
			return "";
		}
		try
		{
			return reviewTrail(git(["show", `${commit}:${ledgerPath}`]), kind);
		}
		catch (error)
		{
			if (error instanceof LedgerParseError)
			{
				throw error;
			}
			return "";
		}
	};
	let newer = trailAt(commits[0]);
	for (let i = 0; i < commits.length; i++)
	{
		const older = trailAt(commits[i + 1]);
		if (newer !== older)
		{
			return commits[i];
		}
		newer = older;
	}
	return undefined;
}

/** docs/v3/audit.jsonl: one JSON object per entry, oldest first, keys in a fixed order. */
export function renderLedgerIndex(entries: LedgerEntry[]): string
{
	return entries.map((e) => JSON.stringify({
		line: e.line,
		date: e.date,
		kind: e.kind,
		story: e.story,
		review: e.review,
		verdict: e.verdict,
		answers: e.answers,
		at: e.at,
		heading: e.heading,
	})).join("\n") + (entries.length > 0 ? "\n" : "");
}
