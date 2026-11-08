#!/usr/bin/env bash
# Does a change touch anything besides docs? (owner, 2026-11-07, of docs-only changes: "Things like
# this shouldn't trigger CI.") CI (.github/workflows/ci.yml) and Deploy (.github/workflows/deploy.yml)
# both ask this one script, so they never disagree about what counts as docs.
#
# Usage:
#   scripts/ci-changes.sh pr <pull request base sha> <head sha>
#     What the pull request adds since it left its base (three dots).
#   scripts/ci-changes.sh push <last checked sha> <head sha>
#     What changed since the last commit on the branch whose run of the same workflow passed (two
#     dots), not since the commit just before the push: a docs-only merge that lands right after a
#     code merge whose run hasn't passed (still running, cancelled or failed) still sees that code,
#     so it gets the full gate. The checked commit must be an ancestor of the head; a force-push or
#     rewind past it counts as code.
# Prints `code=true|false`, and appends it to $GITHUB_OUTPUT when that is set. A missing, all-zero
# or unreachable base counts as code, so the full gate runs whenever the diff isn't known.
#
# Docs are: any `*.md` file, anything under `docs/` (the backlog notes, the ledger and its
# generated index, design PNGs and captures) and anything under `.claude/` (skills, agent
# settings). Everything else — code, scripts and graders, workflows, package manifests,
# fixtures — is code.
set -euo pipefail

mode="${1:-}"
base="${2:-}"
head="${3:-HEAD}"

emit()
{
	echo "code=$1"
	if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
		echo "code=$1" >>"$GITHUB_OUTPUT"
	fi
}

case "$mode" in
	pr) range="$base...$head" ;;
	push) range="$base..$head" ;;
	*)
		echo "usage: scripts/ci-changes.sh pr|push <base sha> <head sha>" >&2
		exit 2
		;;
esac

if [[ -z "$base" || "$base" =~ ^0+$ ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
	emit true
	exit 0
fi
if [[ "$mode" == push ]] && ! git merge-base --is-ancestor "$base" "$head"; then
	emit true
	exit 0
fi

# Paths unquoted, so a note named with an em dash still matches `docs/*`; no rename detection, so a
# code file moved under docs/ or renamed to .md still lists its old path, which is code.
changed="$(git -c core.quotePath=false diff --no-renames --name-only "$range")"

code=false
while IFS= read -r file; do
	case "$file" in
		"" | *.md | docs/* | .claude/*) ;;
		*) code=true ;;
	esac
done <<<"$changed"

emit "$code"
