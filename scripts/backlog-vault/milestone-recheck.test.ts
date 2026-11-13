/**
 * `scripts/milestone-recheck.sh` re-runs CI's `milestone` job when a pull request's milestone is
 * added or removed (#47; owner, 2026-11-13: "Yes, build it that way"). It decides from the live
 * milestone, not from which event fired (events can arrive out of order), and re-runs only when
 * the job's final verdict disagrees with it. It never re-runs a stale run: an old run's job would
 * land in CI's concurrency group and cancel the run for the newer head. These tests run it against
 * a fake `gh` that answers each API path from files, so nothing touches GitHub.
 */
import { spawnSync } from "node:child_process";
import {
	chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";

const SCRIPT = fileURLToPath(new URL("../milestone-recheck.sh", import.meta.url));
const SHA = "40767e905e0717628d110902c1d45d3de9625e1a";
const NEWER = "096032d6b2718c5eaa0059cc8e586ea2be0b878c";

let dir = "";

/**
 * A fake `gh`: the Nth `api <path>` call for a path prints `<path>.<N>.json` if there is one, else
 * `<path>.json` (the path with every character but letters and digits turned to `_`), and fails
 * when there is neither; `run watch` and `run rerun` only log.
 */
const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >>"$FAKE_DIR/calls"
if [ "$1" = api ]; then
	key="$(printf '%s' "$2" | tr -c 'A-Za-z0-9' '_')"
	n=$(( $(cat "$FAKE_DIR/$key.count" 2>/dev/null || echo 0) + 1 ))
	echo "$n" >"$FAKE_DIR/$key.count"
	f="$FAKE_DIR/$key.$n.json"
	[ -f "$f" ] || f="$FAKE_DIR/$key.json"
	[ -f "$f" ] || { echo "no answer for $2" >&2; exit 1; }
	cat "$f"
fi
`;

/** The fake's answer for a path; with `nth`, only for that call to it. */
function answer(path: string, body: unknown, nth?: number): void
{
	const key = path.replace(/[^A-Za-z0-9]/g, "_");
	writeFileSync(join(dir, nth === undefined ? `${key}.json` : `${key}.${nth}.json`), JSON.stringify(body));
}

const RUNS = `repos/owner/repo/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${SHA}&per_page=1`;
const JOBS = "repos/owner/repo/actions/runs/7/jobs?per_page=100";
const ISSUE = "repos/owner/repo/issues/48";

type Job = { status: string;
	conclusion: string | null };

/** CI's milestone job (listed after a decoy job with a similar name). */
function jobs(job: Job | null): object
{
	const decoy = {
		id: 1,
		name: "milestone-decoy",
		status: "completed",
		conclusion: "success",
	};
	return {
		jobs: job === null ? [decoy] : [decoy, {
			id: 2,
			name: "milestone",
			...job,
		}],
	};
}

/** CI's latest run for the head, its milestone job, and how the run ended. */
function ciRun(job: Job | null, runConclusion = "failure"): void
{
	answer(RUNS, {
		workflow_runs: [{
			id: 7,
		}],
	});
	answer(JOBS, jobs(job));
	answer("repos/owner/repo/actions/runs/7", {
		conclusion: runConclusion,
	});
}

/** The pull request as GitHub has it now: head, state and milestone. */
function live(milestone: "open" | "closed" | null, head = SHA, state = "open"): void
{
	answer("repos/owner/repo/pulls/48", {
		state,
		head: {
			sha: head,
		},
	});
	answer(ISSUE, {
		milestone: milestone === null ? null : {
			title: "v3.2.0",
			state: milestone,
		},
	});
}

function run(action: string, pr = "48", sha = SHA): { status: number | null;
	calls: string[] }
{
	const result = spawnSync("bash", [SCRIPT, action, pr, sha], {
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${dir}:${process.env.PATH ?? ""}`,
			FAKE_DIR: dir,
			GITHUB_REPOSITORY: "owner/repo",
			GITHUB_OUTPUT: "",
			BT_RECHECK_TRIES: "3",
			BT_RECHECK_DELAY: "0",
		},
	});
	let calls: string[] = [];
	try
	{
		calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n");
	}
	catch
	{
		// no gh call
	}
	return {
		status: result.status,
		calls,
	};
}

const RERUN = "run rerun --job 2 --repo owner/repo";
const WATCH = "run watch 7 --repo owner/repo --interval 30";
const FAILED: Job = {
	status: "completed",
	conclusion: "failure",
};
const PASSED: Job = {
	status: "completed",
	conclusion: "success",
};

beforeEach(() =>
{
	dir = mkdtempSync(join(tmpdir(), "milestone-recheck-"));
	writeFileSync(join(dir, "gh"), FAKE_GH);
	chmodSync(join(dir, "gh"), 0o755);
});

afterEach(() =>
{
	rmSync(dir, {
		recursive: true,
		force: true,
	});
});

