/**
 * `scripts/ci-changes.sh` decides whether a pull request changes anything besides docs, for
 * CI and Deploy alike (owner, 2026-11-07, of a docs-only pull request: "Things like this shouldn't
 * trigger CI."; law P11). These tests run it against a throwaway git repository.
 */
import { execFileSync } from "node:child_process";
import {
	mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";

const SCRIPT = fileURLToPath(new URL("../ci-changes.sh", import.meta.url));

let repo = "";

function git(...args: string[]): string
{
	return execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
	}).trim();
}

/** Commits the given files (path → content) and returns the new commit's sha. */
function commit(files: Record<string, string>): string
{
	for (const [path, content] of Object.entries(files))
	{
		mkdirSync(dirname(join(repo, path)), {
			recursive: true,
		});
		writeFileSync(join(repo, path), content);
	}
	git("add", "-A");
	git("commit", "-q", "-m", "change");
	return git("rev-parse", "HEAD");
}

function classify(base: string, head: string): string
{
	return execFileSync("bash", [SCRIPT, base, head], {
		cwd: repo,
		encoding: "utf8",
		env: {
			...process.env,
			GITHUB_OUTPUT: "",
		},
	}).trim();
}

beforeEach(() =>
{
	repo = mkdtempSync(join(tmpdir(), "ci-changes-"));
	git("init", "-q");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
	commit({
		"README.md": "start\n",
	});
});

afterEach(() =>
{
	rmSync(repo, {
		recursive: true,
		force: true,
	});
});

describe("scripts/ci-changes.sh", () =>
{
	it("calls Markdown, docs/ and .claude/ changes docs-only, including non-ASCII note names", () =>
	{
		const base = git("rev-parse", "HEAD");
		const head = commit({
			"CLAUDE.md": "rules\n",
			"docs/v3/audit.jsonl": "{}\n",
			"docs/v3/backlog/frame/00 Baseball Theater v3 — Checkable backlog.md": "note\n",
			"docs/v3/design-checks/S1/frame.png": "png",
			".claude/settings.json": "{}\n",
		});
		expect(classify(base, head)).toBe("code=false");
	});

	it("calls any other file code: source, scripts, workflows, manifests", () =>
	{
		for (const file of ["web/src/App.tsx", "scripts/verify-S1.sh", ".github/workflows/ci.yml", "package.json", "fixtures/game-1.json"])
		{
			const base = git("rev-parse", "HEAD");
			const head = commit({
				[file]: `${file}\n`,
				"notes.md": `${file}\n`,
			});
			expect(classify(base, head), file).toBe("code=true");
		}
	});

	it("calls a code file moved under docs/ or renamed to .md code", () =>
	{
		commit({
			"web/src/x.ts": "export const x = 1;\n",
		});
		const base = git("rev-parse", "HEAD");
		mkdirSync(join(repo, "docs"), {
			recursive: true,
		});
		git("mv", "web/src/x.ts", "docs/x.md");
		git("commit", "-q", "-m", "move");
		expect(classify(base, git("rev-parse", "HEAD"))).toBe("code=true");
	});

	it("runs the full gate when the base is missing, all zeros, or unknown", () =>
	{
		const head = git("rev-parse", "HEAD");
		expect(classify("", head)).toBe("code=true");
		expect(classify("0000000000000000000000000000000000000000", head)).toBe("code=true");
		expect(classify("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", head)).toBe("code=true");
	});

	it("looks only at what the head adds since it left the base", () =>
	{
		const base = git("rev-parse", "HEAD");
		git("switch", "-q", "-c", "side");
		const head = commit({
			"docs/a.md": "a\n",
		});
		git("switch", "-q", "-");
		commit({
			"web/src/main.ts": "code on the base side\n",
		});
		const movedBase = git("rev-parse", "HEAD");
		expect(classify(movedBase, head)).toBe("code=false");
		expect(classify(base, head)).toBe("code=false");
	});
});
