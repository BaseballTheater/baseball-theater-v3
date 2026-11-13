/**
 * `pnpm deploy:cleanup-previews` (issue #42): the weekly (and by-hand) sweep that
 * `.github/workflows/preview-cleanup.yml` runs. `cleanupPreviews` (`src/deploy/bootstrap.ts`) finds
 * every preview branch and Hyperdrive config, asks GitHub for each pull request's state through
 * this script, and deletes the preview only when the pull request is closed. It reads
 * `GITHUB_REPOSITORY` and `GH_TOKEN` (the workflow's token, read-only on pull requests) besides the
 * deploy APIs. A pull request it couldn't check or tear down is listed and the run exits 1 once the
 * rest are done. Agents never run it (CLAUDE.md).
 */
import { cleanupPreviews } from "../deploy/bootstrap.js";
import { deployApis, required } from "./deploy-apis.js";

const SCRIPT = "deploy:cleanup-previews";
const repository = required(SCRIPT, "GITHUB_REPOSITORY");
const token = required(SCRIPT, "GH_TOKEN");

/** The pull request's state from GitHub's REST API; anything but a 200 with a state throws. */
async function stateOf(pullRequest: number): Promise<string>
{
	const response = await fetch(`https://api.github.com/repos/${repository}/pulls/${pullRequest}`, {
		headers: {
			"Accept": "application/vnd.github+json",
			"Authorization": `Bearer ${token}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (!response.ok) throw new Error(`GitHub GET pulls/${pullRequest}: ${response.status}`);
	const { state } = await response.json() as { state?: unknown };
	if (typeof state !== "string") throw new Error(`GitHub GET pulls/${pullRequest}: no state`);
	return state;
}

const result = await cleanupPreviews(deployApis(SCRIPT), stateOf);
console.log(`[${SCRIPT}] deleted the previews of closed pull requests: ${result.tornDown.join(", ") || "none"}`);
console.log(`[${SCRIPT}] kept (still open): ${result.kept.join(", ") || "none"}`);
for (const { pullRequest, error } of result.failed) console.error(`[${SCRIPT}] pull request ${pullRequest}: ${error}`);
if (result.failed.length) process.exit(1);
