/**
 * ledger.ts: the one reader of AUDIT.md's entry headings — every shape audit.sh writes, the
 * review counter (only a review resets it; owner, 2026-11-03), the debt checks' base commit,
 * and the generated audit.jsonl index.
 */
import { execFileSync } from "node:child_process";
import {
	mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, describe, expect, it,
} from "vitest";
import {
	LEDGER_MARKER, LedgerParseError, ledgerBase, parseLedger, renderLedgerIndex, reviewBlocked, storiesDoneSince,
} from "./ledger.ts";

const ledger = (...headings: string[]) => ["# Ledger", "## 2026-01-01 — preamble example, not an entry", LEDGER_MARKER, ...headings, ""].join("\n");
const completed = (...ids: string[]) => ids.map((id) => `## 2026-11-01 — ${id} completed`);

describe("parseLedger", () =>
{
	it("reads every heading shape audit.sh writes, after the marker only", () =>
	{
		const entries = parseLedger(ledger(
			"## 2026-09-08 — S1 verified (backfill, no grader)",
			"## 2026-09-08 — S11 verified (backfill)",
			"## 2026-10-01 — S5 completed",
			"## 2026-10-02 — S5 re-verified",
			"## 2026-10-03 — S5 re-verified at `74a93e0`",
			"## 2026-10-04 — S60 design match",
			"## 2026-10-05 — backlog review (`amended`)",
			"## 2026-10-06 — doc parity review (`continue`)",
			"## 2026-10-07 — backlog review answers (2026-10-05)",
			"## 2026-10-08 — doc parity review answers (2026-10-06)",
			"## 2026-10-09 — backlog review skipped",
			"## 2026-10-10 — doc parity review skipped",
		));
		expect(entries.map(({
			line, heading, ...rest
		}) => rest)).toEqual([
			{
				date: "2026-09-08",
				kind: "backfill",
				story: "S1",
			},
			{
				date: "2026-09-08",
				kind: "backfill",
				story: "S11",
			},
			{
				date: "2026-10-01",
				kind: "completed",
				story: "S5",
			},
			{
				date: "2026-10-02",
				kind: "re-verified",
				story: "S5",
			},
			{
				date: "2026-10-03",
				kind: "re-verified",
				story: "S5",
				at: "74a93e0",
			},
			{
				date: "2026-10-04",
				kind: "design-match",
				story: "S60",
			},
			{
				date: "2026-10-05",
				kind: "review",
				review: "backlog",
				verdict: "amended",
			},
			{
				date: "2026-10-06",
				kind: "review",
				review: "parity",
				verdict: "continue",
			},
			{
				date: "2026-10-07",
				kind: "answers",
				review: "backlog",
				answers: "2026-10-05",
			},
			{
				date: "2026-10-08",
				kind: "answers",
				review: "parity",
				answers: "2026-10-06",
			},
			{
				date: "2026-10-09",
				kind: "skip",
				review: "backlog",
			},
			{
				date: "2026-10-10",
				kind: "skip",
				review: "parity",
			},
		]);
		expect(entries[0]).toMatchObject({
			line: 4,
			heading: "## 2026-09-08 — S1 verified (backfill, no grader)",
		});
	});

	it("skips a review's own `## ` sub-headings, and reads a ledger without the marker from the top", () =>
	{
		expect(parseLedger(ledger("## 2026-10-05 — backlog review (`continue`)", "## Check 1 — coverage", "## Questions for the owner", "## x — note"))).toHaveLength(1);
		expect(parseLedger("## 2026-09-01 — S1 completed\n")).toHaveLength(1);
	});

	it("refuses a dated entry heading audit.sh never writes (a hand-written entry)", () =>
	{
		expect(() => parseLedger(ledger("## 2026-10-05 — backlog review (`amended`)", "## 2026-10-06 — S5 done by hand"))).toThrow(LedgerParseError);
		expect(() => parseLedger(ledger("## 2026-10-06 — S5 done by hand"))).toThrow(/line 4: "## 2026-10-06 — S5 done by hand"/);
	});

	it("reads the real docs/v3/AUDIT.md: every dated heading after the marker is an entry", () =>
	{
		const audit = readFileSync(fileURLToPath(new URL("../../docs/v3/AUDIT.md", import.meta.url)), "utf8");
		const after = audit.slice(audit.indexOf(LEDGER_MARKER));
		expect(parseLedger(audit)).toHaveLength(after.match(/^## \d{4}-\d{2}-\d{2} — /gm)?.length ?? -1);
	});
});

describe("storiesDoneSince (the review counter)", () =>
{
	it("counts each story completed since the newest review of the kind, once, in ledger order", () =>
	{
		const entries = parseLedger(ledger(...completed("S1"), "## 2026-11-02 — backlog review (`continue`)", ...completed("S2", "S3", "S2"), "## 2026-11-03 — S4 re-verified"));
		expect(storiesDoneSince(entries, "backlog")).toMatchObject({
			review: {
				date: "2026-11-02",
				verdict: "continue",
			},
			stories: ["S2", "S3"],
		});
		expect(storiesDoneSince(entries, "parity")).toEqual({
			review: undefined,
			stories: ["S1", "S2", "S3"],
		});
	});

	it("runs on through answers and skip entries: only a review resets it", () =>
	{
		const entries = parseLedger(ledger(
			"## 2026-11-02 — backlog review (`amended`)",
			...completed("S1", "S2"),
			"## 2026-11-03 — backlog review answers (2026-11-02)",
			...completed("S3"),
			"## 2026-11-03 — backlog review skipped",
			...completed("S4"),
		));
		expect(storiesDoneSince(entries, "backlog").stories).toEqual(["S1", "S2", "S3", "S4"]);
	});

	it("leaves a count already at the backstop as it is when the owner skips (owner, 2026-11-03)", () =>
	{
		const entries = parseLedger(ledger("## 2026-11-02 — backlog review (`amended`)", ...completed("S1", "S2", "S3", "S4", "S5", "S6"), "## 2026-11-03 — backlog review skipped"));
		expect(storiesDoneSince(entries, "backlog").stories).toHaveLength(6);
	});

	it("resets on a review of its own kind only", () =>
	{
		const entries = parseLedger(ledger("## 2026-11-02 — backlog review (`amended`)", ...completed("S1"), "## 2026-11-03 — doc parity review (`continue`)", ...completed("S2")));
		expect(storiesDoneSince(entries, "backlog").stories).toEqual(["S1", "S2"]);
		expect(storiesDoneSince(entries, "parity").stories).toEqual(["S2"]);
	});
});

describe("reviewBlocked (the review gate waits for the owner)", () =>
{
	const blocked = "## 2026-11-02 — backlog review (`blocked`)";

	it("is blocked while the kind's newest review or answers entry is a blocked review", () =>
	{
		expect(reviewBlocked(parseLedger(ledger(blocked, ...completed("S1"))), "backlog")).toBe(true);
		expect(reviewBlocked(parseLedger(ledger(blocked)), "parity")).toBe(false);
		expect(reviewBlocked(parseLedger(ledger("## 2026-11-02 — backlog review (`continue`)")), "backlog")).toBe(false);
	});

	it("is unblocked by the owner's answers, but not by a skip, which answers nothing", () =>
	{
		expect(reviewBlocked(parseLedger(ledger(blocked, "## 2026-11-03 — backlog review answers (2026-11-02)")), "backlog")).toBe(false);
		expect(reviewBlocked(parseLedger(ledger(blocked, "## 2026-11-03 — backlog review skipped")), "backlog")).toBe(true);
	});
});

describe("renderLedgerIndex (docs/v3/audit.jsonl)", () =>
{
	it("writes one JSON object per entry, oldest first, leaving out fields an entry lacks", () =>
	{
		const index = renderLedgerIndex(parseLedger(ledger("## 2026-11-02 — backlog review (`amended`)", ...completed("S1"))));
		expect(index.endsWith("\n")).toBe(true);
		expect(index.trim().split("\n").map((l) => JSON.parse(l) as unknown)).toEqual([
			{
				line: 4,
				date: "2026-11-02",
				kind: "review",
				review: "backlog",
				verdict: "amended",
				heading: "## 2026-11-02 — backlog review (`amended`)",
			},
			{
				line: 5,
				date: "2026-11-01",
				kind: "completed",
				story: "S1",
				heading: "## 2026-11-01 — S1 completed",
			},
		]);
		expect(renderLedgerIndex([])).toBe("");
	});
});

describe("ledgerBase (where the debt checks measure drift from)", () =>
{
	let repo = "";
	const git = (...args: string[]) => execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
	});
	/** Commit `headings` as the whole ledger; returns the commit's short sha. */
	const commit = (message: string, ...headings: string[]) =>
	{
		writeFileSync(join(repo, "AUDIT.md"), ledger(...headings));
		git("add", "AUDIT.md");
		git("commit", "-qm", message);
		return git("rev-parse", "--short", "HEAD").trim();
	};

	afterEach(() => rmSync(repo, {
		recursive: true,
		force: true,
	}));

	it("is the newest commit that added a review, answers or skip entry of the kind; completions and corrections don't move it", () =>
	{
		repo = mkdtempSync(join(tmpdir(), "ledger-base-"));
		git("init", "-q");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		git("config", "core.hooksPath", "/dev/null");

		expect(ledgerBase(repo, "AUDIT.md", "backlog")).toBeUndefined();

		const review = "## 2026-11-02 — backlog review (`amended`)";
		const parity = "## 2026-11-02 — doc parity review (`continue`)";
		const reviewed = commit("review", review, parity);
		commit("S1 done", review, parity, ...completed("S1"));
		expect(ledgerBase(repo, "AUDIT.md", "backlog")).toBe(reviewed);

		const answers = "## 2026-11-03 — backlog review answers (2026-11-02)";
		const answered = commit("answers", review, parity, ...completed("S1"), answers);
		writeFileSync(join(repo, "AUDIT.md"), `${ledger(review, parity, ...completed("S1"), answers)}A correction to the answer's text.\n`);
		git("commit", "-qam", "correction");
		expect(ledgerBase(repo, "AUDIT.md", "backlog")).toBe(answered);

		const skipped = commit("skip", review, parity, ...completed("S1"), answers, "## 2026-11-03 — backlog review skipped");
		expect(ledgerBase(repo, "AUDIT.md", "backlog")).toBe(skipped);
		expect(ledgerBase(repo, "AUDIT.md", "parity")).toBe(reviewed);
		expect(ledgerBase(repo, "missing.md", "backlog")).toBeUndefined();
	});
});
