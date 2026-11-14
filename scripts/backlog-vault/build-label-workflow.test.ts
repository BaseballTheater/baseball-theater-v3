/**
 * How the workflows give a build its version line (#47; owner, 2026-11-13: "Yes, build it that
 * way"): every pull request into stage has a milestone (CI's `milestone` job, which `ci-passed`
 * requires), and every deploy build looks up its release with `scripts/build-release.sh`, so the
 * same code reads the same on staging and production. The run number is gone (owner: "I don't
 * want the build count + commit thing"). Production also writes `bt-commit.txt`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";

function read(path: string): string
{
	return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const CI = read("../../.github/workflows/ci.yml");
const DEPLOY = read("../../.github/workflows/deploy.yml");
const RECHECK = read("../../.github/workflows/milestone-recheck.yml");
const VITE = read("../../web/vite.config.ts");

/** A job's text: from its `    <name>:` line to the next top-level job (or a comment above one). */
function job(workflow: string, name: string): string
{
	const start = workflow.indexOf(`\n    ${name}:\n`);
	expect(start, `job ${name}`).toBeGreaterThanOrEqual(0);
	const rest = workflow.slice(start + 1);
	const end = rest.search(/\n {4}(#|[a-z-]+:\n)/);
	return end === -1 ? rest : rest.slice(0, end);
}

/** A step's text: from its `- name: <name>` to the next step. */
function step(jobText: string, name: string): string
{
	const start = jobText.indexOf(`- name: ${name}`);
	expect(start, `step ${name}`).toBeGreaterThanOrEqual(0);
	const next = jobText.indexOf("- name:", start + 1);
	const nextUses = jobText.indexOf("- uses:", start + 1);
	const ends = [next, nextUses].filter((i) => i !== -1);
	return jobText.slice(start, ends.length ? Math.min(...ends) : undefined);
}

/** A step's `run:` script (everything after its `run:` key). */
function runOf(stepText: string): string
{
	const at = stepText.search(/^\s*run:/m);
	return at === -1 ? "" : stepText.slice(at).replace(/^\s*run:\s*\|?/, "");
}

/** Every step of a workflow, from each `- name:` or `- uses:` to the next. */
function steps(workflow: string): string[]
{
	return workflow.split(/\n\s*- (?=name:|uses:)/).slice(1);
}

const RECHECK_SH = read("../milestone-recheck.sh");

describe("deploy builds name their release (#47)", () =>
{
	for (const name of ["staging", "production", "preview"])
	{
		it(`${name}: looks the release up before building and hands it to the build through env`, () =>
		{
			const j = job(DEPLOY, name);
			const lookup = step(j, "Which release is this build?");
			expect(lookup).toContain("scripts/build-release.sh");
			expect(lookup).toContain("GH_TOKEN: ${{ github.token }}");
			// Its output is read as steps.release; a failed lookup fails the job (no pipe can hide
			// the script's exit status, and pipefail is on either way).
			expect(lookup).toMatch(/^\s*id: release$/m);
			expect(lookup).toMatch(/^\s*shell: bash$/m);
			expect(runOf(lookup)).not.toContain("|");
			expect(j.indexOf("Which release is this build?")).toBeLessThan(j.indexOf("- name: Build the web app"));
			expect(step(j, "Build the web app")).toContain("BT_RELEASE: ${{ steps.release.outputs.release }}");
		});
	}

	it("staging and production look up the merge commit they build; a preview its own pull request and head commit", () =>
	{
		expect(step(job(DEPLOY, "staging"), "Which release is this build?")).toContain('scripts/build-release.sh merged "${{ github.sha }}"');
		expect(step(job(DEPLOY, "production"), "Which release is this build?")).toContain('scripts/build-release.sh merged "$(git rev-parse HEAD)"');
		const preview = job(DEPLOY, "preview");
		expect(step(preview, "Which release is this build?")).toContain("scripts/build-release.sh pr ${{ github.event.pull_request.number }}");
		expect(step(preview, "Build the web app")).toContain("BT_COMMIT: ${{ github.event.pull_request.head.sha }}");
	});

	it("production's own permissions keep the pull request read its lookup needs", () =>
	{
		const prod = job(DEPLOY, "production");
		// The job's permissions block, which the Release order step widens (PR #51): it must still
		// hold the reads the lookup needs.
		const block = /^ {8}permissions:\n((?: {12}[a-z-]+: [a-z]+\n)+)/m.exec(`${prod}\n`)?.[1] ?? "";
		expect(block.split("\n")).toEqual(expect.arrayContaining(["            contents: read", "            pull-requests: read"]));
	});

	it("production writes bt-commit.txt from the commit it built, as staging does", () =>
	{
		expect(step(job(DEPLOY, "production"), "Build the web app")).toContain("git rev-parse HEAD >web/dist/bt-commit.txt");
	});

	it("no run script pastes in a looked-up release or the release event's fields; they arrive through env", () =>
	{
		const runs = steps(DEPLOY).map(runOf);
		expect(runs.length).toBeGreaterThan(10);
		for (const script of runs)
		{
			expect(script).not.toContain("${{ steps.release.outputs");
			expect(script).not.toContain("${{ github.event.release");
		}
	});

	it("no workflow pastes a milestone name into a script, and nothing reads the run number", () =>
	{
		for (const text of [CI, DEPLOY, RECHECK])
		{
			expect(text).not.toMatch(/\$\{\{[^}]*(pull_request\.milestone|milestone\.title)/);
		}
		expect(VITE).not.toContain("GITHUB_RUN_NUMBER");
		expect(VITE).toContain("buildInfo(process.env");
	});
});

describe("every pull request into stage has a milestone (#47)", () =>
{
	it("CI's milestone job checks pull requests into stage, live", () =>
	{
		const m = job(CI, "milestone");
		expect(m).toContain("if: github.event_name == 'pull_request' && github.event.pull_request.base.ref == 'stage'");
		expect(m).toContain("scripts/build-release.sh require ${{ github.event.pull_request.number }}");
		expect(m).not.toContain("needs:");
	});

	it("ci-passed requires it on a pull request into stage and its skip everywhere else", () =>
	{
		const passed = job(CI, "ci-passed");
		expect(passed).toMatch(/needs: \[[^\]]*\bmilestone\b[^\]]*\]/);
		expect(passed).toContain("MILESTONE: ${{ needs.milestone.result }}");
		expect(passed).toContain("INTO_STAGE: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.ref == 'stage' }}");
		expect(passed).toContain('if [ "$INTO_STAGE" = true ]; then test "$MILESTONE" = success; else test "$MILESTONE" = skipped; fi');
	});

	it("adding or removing a milestone re-runs the check without a whole CI run", () =>
	{
		expect(RECHECK).toMatch(/types: \[milestoned, demilestoned\]/);
		expect(RECHECK).toContain("actions: write");
		// It reads the live pull request (head, state) and its milestone (the issues API).
		expect(RECHECK).toContain("pull-requests: read");
		expect(RECHECK).toContain("issues: read");
		expect(RECHECK_SH).toContain('"$here/build-release.sh" check');
		expect(RECHECK).toContain("scripts/milestone-recheck.sh");
		expect(RECHECK).toContain("ACTION: ${{ github.event.action }}");
		expect(RECHECK_SH).toContain('select(.name == "milestone")');
		expect(RECHECK_SH).toContain("gh run rerun --job");
		expect(CI).not.toContain("milestoned");
	});
});
