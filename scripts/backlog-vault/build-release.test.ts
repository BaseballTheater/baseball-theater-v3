/**
 * `scripts/build-release.sh` names the release a build belongs to (#47; owner, 2026-11-13: "Yes,
 * build it that way"): the milestone of the pull request whose merge commit is being built, so
 * staging and production print the same version line for the same code. These tests run it
 * against a fake `gh` that answers from canned JSON, one file per call, so nothing touches GitHub.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";

const SCRIPT = fileURLToPath(new URL("../build-release.sh", import.meta.url));
const SHA = "40767e905e0717628d110902c1d45d3de9625e1a";
const OTHER = "096032d6b2718c5eaa0059cc8e586ea2be0b878c";

let dir = "";

/** A fake `gh`: call N prints `answer-N.json` (or exits 1 when that file says FAIL) and logs its args. */
const FAKE_GH = `#!/usr/bin/env bash
n=$(( $(cat "$FAKE_DIR/count" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$FAKE_DIR/count"
echo "$*" >>"$FAKE_DIR/calls"
f="$FAKE_DIR/answer-$n.json"
[ -f "$f" ] || f="$FAKE_DIR/answer-last.json"
if [ "$(cat "$f")" = FAIL ]; then echo "HTTP 502" >&2; exit 1; fi
cat "$f"
`;

/** Queues the fake's answers, in call order; the last one repeats. */
function answers(...bodies: unknown[]): void
{
	bodies.forEach((body, i) =>
	{
		writeFileSync(join(dir, `answer-${i + 1}.json`), typeof body === "string" ? body : JSON.stringify(body));
	});
	const last = bodies.at(-1);
	writeFileSync(join(dir, "answer-last.json"), typeof last === "string" ? last : JSON.stringify(last));
}

