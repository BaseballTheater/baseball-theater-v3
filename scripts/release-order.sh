#!/usr/bin/env bash
# Refuses to deploy a release to production out of order (owner, 2026-11-13: "The only way a
# rollback should happen is using a REAL rollback to a prior verison that had been released.
# Otherwise, an unreleased release that is a lower version than the one that is live should fail to
# deploy. If it still needs to be deployed, it'd need a new release."). Run by the production job of
# .github/workflows/deploy.yml before anything installs, builds or deploys.
#
# Prepared releases wait as drafts (CLAUDE.md release rule), so more than one can exist and the
# owner could publish an older one after a newer one is live. That fails here when:
#   - the release's tag isn't vMAJOR.MINOR.PATCH;
#   - another published (non-draft, pre-releases included) vMAJOR.MINOR.PATCH release has the same
#     or a higher version, compared by number per part (v3.10.0 is higher than v3.9.0); or
#   - main, the production mirror, is not an ancestor of the tag's commit, so the release would
#     leave out something production already runs (the same ancestry test mirror-main makes).
# The one way through is a real rollback: re-running (RUN_ATTEMPT > 1) the Deploy run of a release
# that already deployed to production successfully (DEPLOYED_BEFORE=true). A re-run of a release
# that never deployed is checked like a first attempt, so re-running can't skip the check.
#
# Inputs, all through the environment so the tag is never pasted into a shell command:
#   TAG              the release's tag
#   PUBLISHED_TAGS   newline-separated tags of every published (non-draft) release
#   RUN_ATTEMPT      github.run_attempt
#   DEPLOYED_BEFORE  "true" when a production deployment of TAG has succeeded before
#   MAIN_REF         the ref holding main (default origin/main)
set -euo pipefail

TAG="${TAG:?TAG is required}"
PUBLISHED_TAGS="${PUBLISHED_TAGS:-}"
RUN_ATTEMPT="${RUN_ATTEMPT:-1}"
DEPLOYED_BEFORE="${DEPLOYED_BEFORE:-false}"
MAIN_REF="${MAIN_REF:-origin/main}"

semver='^v([0-9]+)\.([0-9]+)\.([0-9]+)$'
problems=()

# Prints -1, 0 or 1 as version $1 is lower than, equal to or higher than version $2 (both vX.Y.Z).
compare()
{
	[[ "$1" =~ $semver ]]
	local a=("${BASH_REMATCH[@]:1}")
	[[ "$2" =~ $semver ]]
	local b=("${BASH_REMATCH[@]:1}")
	for i in 0 1 2; do
		if ((10#${a[i]} < 10#${b[i]})); then echo -1; return; fi
		if ((10#${a[i]} > 10#${b[i]})); then echo 1; return; fi
	done
	echo 0
}

if [[ ! "$TAG" =~ $semver ]]; then
	problems+=("$TAG is not a vMAJOR.MINOR.PATCH tag")
else
	while IFS= read -r other; do
		[[ -n "$other" && "$other" != "$TAG" && "$other" =~ $semver ]] || continue
		if [ "$(compare "$TAG" "$other")" != 1 ]; then
			problems+=("$other is already published and $TAG is not higher than it")
		fi
	done <<<"$PUBLISHED_TAGS"
fi

released=$(git rev-parse "$TAG^{commit}")
main=$(git rev-parse "$MAIN_REF^{commit}")
if ! git merge-base --is-ancestor "$main" "$released"; then
	problems+=("main ($main) is not an ancestor of $TAG ($released), so it would leave out what production already runs")
fi

if [ "${#problems[@]}" -eq 0 ]; then
	echo "$TAG is in order: higher than every other published release, and it contains main"
	exit 0
fi

if [ "$RUN_ATTEMPT" -gt 1 ] && [ "$DEPLOYED_BEFORE" = true ]; then
	echo "$TAG deployed to production before and this is a re-run of its Deploy run: a rollback, allowed"
	printf '  (would otherwise fail: %s)\n' "${problems[@]}"
	exit 0
fi

for p in "${problems[@]}"; do
	echo "::error::$p"
done
echo "::error::$TAG is not deployed. A lower release can't go out after a higher one; if it still needs to ship, prepare a new release. A rollback is re-running the Deploy run of a release that deployed before." >&2
exit 1
