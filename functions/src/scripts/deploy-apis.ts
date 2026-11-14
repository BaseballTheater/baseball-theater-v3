/**
 * The Cloudflare and Neon APIs a deploy script reaches (`deploy:bootstrap`, `deploy:teardown`,
 * `deploy:cleanup-previews`), from the job's env, which the workflows map from GitHub secrets and
 * variables. One place, so every deploy script reads them the same way. Agents never run these
 * scripts (CLAUDE.md): they reach hosted Cloudflare and Neon, and only GitHub holds the keys.
 */
import type { CloudflareApi, NeonApi } from "../deploy/bootstrap.js";
import { parsePullRequest } from "../deploy/bootstrap.js";

/** `name` from the job's env; exits 2, naming it, when it is missing. */
export function required(script: string, name: string): string
{
	const value = process.env[name];
	if (!value)
	{
		console.error(`[${script}] ${name} is not set (a GitHub secret or variable the workflow maps)`);
		process.exit(2);
	}
	return value;
}

/** Cloudflare (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`) and Neon (`NEON_PROJECT_ID`, `NEON_API_KEY`). */
export function deployApis(script: string): { cloudflare: CloudflareApi;
	neon: NeonApi; }
{
	return {
		cloudflare: {
			accountId: required(script, "CLOUDFLARE_ACCOUNT_ID"),
			token: required(script, "CLOUDFLARE_API_TOKEN"),
			fetch,
		},
		neon: {
			projectId: required(script, "NEON_PROJECT_ID"),
			apiKey: required(script, "NEON_API_KEY"),
			fetch,
		},
	};
}

/** `--pr <number>` from `args`, if given; a malformed number exits 2 rather than naming the wrong preview. */
export function pullRequestFlag(script: string, args: string[]): number | undefined
{
	const flag = args.indexOf("--pr");
	if (flag < 0) return undefined;
	try
	{
		return parsePullRequest(args[flag + 1]);
	}
	catch (error)
	{
		console.error(`[${script}] ${(error as Error).message}`);
		process.exit(2);
	}
}
