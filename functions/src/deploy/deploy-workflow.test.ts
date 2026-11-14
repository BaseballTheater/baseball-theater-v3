/**
 * What `.github/workflows/deploy.yml` and `.github/workflows/preview-cleanup.yml` must keep doing,
 * read from the files themselves (nothing here runs a workflow). One `describe` per job, through
 * {@link job}, so later deploy pins (S146's skip) join this file rather than starting another.
 *
 * Issue #42: a preview runs on its own Neon branch and Hyperdrive config, which the
 * `preview-teardown` job deletes when its pull request closes, and a closed pull request's preview
 * is never recreated by a run that was already queued. `scripts/preview-pr-open.sh` is the one
 * place both jobs ask GitHub whether the pull request is open; it runs here against a stand-in `gh`.
 */
import { execFileSync } from "node:child_process";
import {
	chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, describe, expect, it,
} from "vitest";

/** A workflow's text, or "" when the file is missing (so each pin fails on its own rather than the whole file). */
function workflow(name: string): string
{
	const url = new URL(`../../../.github/workflows/${name}`, import.meta.url);
	return existsSync(url) ? readFileSync(url, "utf8") : "";
}

const DEPLOY_YML = workflow("deploy.yml");
const CLEANUP_YML = workflow("preview-cleanup.yml");
const OPEN_SCRIPT = fileURLToPath(new URL("../../../scripts/preview-pr-open.sh", import.meta.url));

/** One job's text in a workflow: from its `    <name>:` line to the next job's (or the end). */
function job(workflow: string, name: string): string
{
	const start = workflow.indexOf(`\n    ${name}:\n`);
	if (start < 0) throw new Error(`no job ${name}`);
	const rest = workflow.slice(start + 1);
	const next = rest.slice(1).search(/\n {4}[a-z][\w-]*:\n/);
	return next < 0 ? rest : rest.slice(0, next + 1);
}

/** The Cloudflare and Neon env every job that bootstraps or tears down a preview maps, from GitHub secrets and variables. */
const API_ENV = ["CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}", "CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}", "NEON_API_KEY: ${{ secrets.NEON_API_KEY }}",
	"NEON_PROJECT_ID: ${{ vars.NEON_PROJECT_ID }}"];

/** A job's own settings: its text before `steps:`. */
function header(jobText: string): string
{
	return jobText.slice(0, jobText.indexOf("\n        steps:\n"));
}

/**
 * GitHub's token is given only to the steps that call `gh` (the open checks, the comment), never to
 * the whole job, so `pnpm install` and the deploy scripts never see it.
 */
function expectTokenOnlyOnGhSteps(list: string[], jobText: string): void
{
	expect(header(jobText)).not.toMatch(/GH_TOKEN/);
	for (const step of list)
	{
		// #47's release lookup (scripts/build-release.sh) reads the pull request's milestone from GitHub too.
		if (/preview-pr-open\.sh|gh pr comment|scripts\/build-release\.sh/.test(step)) expect(step, step).toMatch(/\n {14}env:\n {18}GH_TOKEN: \$\{\{ github\.token \}\}\n/);
		else expect(step, step).not.toMatch(/GH_TOKEN/);
	}
}

/** A job's steps, each as its own text, in order. */
function steps(jobText: string): string[]
{
	return jobText.split(/\n {12}- /).slice(1);
}

