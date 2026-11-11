/**
 * Law P11 (docs/v3/LAWS.md; S62; owner, 2026-10-29: "Yes", to running all of
 * `pnpm verify` in CI): CI runs `pnpm verify`, so every law the gate holds —
 * including `pnpm dup:check` (L7) and `pnpm size` (L5) — also holds on every change to
 * code, not only where someone runs it locally. A docs-only change runs only the docs
 * checks (owner, 2026-11-07: "Things like this shouldn't trigger CI."), as
 * `scripts/ci-changes.sh` decides; nothing else may skip the gate.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";

const CI_YML = fileURLToPath(new URL("../../.github/workflows/ci.yml", import.meta.url));
const DEPLOY_YML = fileURLToPath(new URL("../../.github/workflows/deploy.yml", import.meta.url));

/** The commands of a workflow's `run:` steps, one per step (single-line runs only). */
export function runSteps(workflow: string): string[]
{
	return [...workflow.matchAll(/^\s*run:\s*(.+?)\s*$/gm)].map((m) => m[1]!);
}

describe("CI runs pnpm verify (law P11)", () =>
{
	it(".github/workflows/ci.yml has a step that runs pnpm verify", () =>
	{
		expect(runSteps(readFileSync(CI_YML, "utf8"))).toContain("pnpm verify");
	});

	it("catches a workflow that runs only parts of the gate", () =>
	{
		expect(runSteps("steps:\n  - run: pnpm lint\n  - run: pnpm build\n")).not.toContain("pnpm verify");
	});

	it("the verify job is skipped only for a docs-only change, and ci-passed requires it for code", () =>
	{
		const ci = readFileSync(CI_YML, "utf8");
		const verifyJob = ci.slice(ci.indexOf("\n    verify:\n"), ci.indexOf("\n    flows:\n"));
		expect(verifyJob).toContain("if: needs.changes.outputs.code == 'true'");
		expect([...verifyJob.matchAll(/^ {8}if:/gm)]).toHaveLength(1);
		expect(ci).toContain('test "$VERIFY $FLOWS $DESIGN $LIGHTHOUSE" = "success success success success"');
	});

	it("a pull request is compared with its base and a push with the last commit whose run passed, in CI and Deploy", () =>
	{
		for (const [file, workflow] of [[CI_YML, "ci.yml"], [DEPLOY_YML, "deploy.yml"]] as const)
		{
			const text = readFileSync(file, "utf8");
			const start = text.indexOf("\n    changes:\n");
			const changesJob = text.slice(start, text.indexOf("\n    # ", start + 1));
			expect(changesJob, file).toContain('scripts/ci-changes.sh pr "${{ github.event.pull_request.base.sha }}" "${{ github.sha }}"');
			expect(changesJob, file).toContain(`actions/workflows/${workflow}/runs?branch=\${{ github.ref_name }}&event=push&status=success&per_page=1`);
			expect(changesJob, file).toContain('scripts/ci-changes.sh push "$checked" "${{ github.sha }}"');
			expect(changesJob, file).not.toContain("github.event.before");
		}
		const deploy = readFileSync(DEPLOY_YML, "utf8");
		expect(deploy).toMatch(/= release \]; then\n\s+echo "code=true" >> "\$GITHUB_OUTPUT"/);
		const staging = deploy.slice(deploy.indexOf("\n    staging:\n"), deploy.indexOf("\n    production:\n"));
		// Staging deploys only code that verify passed; a docs-only push deploys nothing (owner,
		// 2026-11-11: "Can we avoid deploying when the only change was docs?").
		expect(staging).toContain("needs.changes.outputs.code == 'true' && needs.verify.result == 'success'");
		expect(staging).not.toContain("needs.verify.result == 'skipped'");
		// Whether to deploy is decided from the commit staging serves, never from what else is on
		// stage, so a newer run that fails can't strand an older commit that passed.
		expect(staging).toContain('echo "${{ github.sha }}" >web/dist/bt-commit.txt');
		expect(staging).toContain('git merge-base --is-ancestor "${{ github.sha }}" "$served"');
		expect(staging).not.toContain("origin/stage)");
		// An unreadable staging fails the step (no `|| true` swallowing it) after retries, and the
		// marker is read twice so a deploy still spreading to the edge is seen.
		expect(staging).toContain("curl -fsS --retry 5 --retry-all-errors --max-time 10");
		expect(staging).not.toMatch(/bt-commit\.txt[^\n]*\|\| true/);
		expect(staging).toContain("for attempt in 1 2; do");
		expect(staging).toContain("!cancelled()");
		expect(staging).not.toMatch(/always\(\)/);
	});
});
