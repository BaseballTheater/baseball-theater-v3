#!/usr/bin/env bash
# Which release does a build belong to? (#47; owner, 2026-11-13: "Yes, build it that way", after
# "it's confusing if the version deployed to one doesn't match the other if they are the same
# build" and "I don't want the build count + commit thing".) The answer is the milestone of the
# pull request whose merge commit is being built, so staging and production, which build the same
# stage merge commit, print the same version line (`web/src/layout/version.ts`). Every pull request
# into stage has one: CI's `milestone` job runs `require` below and `ci-passed` needs it.
#
# Usage (needs `gh` with a token and $GITHUB_REPOSITORY):
#   scripts/build-release.sh merged <full commit sha>
#     The milestone of the pull request that merged this commit into stage (its merge commit),
#     or `unreleased` when no pull request did (a direct push) or it has none. GitHub can take a
#     moment to link a fresh merge to its pull request, so an empty answer is asked again first.
#   scripts/build-release.sh pr <number>
#     A pull request's own milestone, or `unreleased` (a preview, built before it merges).
#   scripts/build-release.sh require <number>
#     Exits 1 unless the pull request has an open milestone: a closed one is a release already
#     prepared or published (the release rule closes it at prepare time), so the build would be
#     labelled with a release it isn't in. It is read live, not
#     from the event that started the run: the release rule assigns the milestone right after
#     opening the pull request, and a re-run replays the original event. So it asks again for a
#     while first, and a failed request counts as no answer yet until the last try.
#   scripts/build-release.sh check <number>
#     One live read under the same rule: exits 0 with an open milestone, 1 with none or a closed
#     one (the reason on stderr), 3 when GitHub can't be read. scripts/milestone-recheck.sh asks it.
# `merged` and `pr` print `release=<name>`, `require` and `check` print `milestone=<name>`, each also appended
# to $GITHUB_OUTPUT when that is set. Line breaks are dropped from the name, so it can't add a line
# to $GITHUB_OUTPUT. In `merged` and `pr` a failed GitHub request fails the script: a deploy re-runs
# rather than labelling a build wrong. $BT_RELEASE_TRIES and $BT_RELEASE_DELAY (seconds) tune the retries.
set -euo pipefail

mode="${1:-}"
arg="${2:-}"
delay="${BT_RELEASE_DELAY:-10}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"

usage()
{
	echo "usage: scripts/build-release.sh merged <full commit sha> | pr <number> | require <number> | check <number>" >&2
	exit 2
}

emit()
{
	local name
	name="$(printf '%s' "$2" | tr -d '\r\n')"
	[[ -n "$name" ]] || name=unreleased
	echo "$1=$name"
	if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
		echo "$1=$name" >>"$GITHUB_OUTPUT"
	fi
}

# A pull request's milestone title (line breaks dropped), or nothing. With `open`, a closed
# milestone prints `closed:<title>` instead.
milestone_of_pr()
{
	local issue
	issue="$(gh api "repos/$repo/issues/$1")" || return 1
	jq -r --arg want "${2:-}" '(.milestone.title // "" | gsub("[\\r\\n]"; "")) as $t
		| if $want == "open" and $t != "" and .milestone.state != "open" then "closed:" + $t else $t end' <<<"$issue"
}

# Does pull request $1 have an open milestone? 0: yes, its name in $title; 1: no, why in $why;
# 3: GitHub couldn't be read. The one rule `require` and `check` share.
open_milestone()
{
	if ! title="$(milestone_of_pr "$1" open)"; then
		why="no answer from GitHub"
		return 3
	fi
	if [[ "$title" == closed:* ]]; then
		why="the closed milestone ${title#closed:} (a release already prepared or published)"
		return 1
	fi
	if [[ -z "$title" ]]; then
		why="no milestone"
		return 1
	fi
	return 0
}

case "$mode" in
	merged)
		[[ "$arg" =~ ^[0-9a-f]{40}$ ]] || usage
		tries="${BT_RELEASE_TRIES:-3}"
		for ((i = 1; i <= tries; i++)); do
			pulls="$(gh api "repos/$repo/commits/$arg/pulls")"
			# The pull request that merged this commit into stage: "m:" + its milestone (line breaks
			# dropped), or "none" when GitHub names none (yet).
			merged_by="$(jq -r --arg sha "$arg" '[.[] | select(.merge_commit_sha == $sha and .base.ref == "stage")]
				| if length == 0 then "none" else "m:" + (.[0].milestone.title // "" | gsub("[\\r\\n]"; "")) end' <<<"$pulls")"
			if [[ "$merged_by" != none ]]; then
				emit release "${merged_by#m:}"
				exit 0
			fi
			((i < tries)) && sleep "$delay"
		done
		emit release unreleased
		;;
	pr)
		[[ "$arg" =~ ^[0-9]+$ ]] || usage
		title="$(milestone_of_pr "$arg")"
		emit release "$title"
		;;
	require)
		[[ "$arg" =~ ^[0-9]+$ ]] || usage
		tries="${BT_RELEASE_TRIES:-12}"
		for ((i = 1; i <= tries; i++)); do
			if open_milestone "$arg"; then
				emit milestone "$title"
				exit 0
			fi
			((i < tries)) && sleep "$delay"
		done
		echo "Pull request #$arg has $why. Assign it to the next release's open milestone (CLAUDE.md release rule; #47); changing it re-runs this check." >&2
		exit 1
		;;
	check)
		[[ "$arg" =~ ^[0-9]+$ ]] || usage
		verdict=0
		open_milestone "$arg" || verdict=$?
		if ((verdict == 0)); then
			emit milestone "$title"
		else
			echo "Pull request #$arg has $why." >&2
		fi
		exit "$verdict"
		;;
	*) usage ;;
esac
