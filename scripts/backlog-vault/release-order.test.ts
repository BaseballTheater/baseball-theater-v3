/**
 * `scripts/release-order.sh` refuses to deploy a release to production out of order (owner,
 * 2026-11-13: "The only way a rollback should happen is using a REAL rollback to a prior verison
 * that had been released. Otherwise, an unreleased release that is a lower version than the one
 * that is live should fail to deploy. If it still needs to be deployed, it'd need a new release.").
 * These tests run it against a throwaway git repository, and pin the production job's step that
 * calls it in `.github/workflows/deploy.yml`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";

const SCRIPT = fileURLToPath(new URL("../release-order.sh", import.meta.url));
const DEPLOY_YML = fileURLToPath(new URL("../../.github/workflows/deploy.yml", import.meta.url));

let repo = "";

function git(...args: string[]): string
{
	return execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
	}).trim();
}

/** Commits one change and returns the new commit's sha. */
function commit(name: string): string
{
	writeFileSync(join(repo, "file.txt"), `${name}\n`);
	git("add", "-A");
	git("commit", "-q", "-m", name);
	return git("rev-parse", "HEAD");
}

interface Check
{
	tag: string;
	published: string[];
	attempt?: number;
	deployedBefore?: boolean;
}

/** Runs the script the way the production job does: everything through the environment. */
function check({
	tag, published, attempt = 1, deployedBefore = false,
}: Check): { status: number | null;
	output: string }
{
	const run = spawnSync("bash", [SCRIPT], {
		cwd: repo,
		encoding: "utf8",
		env: {
			...process.env,
			TAG: tag,
			PUBLISHED_TAGS: published.join("\n"),
			RUN_ATTEMPT: String(attempt),
			DEPLOYED_BEFORE: String(deployedBefore),
			MAIN_REF: "main",
		},
	});
	return {
		status: run.status,
		output: `${run.stdout}${run.stderr}`,
	};
}

/**
 * History: v3.1.0 is live and `main` mirrors it; `stage` then has v3.2.0's commit (an older
 * draft) and v3.3.0's commit after it.
 */
beforeEach(() =>
{
	repo = mkdtempSync(join(tmpdir(), "release-order-"));
	git("init", "-q", "-b", "stage");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
	git("tag", "v3.1.0", commit("v3.1.0"));
	git("branch", "main");
	git("tag", "v3.2.0", commit("v3.2.0"));
	git("tag", "v3.3.0", commit("v3.3.0"));
	git("tag", "v3.10.0", commit("v3.10.0"));
});

afterEach(() =>
{
	rmSync(repo, {
		recursive: true,
		force: true,
	});
});