describe("deploy.yml preview job (issue #42)", () =>
{
	const preview = DEPLOY_YML && job(DEPLOY_YML, "preview");
	const list = steps(preview);

	it("issue #42: checks the pull request is still open first, and again just before deploying, tearing down and stopping if it closed", () =>
	{
		expect(list[0]).toMatch(/actions\/checkout/);
		expect(list[1]).toMatch(/id: open\n[^]*scripts\/preview-pr-open\.sh \$\{\{ github\.event\.pull_request\.number \}\}/);
		const deploy = list.findIndex((step) => step.includes("wrangler deploy"));
		const recheck = list.findIndex((step) => /id: still_open\n/.test(step));
		const reapply = list.findIndex((step) => step.includes("db:reapply-deletions"));
		expect(recheck).toBeGreaterThan(reapply);
		expect(deploy).toBe(recheck + 1);
		expect(list[deploy]).toMatch(/if: steps\.still_open\.outputs\.open == 'true'/);
		// Every step after the first check, up to the recheck, runs only while the pull request is open
		// (setup and install also run to tear down a closed one).
		for (const step of list.slice(2, recheck))
		{
			if (/deploy:teardown/.test(step)) expect(step).toMatch(/if: steps\.open\.outputs\.open == 'false'/);
			else if (!/action-setup|setup-node|name: Install/.test(step)) expect(step).toMatch(/if: steps\.open\.outputs\.open == 'true'/);
		}
		const teardowns = list.filter((step) => /pnpm run deploy:teardown preview --pr \$\{\{ github\.event\.pull_request\.number \}\}/.test(step));
		expect(teardowns).toHaveLength(2);
		expect(teardowns[1]).toMatch(/if: steps\.still_open\.outputs\.open == 'false'/);
		expect(list.at(-1)).toMatch(/if: steps\.still_open\.outputs\.open == 'true'/);
		expect(preview).not.toMatch(/\|\| true/);
		expectTokenOnlyOnGhSteps(list, preview);
		for (const line of API_ENV) expect(header(preview)).toContain(line);
	});

	it("issue #42: runs on the pull request's own database, never staging's", () =>
	{
		expect(preview).not.toMatch(/bt-staging|staging database|staging's database/);
		expect(preview).toMatch(/pnpm run deploy:bootstrap preview --pr/);
		expect(preview).toMatch(/group: deploy-preview-\$\{\{ github\.event\.pull_request\.number \}\}\n\s+cancel-in-progress: true/);
	});
});

describe("deploy.yml preview-teardown job (issue #42)", () =>
{
	const teardown = DEPLOY_YML && job(DEPLOY_YML, "preview-teardown");
	const list = steps(teardown);

	it("issue #42: does nothing if the pull request is open again, and otherwise deletes the Worker, config and branch, failing loudly", () =>
	{
		expect(list[0]).toMatch(/actions\/checkout/);
		expect(list[1]).toMatch(/id: open\n[^]*scripts\/preview-pr-open\.sh \$\{\{ github\.event\.pull_request\.number \}\}/);
		for (const step of list.slice(2)) expect(step).toMatch(/if: steps\.open\.outputs\.open == 'false'/);
		expect(teardown).toMatch(/run: pnpm run deploy:teardown preview --pr \$\{\{ github\.event\.pull_request\.number \}\}\n/);
		expect(teardown).not.toMatch(/\|\| true|wrangler delete/);
		for (const line of API_ENV) expect(header(teardown)).toContain(line);
		expectTokenOnlyOnGhSteps(list, teardown);
		// It only reads the pull request; the workflow's write permission is for the preview's comment.
		expect(header(teardown)).toMatch(/\n {8}permissions:\n {12}contents: read\n {12}pull-requests: read\n/);
		expect(teardown).toMatch(/group: deploy-preview-\$\{\{ github\.event\.pull_request\.number \}\}\n\s+cancel-in-progress: true/);
	});
});

describe("preview-cleanup.yml (issue #42)", () =>
{
	it("issue #42: runs weekly and by hand, reading pull requests and tearing down only closed ones' previews", () =>
	{
		expect(CLEANUP_YML).toMatch(/\n {4}schedule:\n {8}- cron: "[^"]+"/);
		expect(CLEANUP_YML).toMatch(/\n {4}workflow_dispatch:/);
		expect(CLEANUP_YML).toMatch(/pull-requests: read/);
		expect(CLEANUP_YML).not.toMatch(/pull-requests: write|contents: write/);
		expect(CLEANUP_YML).toMatch(/run: pnpm run deploy:cleanup-previews\n/);
		for (const name of [...API_ENV, "GH_TOKEN: ${{ github.token }}"]) expect(CLEANUP_YML).toContain(name);
	});
});

describe("scripts/preview-pr-open.sh (issue #42)", () =>
{
	let dir = "";
	afterEach(() =>
	{
		if (dir) rmSync(dir, {
			recursive: true,
			force: true,
		});
		dir = "";
	});

	/** Runs the script with a stand-in `gh` that prints `state` (or fails when `state` is undefined). */
	function run(pr: string, state: string | undefined): { status: number;
		output: string;
		args: string; }
	{
		dir = mkdtempSync(join(tmpdir(), "preview-pr-open-"));
		const gh = join(dir, "gh");
		writeFileSync(gh, state === undefined
			? `#!/usr/bin/env bash\necho "$@" > "${dir}/args"\necho "HTTP 502" >&2\nexit 1\n`
			: `#!/usr/bin/env bash\necho "$@" > "${dir}/args"\necho "${state}"\n`);
		chmodSync(gh, 0o755);
		const output = join(dir, "output");
		writeFileSync(output, "");
		let status = 0;
		try
		{
			execFileSync("bash", [OPEN_SCRIPT, pr], {
				env: {
					...process.env,
					PATH: `${dir}:${process.env.PATH}`,
					GITHUB_OUTPUT: output,
					GITHUB_REPOSITORY: "owner/repo",
				},
				stdio: "pipe",
			});
		}
		catch (error)
		{
			status = (error as { status: number }).status;
		}
		let args = "";
		try
		{
			args = readFileSync(join(dir, "args"), "utf8").trim();
		}
		catch
		{
			// gh was never called
		}
		return {
			status,
			output: readFileSync(output, "utf8"),
			args,
		};
	}

	it("issue #42: says open=true for an open pull request and open=false for a closed one, asking GitHub for that pull request", () =>
	{
		const open = run("42", "open");
		expect(open).toEqual({
			status: 0,
			output: "open=true\n",
			args: "api repos/owner/repo/pulls/42 --jq .state",
		});
		expect(run("42", "closed")).toMatchObject({
			status: 0,
			output: "open=false\n",
		});
	});

	it("issue #42: fails rather than guessing when GitHub can't be read, answers something unexpected, or the number is bad", () =>
	{
		expect(run("42", undefined)).toMatchObject({
			status: 1,
			output: "",
		});
		expect(run("42", "merged?")).toMatchObject({
			status: 1,
			output: "",
		});
		for (const bad of ["", "0", "07", "abc", "4 2"])
		{
			expect(run(bad, "open")).toMatchObject({
				status: 2,
				output: "",
				args: "",
			});
		}
	});
});
