#!/usr/bin/env bash
# Run due reviews on their own (owner, 2026-10-22: "all the different types of reviews
# automatically run whenever they are required and not blocked"). Registered as a
# Claude Code hook in .claude/settings.json; also runnable by hand.
#
#   scripts/review-gate.sh prompt   # UserPromptSubmit: tell Claude, before it acts, what is due
#   scripts/review-gate.sh stop     # Stop: keep Claude going until every due review has run
#
# Due-ness comes from scripts/review-debt.sh (backlog review / design intake) and
# scripts/parity-debt.sh (doc parity), which read committed history only.
# A review whose newest ledger entry is `blocked` with no answers entry after it waits
# for the owner: the gate reports it and never runs it on its own.
# Stays quiet while the working tree is dirty: a story or review is mid-flight, and a
# review must not land in the same commit as other work.
# Loop guard: Stop blocks once per HEAD + due set; if a forced turn ends without
# committing a review, Claude is allowed to stop rather than spin.

set -uo pipefail
mode="${1:-stop}"
input="$([ -t 0 ] || cat)"
cd "$(dirname "$0")/.." || exit 0

LEDGER="docs/v3/AUDIT.md"

# Blocked if the newest review or answers entry of the kind is a blocked review (ledger.ts
# reviewBlocked, the ledger's one parser). A ledger that can't be read counts as blocked, so
# the gate waits for a person rather than running reviews on a broken ledger.
blocked() {
  [ "$(node scripts/backlog-vault/cli.ts --audit "$LEDGER" review-blocked "$1" 2>/dev/null)" != "clear" ]
}

[ -n "$(git status --porcelain 2>/dev/null)" ] && exit 0

todo=()
waiting=()
if blocked backlog; then
  waiting+=("backlog review")
elif ! out="$(scripts/review-debt.sh 2>&1)"; then
  if grep -q "design intake" <<<"$out"; then
    todo+=("DESIGN INTAKE REVIEW: follow .claude/skills/design-intake-review/SKILL.md. Fresh context: two independent general-purpose Agent subagents each report without editing; you merge and apply their reports, then log with scripts/audit.sh review."$'\n'"$out")
  else
    todo+=("BACKLOG REVIEW: follow .claude/skills/backlog-review/SKILL.md in one fresh-context general-purpose Agent subagent; log with scripts/audit.sh review."$'\n'"$out")
  fi
fi
if blocked parity; then
  waiting+=("doc parity review")
elif ! out="$(scripts/parity-debt.sh 2>&1)"; then
  todo+=("DOC PARITY REVIEW: follow .claude/skills/doc-parity-review/SKILL.md in one fresh-context general-purpose Agent subagent; log with scripts/audit.sh parity."$'\n'"$out")
fi

wait_note=""
if [ "${#waiting[@]}" -gt 0 ]; then
  wait_note="Blocked, waiting for the owner's answers (do not run it, and do not start a story): $(IFS=,; echo "${waiting[*]}"). Ask the owner the open questions in its newest docs/v3/AUDIT.md entry."
fi

if [ "${#todo[@]}" -eq 0 ]; then
  [ -n "$wait_note" ] && [ "$mode" = "prompt" ] && echo "$wait_note"
  exit 0
fi

body="$(printf '%s\n\n' "${todo[@]}")"
instructions="Review debt is due. Run these reviews now, in this order, before starting or continuing any story (CLAUDE.md Agent / loop rules):

${body}
Each review commits its edits together with its ledger entry, one commit per review. Run the backlog or design intake review before the doc parity review, and re-run scripts/review-debt.sh and scripts/parity-debt.sh after each commit, since one review can make the other due. If a verdict is \`blocked\`, stop and ask the owner its questions. Do not push unless the owner asked.${wait_note:+

$wait_note}"

if [ "$mode" = "prompt" ]; then
  echo "$instructions"
  exit 0
fi

stamp="$(git rev-parse HEAD) $(printf '%s' "$body" | shasum | cut -c1-12)"
state="$(git rev-parse --git-dir)/bt-review-gate"
if grep -q '"stop_hook_active": *true' <<<"$input" && [ "$(cat "$state" 2>/dev/null)" = "$stamp" ]; then
  exit 0
fi
echo "$stamp" >"$state"
node -e 'process.stdout.write(JSON.stringify({ decision: "block", reason: process.argv[1] }))' "$instructions"
