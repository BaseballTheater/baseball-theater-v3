#!/usr/bin/env bash
# Is a doc parity review due? (docs/v3/BACKLOG.md rule 19, "Doc parity reviews")
#
#   pnpm parity:debt          # prints why or why not; exit 1 when due, 0 when not
#
# Measured from the commit that logged the newest "doc parity review" entry, the
# owner's answers to one, or the owner's skip of one, in docs/v3/AUDIT.md. A parity
# review commits its edits together with that entry, and applying the owner's answers
# (scripts/audit.sh answers parity) or declining a review (scripts/audit.sh skip parity)
# is logged the same way, so none counts as debt. The stories-done count resets only on
# a review itself, never on answers or a skip (owner, 2026-11-03: "Skip notes should
# not reset the counter").
# Due when, since then: a product doc changed, a story note was added or removed, a
# story's **Source:** line changed, a pillar-cited story's purpose changed (its Gap,
# Impact or acceptance criteria — the owner's approval may no longer cover it), or 6
# stories went `done` (doubled from 3 by the owner, 2026-10-21). Other story-text edits
# don't count: a feature citation is checked against FEATURES, not the story text, and a
# pillar story's scope list, goal-line paths, work items or notes don't change what it is
# for (owner, 2026-10-23: narrowed after scope-list edits alone kept making it due).
#
# Reads committed history only (HEAD); uncommitted edits are not counted.

set -uo pipefail
cd "$(dirname "$0")/.."

LEDGER="${BT_AUDIT_LEDGER:-docs/v3/AUDIT.md}"
STORIES="docs/v3/backlog/stories"
DOCS=(docs/v3/INTENT.md docs/v3/ORIGIN.md docs/v3/FEATURES.md docs/v3/VISUAL-DESIGN.md docs/v3/ARCHITECTURE.md)
BACKSTOP=6

# The ledger is read through scripts/backlog-vault/ledger.ts, its one parser: the base is the newest
# commit that logged a doc parity review, its answers or a skip of one.
LEDGER_CLI=(node scripts/backlog-vault/cli.ts --audit "$LEDGER")
base="$("${LEDGER_CLI[@]}" ledger-base parity)" || { echo "parity: could not read ${LEDGER}" >&2; exit 2; }
if [ -z "$base" ]; then
  echo "parity: no doc parity review logged in ${LEDGER} yet — one is due."
  exit 1
fi

reasons=()

while IFS= read -r doc; do
  [ -n "$doc" ] && reasons+=("${doc} changed")
done < <(git diff --name-only "$base" HEAD -- "${DOCS[@]}")

while IFS=$'\t' read -r change path; do
  [ -z "$path" ] && continue
  id="$(basename "$path" .md)"
  case "$change" in
    A) reasons+=("${id} added") ;;
    D) reasons+=("${id} removed") ;;
  esac
done < <(git diff --name-status --diff-filter=AD "$base" HEAD -- "$STORIES")

# A note's body is everything after its frontmatter; status/priority flips live in the frontmatter.
body() { git show "$1:$2" 2>/dev/null | awk 'n >= 2 { print } /^---$/ { n++ }'; }
# What a story is for: its **Gap:** and **Impact:** paragraphs and its **Acceptance criteria** list.
purpose() {
  awk '/^\*\*(Gap|Impact):\*\*/ { print; next }
    /^\*\*Acceptance criteria\*\*/ { on = 1; next } on && /^\*\*/ { on = 0 } on && NF { print }'
}
while IFS= read -r path; do
  [ -z "$path" ] && continue
  id="$(basename "$path" .md)"
  before="$(body "$base" "$path")"
  after="$(body HEAD "$path")"
  if [ "$(grep '^\*\*Source:\*\*' <<<"$before")" != "$(grep '^\*\*Source:\*\*' <<<"$after")" ]; then
    reasons+=("${id}'s **Source:** changed")
  fi
  if grep -q '^\*\*Source:\*\* Pillar:' <<<"$before$after" &&
    [ "$(purpose <<<"$before")" != "$(purpose <<<"$after")" ]; then
    reasons+=("${id}'s Gap, Impact or acceptance criteria changed, and it cites a pillar")
  fi
done < <(git diff --name-only --diff-filter=M "$base" HEAD -- "$STORIES")

# Stories completed since the newest parity entry, by ledger order (re-verifications don't count).
done_since="$("${LEDGER_CLI[@]}" done-since parity)" || { echo "could not read ${LEDGER}" >&2; exit 2; }
done_count=0
[ -n "$done_since" ] && done_count="$(tr ',' '\n' <<<"$done_since" | wc -l | tr -d ' ')"
if [ "$done_count" -ge "$BACKSTOP" ]; then
  reasons+=("${done_count} stories done since (${done_since})")
fi

if [ "${#reasons[@]}" -eq 0 ]; then
  echo "parity: not due — nothing changed since the last doc parity review or its answers (logged in ${base}); ${done_count} of ${BACKSTOP} stories done since."
  exit 0
fi
echo "parity: a doc parity review is due (since ${base}, which logged the last review or its answers):"
printf '  - %s\n' "${reasons[@]}"
exit 1
