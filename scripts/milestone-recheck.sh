#!/usr/bin/env bash
# Re-checks a pull request's milestone after it is added or removed (#47; owner, 2026-11-13: "Yes,
# build it that way"). CI's `milestone` job (scripts/build-release.sh require) reads the milestone
# live and waits a while for one, so it usually needs no help: this re-runs it only when its final
# verdict disagrees with the milestone the pull request has now (an open one passes; none or a
# closed one fails, by build-release.sh's one rule, `check`). It decides from that live milestone,
# not from which event fired, since a quick remove-and-add can deliver the events in either order;
# the action is only logged. GitHub re-runs the jobs that need the job with it, so `ci-passed`
# follows.
#
# Usage (needs `gh` with a token that may re-run jobs, and $GITHUB_REPOSITORY):
#   scripts/milestone-recheck.sh milestoned|demilestoned <pull request number> <head sha>
#
# A milestone job that is queued, running or not listed yet is polled until it finishes
# ($BT_RECHECK_TRIES reads, $BT_RECHECK_DELAY seconds apart: about the job's 5-minute timeout), then
# compared. Never a stale run: re-running an old run's job would join CI's concurrency group and
# cancel the run for a newer head. A job can only be re-run once its whole run has finished, so it
# waits for that, then re-runs only if the run wasn't cancelled and the pull request is still open
# with the same head. A failed GitHub read fails the script and re-runs nothing.
set -euo pipefail

action="${1:-}"
pr="${2:-}"
sha="${3:-}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"
tries="${BT_RECHECK_TRIES:-40}"
delay="${BT_RECHECK_DELAY:-10}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! "$action" =~ ^(milestoned|demilestoned)$ || ! "$pr" =~ ^[0-9]+$ || ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
	echo "usage: scripts/milestone-recheck.sh milestoned|demilestoned <pull request number> <head sha>" >&2
	exit 2
fi
echo "Pull request #$pr was $action at $sha."

runs="$(gh api "repos/$repo/actions/workflows/ci.yml/runs?event=pull_request&head_sha=$sha&per_page=1")"
run_id="$(jq -r '.workflow_runs[0].id // ""' <<<"$runs")"
if [[ -z "$run_id" ]]; then
	echo "No CI run for $sha yet; its milestone job will read the milestone itself."
	exit 0
fi

# The run's milestone job, polled until it has finished.
for ((i = 1; i <= tries; i++)); do
	jobs="$(gh api "repos/$repo/actions/runs/$run_id/jobs?per_page=100")"
	job="$(jq -c '[.jobs[] | select(.name == "milestone")][0] // {}' <<<"$jobs")"
	job_id="$(jq -r '.id // ""' <<<"$job")"
	status="$(jq -r '.status // ""' <<<"$job")"
	[[ -n "$job_id" && "$status" == completed ]] && break
	((i < tries)) && sleep "$delay"
done
if [[ -z "$job_id" || "$status" != completed ]]; then
	echo "The milestone job of CI run $run_id is ${status:-not listed} after $tries reads; leaving it."
	exit 0
fi
conclusion="$(jq -r '.conclusion // ""' <<<"$job")"
if [[ "$conclusion" != success && "$conclusion" != failure ]]; then
	echo "The milestone job of CI run $run_id was $conclusion; nothing to compare."
	exit 0
fi

# What the job should say now, from the live milestone.
verdict=0
GITHUB_OUTPUT="" "$here/build-release.sh" check "$pr" || verdict=$?
case "$verdict" in
	0) want=success ;;
	1) want=failure ;;
	*)
		echo "Couldn't read pull request #$pr's milestone; re-running nothing." >&2
		exit 1
		;;
esac
if [[ "$conclusion" == "$want" ]]; then
	echo "The milestone job of CI run $run_id already says $conclusion, as it should."
	exit 0
fi

gh run watch "$run_id" --repo "$repo" --interval 30 >/dev/null

run="$(gh api "repos/$repo/actions/runs/$run_id")"
if [[ "$(jq -r '.conclusion // ""' <<<"$run")" == cancelled ]]; then
	echo "CI run $run_id was cancelled; a newer run checks the milestone."
	exit 0
fi
pull="$(gh api "repos/$repo/pulls/$pr")"
if [[ "$(jq -r '.state' <<<"$pull")" != open || "$(jq -r '.head.sha' <<<"$pull")" != "$sha" ]]; then
	echo "Pull request #$pr closed or moved past $sha; its newer run checks the milestone."
	exit 0
fi

gh run rerun --job "$job_id" --repo "$repo"
echo "Re-ran the milestone job of CI run $run_id (it said $conclusion; it should say $want)."
