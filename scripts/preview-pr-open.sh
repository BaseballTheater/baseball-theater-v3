#!/usr/bin/env bash
# Is pull request <N> open right now? (issue #42). The deploy workflow's preview job asks before it
# builds anything and again just before it deploys, and the preview-teardown job asks before it
# deletes anything: a run that waited in the pull request's concurrency group may find it closed
# (or reopened) since the event that started it. Prints the state and writes `open=true` or
# `open=false` to $GITHUB_OUTPUT. It never guesses: a bad number, an unreadable answer from GitHub
# or a state other than open/closed fails the step.
#
# usage: scripts/preview-pr-open.sh <pull request number>   (needs GITHUB_REPOSITORY and gh's GH_TOKEN)
set -euo pipefail

pr="${1:-}"
if ! [[ "$pr" =~ ^[1-9][0-9]*$ ]]; then
	echo "usage: $0 <pull request number> (a positive whole number, not '$pr')" >&2
	exit 2
fi
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"

state="$(gh api "repos/$repo/pulls/$pr" --jq .state)"
case "$state" in
	open) open=true ;;
	closed) open=false ;;
	*)
		echo "GitHub answered '$state' for pull request #$pr; expected open or closed" >&2
		exit 1
		;;
esac
echo "pull request #$pr is $state"
echo "open=$open" >>"${GITHUB_OUTPUT:?GITHUB_OUTPUT is not set}"
