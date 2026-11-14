/**
 * `pnpm deploy:teardown preview --pr <number>` (issue #42): deletes a closed pull request's preview,
 * its Worker, its Hyperdrive config (`bt-preview-pr-<N>`) and its Neon branch (`preview-pr-<N>`),
 * through `teardownPreview` (`src/deploy/bootstrap.ts`). Run by Deploy's `preview-teardown` job, and
 * by the `preview` job when its pull request closed while it ran. Whatever is already gone is
 * skipped; any other failure exits non-zero, so the job fails. Agents never run it (CLAUDE.md).
 */
import { teardownPreview } from "../deploy/bootstrap.js";
import { deployApis, pullRequestFlag } from "./deploy-apis.js";

const SCRIPT = "deploy:teardown";
const [envArg, ...rest] = process.argv.slice(2);
const pullRequest = pullRequestFlag(SCRIPT, rest);
if (envArg !== "preview" || pullRequest === undefined)
{
	console.error(`[${SCRIPT}] usage: deploy:teardown preview --pr <number> (only a preview is ever torn down)`);
	process.exit(2);
}

const removed = await teardownPreview(deployApis(SCRIPT), pullRequest);
console.log(removed.length ? `[${SCRIPT}] deleted: ${removed.join("; ")}` : `[${SCRIPT}] pull request ${pullRequest}'s preview was already gone; nothing changed`);
