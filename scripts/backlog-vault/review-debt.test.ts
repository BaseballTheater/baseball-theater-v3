/**
 * scripts/review-debt.sh decides whether a design intake review is due. The owner's rule that a
 * draft design never makes one due (owner, 2026-11-10: "So I would just avoid doing any design
 * reviews on draft designs.") is enforced only there, so these cases keep `pnpm verify` red if
 * its draft filter is deleted, inverted, matches too broadly, or misjudges a deleted amendment.
 * Runs the real script in a throwaway git repository.
 */
import { spawnSync } from "node:child_process";
import {
	copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import { LEDGER_MARKER } from "./ledger.ts";

const VAULT = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(VAULT, "..");
const ROOT = join(SCRIPTS, "..");
/** Each case spawns git and two `node cli.ts` runs. */
const TIMEOUT = 20_000;

const AMENDMENT = "docs/v3/visual/surface/amendments/A2.md";
const DRAFT = "# A2\n\nAmends the ratified design. **Draft, not ratified.**\n";
const RATIFIED = "# A2\n\nAmends the ratified design.\n\n## Ratification\n\nRatified by: Jake Lauer\nDate: 2026-11-10\nGo-ahead: \"Ratify it\"\n";
/** A draft whose body says "ratified by" in a sentence: still a draft. */
const DRAFT_MENTIONING = `${DRAFT}\nThe version line as ratified by A6 stays.\n`;
/** Both marks: counts as ratified, so a doubt runs the intake. */
const DOUBT = `${DRAFT}\n## Ratification\n\nRatified by: Jake Lauer\n`;

let repo: string;

function git(...args: string[]): string
{
	const run = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
		cwd: repo,
		encoding: "utf8",
	});
	if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
	return run.stdout.trim();
}

function write(path: string, text: string): void
{
	mkdirSync(dirname(join(repo, path)), {
		recursive: true,
	});
	writeFileSync(join(repo, path), text);
}

function commit(message: string): void
{
	git("add", "-A");
	git("commit", "-q", "-m", message);
}

/**
 * A repo with the script, the ledger tool it calls, and a ledger whose one backlog review is
 * logged by the first commit, which also holds `files`; that commit is the script's base.
 */
function reviewed(files: Record<string, string> = {}): void
{
	git("init", "-q", "-b", "main");
	mkdirSync(join(repo, "scripts/backlog-vault"), {
		recursive: true,
	});
	copyFileSync(join(SCRIPTS, "review-debt.sh"), join(repo, "scripts/review-debt.sh"));
	// Every module cli.ts may import; tests are left out.
	for (const name of readdirSync(VAULT).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")))
	{
		copyFileSync(join(VAULT, name), join(repo, "scripts/backlog-vault", name));
	}
	// The ledger tool imports `yaml`, resolved from the real repo's root dependencies.
	symlinkSync(join(ROOT, "node_modules"), join(repo, "node_modules"));
	write(".gitignore", "node_modules\n");
	write("package.json", "{\"type\":\"module\",\"scripts\":{\"verify\":\"x\"}}\n");
	write("docs/v3/AUDIT.md", `# Ledger\n\n${LEDGER_MARKER}\n\n## 2026-11-01 — backlog review (\`continue\`)\n`);
	for (const [path, text] of Object.entries(files)) write(path, text);
	commit("base: a backlog review");
}

function debt(): { status: number | null;
	stdout: string }
{
	const env = {
		...process.env,
	};
	delete env.BT_AUDIT_LEDGER;
	const run = spawnSync("bash", [join(repo, "scripts/review-debt.sh")], {
		cwd: repo,
		encoding: "utf8",
		env,
	});
	return {
		status: run.status,
		stdout: `${run.stdout}${run.stderr}`,
	};
}

beforeEach(() =>
{
	repo = mkdtempSync(join(tmpdir(), "review-debt-"));
});

afterEach(() =>
{
	rmSync(repo, {
		recursive: true,
		force: true,
	});
});

describe("review-debt.sh: drafts never make a design intake due", () =>
{
	it("a draft amendment added after the review: not due", () =>
	{
		reviewed();
		write(AMENDMENT, DRAFT);
		commit("draft");
		const run = debt();
		expect(run.status, run.stdout).toBe(0);
		expect(run.stdout).toContain("not due");
	}, TIMEOUT);

	it("a ratified amendment added: intake due", () =>
	{
		reviewed();
		write(AMENDMENT, RATIFIED);
		commit("ratified");
		const run = debt();
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain("design intake review is due");
		expect(run.stdout).toContain("A2.md added or changed");
	}, TIMEOUT);

	it("a draft then ratified: intake due", () =>
	{
		reviewed();
		write(AMENDMENT, DRAFT);
		commit("draft");
		write(AMENDMENT, RATIFIED);
		commit("ratify");
		const run = debt();
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain("design intake review is due");
	}, TIMEOUT);

	it("a draft that says \"ratified by\" in a sentence is still a draft: not due", () =>
	{
		reviewed();
		write(AMENDMENT, DRAFT_MENTIONING);
		commit("draft");
		const run = debt();
		expect(run.status, run.stdout).toBe(0);
	}, TIMEOUT);

	it("a draft marker with a real \"Ratified by:\" line counts as ratified: intake due", () =>
	{
		reviewed();
		write(AMENDMENT, DOUBT);
		commit("doubt");
		const run = debt();
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain("design intake review is due");
	}, TIMEOUT);

	it("a draft deleted after the review: not due", () =>
	{
		reviewed({
			[AMENDMENT]: DRAFT,
		});
		git("rm", "-q", AMENDMENT);
		commit("drop the draft");
		const run = debt();
		expect(run.status, run.stdout).toBe(0);
	}, TIMEOUT);

	it("a ratified amendment deleted after the review: intake due", () =>
	{
		reviewed({
			[AMENDMENT]: RATIFIED,
		});
		git("rm", "-q", AMENDMENT);
		commit("drop the amendment");
		const run = debt();
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain("design intake review is due");
	}, TIMEOUT);

	it("a surface's RATIFIED.md added: intake due", () =>
	{
		reviewed();
		write("docs/v3/visual/surface/RATIFIED.md", "Ratified.\n");
		commit("ratify the surface");
		const run = debt();
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain("RATIFIED.md added or changed");
	}, TIMEOUT);
});
