/**
 * Issue #42: the deploy scripts refuse a malformed command before they read any key, so a typo in a
 * workflow can never name the wrong preview. Run as the workflow runs them (tsx), with no keys set.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";

const FUNCTIONS = fileURLToPath(new URL("../..", import.meta.url));

function run(script: string, args: string[]): { status: number | null;
	stderr: string; }
{
	const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CLOUDFLARE|NEON|GH_TOKEN|GITHUB_)/.test(key)));
	const result = spawnSync(process.execPath, ["--import", "tsx", `src/scripts/${script}.ts`, ...args], {
		cwd: FUNCTIONS,
		env,
		encoding: "utf8",
	});
	return {
		status: result.status,
		stderr: result.stderr,
	};
}

describe("deploy:teardown's command line (issue #42)", () =>
{
	it("issue #42: refuses a malformed pull request number or an env other than preview, before reading any key", () =>
	{
		for (const args of [["preview", "--pr", "07"], ["preview", "--pr", "1e3"], ["preview"], ["staging", "--pr", "1"], ["production", "--pr", "1"]])
		{
			const { status, stderr } = run("deploy-teardown", args);
			expect(status, args.join(" ")).toBe(2);
			expect(stderr).not.toMatch(/is not set/);
		}
		// A well-formed command gets as far as the keys, and stops there.
		const { status, stderr } = run("deploy-teardown", ["preview", "--pr", "42"]);
		expect(status).toBe(2);
		expect(stderr).toMatch(/CLOUDFLARE_ACCOUNT_ID is not set/);
	}, 30_000);
});