describe("scripts/release-order.sh", () =>
{
	it("passes a release higher than every other published one whose commit contains main", () =>
	{
		expect(check({
			tag: "v3.2.0",
			published: ["v3.1.0", "v3.2.0"],
		}).status).toBe(0);
	});

	it("compares versions by number, so v3.10.0 is higher than v3.3.0", () =>
	{
		git("branch", "-f", "main", "v3.3.0");
		expect(check({
			tag: "v3.10.0",
			published: ["v3.1.0", "v3.3.0", "v3.10.0"],
		}).status).toBe(0);
	});

	it("fails a newly published release lower than one already published", () =>
	{
		git("branch", "-f", "main", "v3.3.0");
		const run = check({
			tag: "v3.2.0",
			published: ["v3.1.0", "v3.3.0", "v3.2.0"],
		});
		expect(run.status).not.toBe(0);
		expect(run.output).toContain("v3.3.0");
	});

	it("fails a lower release even when main was moved back to let it fast-forward", () =>
	{
		expect(check({
			tag: "v3.2.0",
			published: ["v3.1.0", "v3.3.0", "v3.2.0"],
		}).status).not.toBe(0);
	});

	it("counts pre-releases among the published ones and ignores tags that aren't vMAJOR.MINOR.PATCH", () =>
	{
		git("branch", "-f", "main", "v3.3.0");
		expect(check({
			tag: "v3.2.0",
			published: ["v3.3.0"],
		}).status).not.toBe(0);
		expect(check({
			tag: "v3.10.0",
			published: ["v3.1.0", "v9.9.9-rc.1", "latest"],
		}).status).toBe(0);
	});

	it("fails a release whose commit doesn't contain main, the production mirror", () =>
	{
		git("switch", "-q", "--detach", "v3.1.0");
		git("tag", "v3.4.0", commit("off main"));
		git("branch", "-f", "main", "v3.3.0");
		const run = check({
			tag: "v3.4.0",
			published: ["v3.1.0", "v3.3.0", "v3.4.0"],
		});
		expect(run.status).not.toBe(0);
		expect(run.output).toContain("not an ancestor");
	});

	it("fails a tag that isn't vMAJOR.MINOR.PATCH", () =>
	{
		expect(check({
			tag: "v3.2",
			published: ["v3.1.0"],
		}).status).not.toBe(0);
	});

	it("lets a re-run of a release that deployed before through: a real rollback", () =>
	{
		git("branch", "-f", "main", "v3.3.0");
		expect(check({
			tag: "v3.2.0",
			published: ["v3.1.0", "v3.2.0", "v3.3.0"],
			attempt: 2,
			deployedBefore: true,
		}).status).toBe(0);
	});

	it("still fails a re-run of a release that never deployed, so re-running can't skip the check", () =>
	{
		git("branch", "-f", "main", "v3.3.0");
		expect(check({
			tag: "v3.2.0",
			published: ["v3.1.0", "v3.3.0", "v3.2.0"],
			attempt: 2,
			deployedBefore: false,
		}).status).not.toBe(0);
	});

	it("still fails a first attempt even if the tag somehow deployed before", () =>
	{
		git("branch", "-f", "main", "v3.3.0");
		expect(check({
			tag: "v3.2.0",
			published: ["v3.1.0", "v3.3.0", "v3.2.0"],
			attempt: 1,
			deployedBefore: true,
		}).status).not.toBe(0);
	});
});

describe("deploy.yml's production job checks the release order before anything deploys", () =>
{
	const deploy = readFileSync(DEPLOY_YML, "utf8");
	const production = deploy.slice(deploy.indexOf("\n    production:\n"), deploy.indexOf("\n    mirror-main:\n"));

	it("runs scripts/release-order.sh after checkout and before Install, with the tag through env", () =>
	{
		const step = production.indexOf("- name: Release order");
		expect(step).toBeGreaterThan(production.indexOf("- uses: actions/checkout@v4"));
		expect(step).toBeLessThan(production.indexOf("- name: Install"));
		const text = production.slice(step, production.indexOf("- uses: pnpm/action-setup@v4"));
		expect(text).toContain("TAG: ${{ github.event.release.tag_name }}");
		expect(text).toContain("RUN_ATTEMPT: ${{ github.run_attempt }}");
		expect(text).toContain("bash scripts/release-order.sh");
		// A failed gh call fails the step: bash with pipefail, and the statuses captured before grep.
		expect(text).toMatch(/^\s*shell: bash$/m);
		expect(text).toContain("set -euo pipefail");
		expect(text).not.toMatch(/--jq '\.\[\]\.state' \| grep/);
		expect(text).toContain("select(.draft | not)");
		expect(text).toContain("environment=production");
		// The tag reaches the shell only through env, never pasted into run: (script injection).
		const run = text.slice(text.indexOf("run: |"));
		expect(run).not.toContain("${{");
		expect(text).not.toMatch(/^\s*if:/m);
		expect(text).not.toContain("continue-on-error");
	});

	it("checks out the full history, so main's ancestry can be checked", () =>
	{
		const checkout = production.slice(production.indexOf("- uses: actions/checkout@v4"), production.indexOf("- name: Release order"));
		expect(checkout).toContain("fetch-depth: 0");
	});

	it("can read releases and deployments", () =>
	{
		expect(production).toMatch(/permissions:\n\s+contents: read\n\s+deployments: read\n\s+issues: read\n\s+pull-requests: read/);
	});
});
