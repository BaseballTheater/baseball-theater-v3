/**
 * The build's version line, printed at the foot of the nav rail and drawer with
 * no label, in the ratified shape `v3.2.0 (40767e9)`: release, then short commit
 * (S56 A2: "v3.0.0 (c46e853)"; S58 A5; #47, owner 2026-11-13: "use parentheses").
 *
 * The release is the milestone of the pull request whose merge commit was built
 * (`scripts/build-release.sh`, run by each deploy in `.github/workflows/deploy.yml`),
 * so the same code reads the same on staging and production (owner, 2026-11-13:
 * "it's confusing if the version deployed to one doesn't match the other if they
 * are the same build"). It used to be the Actions run number, which differed per
 * deploy ("I don't want the build count + commit thing"). A deployed commit that
 * no pull request merged reads `unreleased`; any build that looked nothing up
 * (local, CI) reads `dev`; tests, which skip the injection, read `dev (unknown)`.
 *
 * One caveat: a release may target a docs-only stage commit newer than the one
 * staging serves (staging doesn't redeploy for docs), so the two sites can show
 * different commits for the same code (owner, 2026-11-13, keeping the release
 * rule: releasing only the served commit "would prevent iterating on stage while
 * waiting to push a release to prod"). And the label is fixed when the build
 * runs: if a merged pull request's milestone is changed after staging built
 * it, staging keeps the old label until its next deploy.
 */
declare const __BT_RELEASE__: string | undefined;
declare const __BT_COMMIT__: string | undefined;

/** `{release} ({7-char commit})`. */
export function versionLine(release: string, commit: string): string
{
	return `${release} (${commit.slice(0, 7)})`;
}

/** What `web/vite.config.ts` injects as `__BT_RELEASE__` / `__BT_COMMIT__`. */
export interface BuildInfo
{
	release: string;
	commit: string;
}

/**
 * The release and short commit of this build, from the environment the build
 * runs in. `BT_RELEASE` is set only by deploy jobs, from `scripts/build-release.sh`;
 * anything else is `dev`. The commit is `BT_COMMIT` (a preview's head commit,
 * since `GITHUB_SHA` there is GitHub's throwaway test merge), else `GITHUB_SHA`,
 * else whatever `gitShort` says (a local checkout), else `unknown`.
 */
export function buildInfo(env: Record<string, string | undefined>, gitShort: () => string): BuildInfo
{
	const release = env.BT_RELEASE?.trim() || "dev";
	const sha = env.BT_COMMIT || env.GITHUB_SHA;
	if (sha) return {
		release,
		commit: sha.slice(0, 7),
	};
	try
	{
		return {
			release,
			commit: gitShort(),
		};
	}
	catch
	{
		return {
			release,
			commit: "unknown",
		};
	}
}

export const VERSION_LINE = versionLine(
	typeof __BT_RELEASE__ === "string" ? __BT_RELEASE__ : "dev",
	typeof __BT_COMMIT__ === "string" ? __BT_COMMIT__ : "unknown",
);