function run(...args: string[]): { status: number | null;
	stdout: string;
	stderr: string;
	output: string }
{
	const out = join(dir, "github-output");
	writeFileSync(out, "");
	const result = spawnSync("bash", [SCRIPT, ...args], {
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${dir}:${process.env.PATH ?? ""}`,
			FAKE_DIR: dir,
			GITHUB_REPOSITORY: "owner/repo",
			GITHUB_OUTPUT: out,
			BT_RELEASE_DELAY: "0",
		},
	});
	return {
		status: result.status,
		stdout: result.stdout.trim(),
		stderr: result.stderr,
		output: readFileSync(out, "utf8"),
	};
}

function calls(): string[]
{
	try
	{
		return readFileSync(join(dir, "calls"), "utf8").trim().split("\n");
	}
	catch
	{
		return [];
	}
}

function pull(merge: string, milestone: string | null, base = "stage"): object
{
	return {
		number: 44,
		merge_commit_sha: merge,
		base: {
			ref: base,
		},
		milestone: milestone === null ? null : {
			title: milestone,
		},
	};
}

beforeEach(() =>
{
	dir = mkdtempSync(join(tmpdir(), "build-release-"));
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

describe("scripts/build-release.sh merged <sha>", () =>
{
	it("names the milestone of the pull request this commit merged into stage, and writes it to $GITHUB_OUTPUT", () =>
	{
		answers([pull(SHA, "v3.2.0")]);
		const r = run("merged", SHA);
		expect(r.status).toBe(0);
		expect(r.stdout).toBe("release=v3.2.0");
		expect(r.output).toBe("release=v3.2.0\n");
		expect(calls()).toEqual([`api repos/owner/repo/commits/${SHA}/pulls`]);
	});

	it("says unreleased when the merged pull request has no milestone", () =>
	{
		answers([pull(SHA, null)]);
		expect(run("merged", SHA).stdout).toBe("release=unreleased");
	});

	it("ignores a pull request that only contains the commit, or merged it into another branch", () =>
	{
		answers([pull(OTHER, "v3.1.1"), pull(SHA, "v9.9.9", "main")]);
		const r = run("merged", SHA);
		expect(r.status).toBe(0);
		expect(r.stdout).toBe("release=unreleased");
	});

	it("asks again while GitHub hasn't linked the merge to its pull request yet", () =>
	{
		answers([], [], [pull(SHA, "v3.2.0")]);
		expect(run("merged", SHA).stdout).toBe("release=v3.2.0");
		expect(calls()).toHaveLength(3);
	});

	it("says unreleased for a commit no pull request merged, after its retries", () =>
	{
		answers([]);
		expect(run("merged", SHA).stdout).toBe("release=unreleased");
		expect(calls()).toHaveLength(3);
	});

	it("keeps a milestone name with spaces and drops line breaks, so it can't add a line to $GITHUB_OUTPUT", () =>
	{
		answers([pull(SHA, "Spring cleanup 2\nevil=1")]);
		const r = run("merged", SHA);
		expect(r.stdout).toBe("release=Spring cleanup 2evil=1");
		expect(r.output.trim().split("\n")).toHaveLength(1);
	});

	it("fails when GitHub can't be read, rather than labelling the build wrong", () =>
	{
		answers("FAIL");
		const r = run("merged", SHA);
		expect(r.status).not.toBe(0);
		expect(r.output).toBe("");
	});

	it("refuses anything but a full commit sha", () =>
	{
		answers([]);
		expect(run("merged", "40767e9").status).toBe(2);
		expect(run("merged", "HEAD; rm -rf /").status).toBe(2);
		expect(calls()).toEqual([]);
	});
});

describe("scripts/build-release.sh pr <number>", () =>
{
	it("names a pull request's own milestone (a preview), read live", () =>
	{
		answers({
			milestone: {
				title: "v3.2.0",
			},
		});
		const r = run("pr", "48");
		expect(r.stdout).toBe("release=v3.2.0");
		expect(calls()).toEqual(["api repos/owner/repo/issues/48"]);
	});

	it("says unreleased for a pull request with no milestone yet", () =>
	{
		answers({
			milestone: null,
		});
		expect(run("pr", "48").stdout).toBe("release=unreleased");
		expect(calls()).toHaveLength(1);
	});

	it("fails when GitHub can't be read, in pr and require alike, rather than saying unreleased", () =>
	{
		answers("FAIL");
		for (const mode of ["pr", "require"])
		{
			const r = run(mode, "48");
			expect(r.status, mode).not.toBe(0);
			expect(r.output, mode).toBe("");
		}
	});
});

describe("scripts/build-release.sh require <number> (CI's milestone check)", () =>
{
	it("passes once the pull request has a milestone, waiting for one assigned just after it opened", () =>
	{
		answers({
			milestone: null,
		}, {
			milestone: {
				title: "v3.2.0",
				state: "open",
			},
		});
		const r = run("require", "48");
		expect(r.status).toBe(0);
		expect(r.stdout).toBe("milestone=v3.2.0");
		expect(calls()).toHaveLength(2);
	});

	it("refuses a closed milestone (a release already prepared or published), saying so", () =>
	{
		answers({
			milestone: {
				title: "v3.1.1",
				state: "closed",
			},
		});
		const r = run("require", "48");
		expect(r.status).toBe(1);
		expect(r.output).toBe("");
		expect(r.stderr).toContain("closed");
		// A milestone closes when its release is prepared, before it publishes (CLAUDE.md release rule).
		expect(r.stderr).toContain("a release already prepared or published");
	});

	it("treats a failed request as no answer yet and asks again", () =>
	{
		answers("FAIL", {
			milestone: {
				title: "v3.2.0",
				state: "open",
			},
		});
		const r = run("require", "48");
		expect(r.status).toBe(0);
		expect(r.stdout).toBe("milestone=v3.2.0");
	});

	it("fails, saying what to do, when none arrives", () =>
	{
		answers({
			milestone: null,
		});
		const r = run("require", "48");
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("milestone");
	});

	it("rejects a pull request number that isn't one", () =>
	{
		expect(run("require", "48/../../x").status).toBe(2);
		expect(calls()).toEqual([]);
	});
});

describe("scripts/build-release.sh check <number> (one live read, the rule require waits for)", () =>
{
	it("exits 0 with an open milestone, 1 with none or a closed one, 3 when GitHub can't be read — asking once", () =>
	{
		answers({
			milestone: {
				title: "v3.2.0",
				state: "open",
			},
		});
		const open = run("check", "48");
		expect(open.status).toBe(0);
		expect(open.stdout).toBe("milestone=v3.2.0");
		for (const [body, status] of [[{
			milestone: null,
		}, 1], [{
			milestone: {
				title: "v3.1.1",
				state: "closed",
			},
		}, 1], ["FAIL", 3]] as const)
		{
			rmSync(join(dir, "count"), {
				force: true,
			});
			rmSync(join(dir, "calls"), {
				force: true,
			});
			answers(body);
			const r = run("check", "48");
			expect(r.status, JSON.stringify(body)).toBe(status);
			expect(r.output).toBe("");
			expect(calls()).toEqual(["api repos/owner/repo/issues/48"]);
		}
	});
});

it("prints usage for an unknown mode", () =>
{
	expect(() => execFileSync("bash", [SCRIPT, "nope"], {
		stdio: "pipe",
	})).toThrow();
});
