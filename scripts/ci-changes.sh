#!/usr/bin/env bash
# Does a push or pull request change anything besides docs? (owner, 2026-11-07, of a pull request
# that changed only Markdown and the generated ledger index: "Things like this shouldn't trigger
# CI.") CI (.github/workflows/ci.yml) and Deploy (.github/workflows/deploy.yml) both ask this one
# script, so they never disagree about what counts as docs.
#
# Usage: scripts/ci-changes.sh <base-sha> <head-sha>
# Prints `code=true|false`, and appends it to $GITHUB_OUTPUT when that is set. A missing or
# all-zero base (a new branch's first push) or a base git can't find counts as code, so the full
# gate runs whenever the diff isn't known.
#
# Docs are: any `*.md` file, anything under `docs/` (the backlog notes, the ledger and its
# generated index, design PNGs and captures) and anything under `.claude/` (skills, agent
# settings). Everything else — code, scripts and graders, workflows, package manifests,
# fixtures — is code.
set -euo pipefail

base="${1:-}"
head="${2:-HEAD}"

emit()
{
	echo "code=$1"
	if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
		echo "code=$1" >>"$GITHUB_OUTPUT"
	fi
}

if [[ -z "$base" || "$base" =~ ^0+$ ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
	emit true
	exit 0
fi

# Three dots: what the head adds since it left the base (a pull request's own changes). Paths
# unquoted, so a note named with an em dash still matches `docs/*`.
changed="$(git -c core.quotePath=false diff --name-only "$base...$head")"

code=false
while IFS= read -r file; do
	case "$file" in
		"" | *.md | docs/* | .claude/*) ;;
		*) code=true ;;
	esac
done <<<"$changed"

emit "$code"