describe("scripts/milestone-recheck.sh", () =>
{
	it("does nothing when CI hasn't run for the head yet: its milestone job will read the milestone itself", () =>
	{
		answer(RUNS, {
			workflow_runs: [],
		});
		const r = run("milestoned");
		expect(r.status).toBe(0);
		expect(r.calls).toHaveLength(1);
	});

	it("re-runs a failed job once the live milestone is open, whichever event fired (they can arrive out of order)", () =>
	{
		for (const action of ["milestoned", "demilestoned"])
		{
			rmSync(join(dir, "calls"), {
				force: true,
			});
			ciRun(FAILED);
			live("open");
			const r = run(action);
			expect(r.status, action).toBe(0);
			expect(r.calls.at(-1), action).toBe(RERUN);
			expect(r.calls.indexOf(WATCH), action).toBeLessThan(r.calls.indexOf(RERUN));
		}
	});

	it("re-runs a passed job once the live milestone is gone or closed, whichever event fired", () =>
	{
		for (const [action, milestone] of [["demilestoned", null], ["milestoned", null], ["milestoned", "closed"]] as const)
		{
			rmSync(join(dir, "calls"), {
				force: true,
			});
			ciRun(PASSED, "success");
			live(milestone);
			expect(run(action).calls.at(-1), `${action} ${milestone}`).toBe(RERUN);
		}
	});

	it("leaves a job alone whose verdict already matches the live milestone, without waiting for the run", () =>
	{
		for (const [job, milestone] of [[PASSED, "open"], [FAILED, null], [FAILED, "closed"]] as const)
		{
			rmSync(join(dir, "calls"), {
				force: true,
			});
			ciRun(job);
			live(milestone);
			const r = run("milestoned");
			expect(r.status).toBe(0);
			expect(r.calls.some((c) => c.startsWith("run "))).toBe(false);
		}
	});

	it("waits for a job still queued or running, then compares its verdict with the live milestone", () =>
	{
		ciRun(FAILED);
		answer(JOBS, jobs({
			status: "queued",
			conclusion: null,
		}), 1);
		answer(JOBS, jobs({
			status: "in_progress",
			conclusion: null,
		}), 2);
		live("open");
		const r = run("milestoned");
		expect(r.calls.filter((c) => c === `api ${JOBS}`)).toHaveLength(3);
		expect(r.calls.at(-1)).toBe(RERUN);
	});

	it("waits for a milestone job not listed yet (a run queued before its jobs exist)", () =>
	{
		ciRun(FAILED);
		answer(JOBS, {
			jobs: [],
		}, 1);
		live("open");
		expect(run("milestoned").calls.at(-1)).toBe(RERUN);
	});

	it("gives up quietly when the job never finishes or never appears in its tries", () =>
	{
		ciRun({
			status: "in_progress",
			conclusion: null,
		});
		live("open");
		let r = run("milestoned");
		expect(r.status).toBe(0);
		expect(r.calls.filter((c) => c === `api ${JOBS}`)).toHaveLength(3);
		expect(r.calls.some((c) => c.startsWith("run "))).toBe(false);
		rmSync(join(dir, "calls"));
		ciRun(null);
		r = run("demilestoned");
		expect(r.status).toBe(0);
		expect(r.calls.some((c) => c.startsWith("run "))).toBe(false);
	});

	it("leaves a skipped job alone (a pull request not into stage)", () =>
	{
		ciRun({
			status: "completed",
			conclusion: "skipped",
		});
		live(null);
		expect(run("demilestoned").calls.some((c) => c.startsWith("run "))).toBe(false);
	});

	it("never re-runs a stale run: the pull request moved on to a newer head while it waited", () =>
	{
		ciRun(FAILED);
		live("open", NEWER);
		const r = run("milestoned");
		expect(r.status).toBe(0);
		expect(r.calls).toContain(WATCH);
		expect(r.calls).not.toContain(RERUN);
	});

	it("never re-runs a cancelled run, or one of a pull request that closed meanwhile", () =>
	{
		ciRun(FAILED, "cancelled");
		live("open");
		expect(run("milestoned").calls).not.toContain(RERUN);
		ciRun(FAILED);
		live("open", SHA, "closed");
		expect(run("milestoned").calls).not.toContain(RERUN);
	});

	it("refuses anything but an action, a number and a full sha", () =>
	{
		expect(run("labeled").status).toBe(2);
		expect(run("milestoned", "48x").status).toBe(2);
		expect(run("milestoned", "48", "40767e9").status).toBe(2);
		expect(run("milestoned").calls).toEqual([`api ${RUNS}`]);
	});

	it("fails, re-running nothing, when the live milestone can't be read", () =>
	{
		ciRun(FAILED);
		const r = run("milestoned");
		expect(r.status).not.toBe(0);
		expect(r.calls.at(-1)).toBe(`api ${ISSUE}`);
		expect(r.calls).not.toContain(RERUN);
	});
});
