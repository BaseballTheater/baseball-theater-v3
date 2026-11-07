#!/usr/bin/env bash
# Append an entry to the verification ledger, docs/v3/AUDIT.md.
#
# Story entries record exactly what a story's grader checked and the commit the
# story shipped in. Review entries record every backlog review pass; parity
# entries record every doc parity review pass (docs/v3/BACKLOG.md rule 19).
#
#   scripts/audit.sh story S13                    # completion: grader + pnpm verify
#   scripts/audit.sh story S13 --reverify         # later re-run of a shipped story
#   scripts/audit.sh story S11 --backfill --commit c375ad5 --no-verify
#   scripts/audit.sh story S79 --design-match -    # UI story: owner's verdict on stdin
#   scripts/audit.sh design S60 --design-match -   # a verdict on its own, no grader run
#   scripts/audit.sh review --trigger "3 done since last review" \
#                    --since "S23, S21, S13" --verdict amended --findings "..."
#   scripts/audit.sh review --verdict continue --trigger manual --findings -
#   scripts/audit.sh parity --trigger "S40 inserted" --verdict amended --findings -
#   scripts/audit.sh answers backlog --review 2026-10-09 --commit 6a46b62 --answers -
#   scripts/audit.sh skip backlog --commit 5470524 --answers -   # owner: no review needed
#
# An answers entry records the owner's answers to a review's questions and what
# was applied from them. Applying them is part of finishing that review, not new
# drift: the debt checks measure their drift events from the answers entry.
# A skip entry records the owner declining a review for a drift event (an
# owner-directed change, say): that event no longer makes the review due. Neither
# entry resets the count of stories done since the last review — only a review
# does (owner, 2026-11-03: "Skip notes should not reset the counter, they should
# just avoid incrementing it"), so a count already at the backstop stays due.
#
# Flags: --commit <sha> names the shipping commit; --no-verify skips the repo-wide
# pnpm verify for entries covered by another run; --findings - reads stdin.
# --design-match <verdict|-> (rule 22, S81) pairs each capture in
# docs/v3/design-checks/<ID>/ with the ratified frame (or written amendment) under docs/v3/visual/ that governs it,
# recording both SHA-256s and the owner's verdict, quoted. A story whose note has a
# `design:` list cannot be recorded as completed without it (backlog rule 22).
# `design <ID>` records such a verdict on its own, without running the grader (S84).
# --reverify runs today's grader in a temporary worktree at the story's shipping commit
# (scripts/lib/reverify.sh): a grader proves its own story, not the repo at HEAD (S84).
#
# Unlike a grader this DOES write to the working tree — that is its whole job.
# It never fabricates results: every check line in a story entry comes from a
# real grader run captured here. A story is not done until its ledger entry is
# committed alongside the code.
#
# Prints a commit-message summary block to stdout on completion.

set -uo pipefail
cd "$(dirname "$0")/.."

# Overridable for a separate backlog + ledger (docs/v3/VAULT-MIGRATION.md).
LEDGER="${BT_AUDIT_LEDGER:-docs/v3/AUDIT.md}"
BACKLOG="${BT_AUDIT_BACKLOG:-docs/v3/BACKLOG.md}"
# Rule 22 inputs, overridable for tests (scripts/backlog-vault/audit-design-match.test.ts).
STORIES_DIR="${BT_AUDIT_STORIES:-docs/v3/backlog/stories}"
CHECKS_DIR="${BT_AUDIT_DESIGN_CHECKS:-docs/v3/design-checks}"
VISUAL_DIR="${BT_AUDIT_VISUAL:-docs/v3/visual}"
GRADERS_DIR="${BT_AUDIT_GRADERS:-scripts}"
STAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
TODAY="$(date +"%Y-%m-%d")"
HEAD_SHA="$(git rev-parse --short HEAD)"

if [ -n "$(git status --porcelain)" ]; then
  TREE="dirty"
else
  TREE="clean"
fi

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

if [ ! -f "$LEDGER" ]; then
  echo "audit: $LEDGER missing — the ledger is the file entries append to" >&2
  exit 2
fi

# Everything below the marker is entries, newest last.
MARKER="<!-- entries below; newest last; appended by scripts/audit.sh -->"
grep -qF "$MARKER" "$LEDGER" || {
  echo "audit: $LEDGER has no append marker" >&2
  exit 2
}

read_arg() { # read_arg <value> — "-" means stdin
  if [ "$1" = "-" ]; then cat; else printf '%s' "$1"; fi
}

# shellcheck source=lib/reverify.sh
source "$(dirname "$0")/lib/reverify.sh"

# design_match_rows <ID> — one table row per capture in CHECKS_DIR/<ID>/, paired with the
# ratified reference that governs its name under VISUAL_DIR; exits 2 if any pairing fails. The
# reference comes from scripts/backlog-vault/design-reference.ts, the same code `pnpm design:review`
# (e2e/design-review.ts) uses, so the pair is the one the owner judged: an amendment frame wins
# over the original, and a written amendment that overrides the frame wins over both, in which
# case the row names the amendment file and its hash, never the frame it supersedes.
design_match_rows() {
  local id="$1" captures cap name refs count fsum csum
  captures="$(ls "${CHECKS_DIR}/${id}"/*.png 2>/dev/null || true)"
  if [ -z "$captures" ]; then
    echo "audit: no captures in ${CHECKS_DIR}/${id}/ (run pnpm design:capture ${id})" >&2
    exit 2
  fi
  for cap in $captures; do
    name="$(basename "$cap")"
    refs="$(node scripts/backlog-vault/design-reference.ts "$VISUAL_DIR" "$name")" || exit 2
    count="$(printf '%s' "$refs" | grep -c . || true)"
    if [ "$count" != "1" ]; then
      echo "audit: capture ${name} matches ${count} ratified frames under ${VISUAL_DIR}; need exactly one" >&2
      exit 2
    fi
    fsum="$(shasum -a 256 "$refs" | cut -d' ' -f1)"
    csum="$(shasum -a 256 "$cap" | cut -d' ' -f1)"
    printf '| `%s` | `%s` | `%s` | `%s` |\n' "$refs" "$fsum" "$cap" "$csum"
  done
}

# design_match_section <rows> <verdict> — the ledger section both modes write.
design_match_section() {
  echo
  echo "**Design match (rule 22)** — the owner compared each capture with the ratified frame or written amendment that governs it"
  echo
  echo "| Ratified frame or amendment | SHA-256 | Capture | SHA-256 |"
  echo "|---|---|---|---|"
  printf '%s' "$1"
  echo
  echo "Owner: \"$(printf '%s' "$2" | tr '\n' ' ' | sed 's/[[:space:]]*$//')\""
}

MODE="${1:-}"
shift || usage

case "$MODE" in
  story) ;;
  design) ;;
  review) ;;
  parity) ;;
  answers) ;;
  skip) ;;
  *) usage ;;
esac

# --- design --------------------------------------------------------------------
# A design-match verdict on its own (S84): no grader run, and not a completion — the
# heading "— <ID> design match" is not one the debt counters read as "completed".
if [ "$MODE" = "design" ]; then
  ID="${1:-}"
  [ -n "$ID" ] || usage
  shift
  DESIGN_MATCH=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --design-match) DESIGN_MATCH="$(read_arg "${2:-}")"; shift 2 ;;
      *) echo "audit: unknown option $1" >&2; usage ;;
    esac
  done
  [ -n "$DESIGN_MATCH" ] || { echo "audit: design needs --design-match <verdict|->" >&2; exit 2; }
  rows="$(design_match_rows "$ID")" || exit 2
  {
    echo
    echo "---"
    echo
    echo "## ${TODAY} — ${ID} design match"
    echo
    echo "| | |"
    echo "|---|---|"
    echo "| Entry | design match only — no grader run; not a completion |"
    echo "| Captured (UTC) | \`${STAMP}\` |"
    echo "| HEAD at capture | \`${HEAD_SHA}\` (tree ${TREE}) |"
    design_match_section "$rows" "$DESIGN_MATCH"
  } >>"$LEDGER"
  echo "audit ${ID}: design match appended to ${LEDGER}"
  exit 0
fi

# --- story ---------------------------------------------------------------------
if [ "$MODE" = "story" ]; then
  ID="${1:-}"
  [ -n "$ID" ] || usage
  shift

  LABEL="completion"
  COMMIT=""
  RUN_VERIFY=1
  DESIGN_MATCH=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --design-match) DESIGN_MATCH="$(read_arg "${2:-}")"; shift 2 ;;
      --reverify) LABEL="reverify"; shift ;;
      --backfill) LABEL="backfill"; shift ;;
      --no-verify) RUN_VERIFY=0; shift ;;
      --commit) COMMIT="${2:-}"; shift 2 ;;
      *) echo "audit: unknown option $1" >&2; usage ;;
    esac
  done

  if [ "$LABEL" = "reverify" ] && [ -n "$DESIGN_MATCH" ]; then
    echo "audit: record a design verdict with 'audit.sh design ${ID} --design-match', not with --reverify (S84)" >&2
    exit 2
  fi

  GRADER="${GRADERS_DIR}/verify-${ID}.sh"
  if [ ! -x "$GRADER" ]; then
    echo "audit: $GRADER missing or not executable" >&2
    exit 2
  fi

  # Rule 22: a UI story (a `design:` list in its note) is done only on the owner's
  # verdict on its captures. A story whose match AC says "none" is exempt.
  NOTE="${STORIES_DIR}/${ID}.md"
  needs_match=0
  if [ -f "$NOTE" ] && awk '/^---$/{n++;next} n==1' "$NOTE" | grep -qE '^design:$' &&
    ! grep -qF 'Design match (rule 22): none' "$NOTE"; then
    needs_match=1
  fi
  if [ "$LABEL" = "completion" ] && [ "$needs_match" -eq 1 ] && [ -z "$DESIGN_MATCH" ]; then
    echo "audit: ${ID} builds a ratified design; record the owner's verdict with --design-match (backlog rule 22)" >&2
    exit 2
  fi

  # Pair each capture with the one ratified frame of the same name.
  match_rows=""
  if [ -n "$DESIGN_MATCH" ]; then
    match_rows="$(design_match_rows "$ID")" || exit 2
  fi

  TITLE="$(grep -m1 -E "^\| [0-9]+ \| \[${ID}\]" "$BACKLOG" |
    awk -F' \\| ' '{print $3}' | sed 's/[[:space:]]*$//')"
  [ -n "$TITLE" ] || TITLE="(title not found in ${BACKLOG} status table)"

  grader_log="$(mktemp "${TMPDIR:-/tmp}/audit-${ID}-grader.XXXXXX")"
  verify_log="$(mktemp "${TMPDIR:-/tmp}/audit-${ID}-verify.XXXXXX")"

  if [ "$LABEL" = "reverify" ]; then
    SHIP="$(shipping_commit "$LEDGER" "$ID")"
    if [ -z "$SHIP" ]; then
      echo "audit: ${ID} has no completion entry in ${LEDGER}, so no shipping commit to re-verify at" >&2
      exit 2
    fi
    echo "audit ${ID}: running ${GRADER} at its shipping commit ${SHIP}…"
    reverify_at "$SHIP" "$GRADER" "$grader_log"
    grader_exit=$?
  else
    echo "audit ${ID}: running ${GRADER}…"
    "$GRADER" >"$grader_log" 2>&1
    grader_exit=$?
  fi

  if [ "$RUN_VERIFY" -eq 1 ]; then
    echo "audit ${ID}: running pnpm verify…"
    pnpm verify >"$verify_log" 2>&1
    verify_exit=$?
  else
    verify_exit="skipped"
  fi

  check_lines="$(grep -E '^check [0-9]+ (PASS|FAIL):' "$grader_log" || true)"
  # checks.sh labels the tally with the grader's own id ("verify-S11"), not "S11".
  tally="$(grep -E "^--- (verify-)?${ID}: [0-9]+/[0-9]+ checks passed ---$" "$grader_log" |
    sed -E 's/^--- [^:]+: (.*) ---$/\1/' || true)"

  if [ -n "$COMMIT" ]; then
    SHIPPED="\`$(git rev-parse --short "$COMMIT")\` — $(git log -1 --format=%s "$COMMIT")"
  elif [ "$LABEL" = "reverify" ]; then
    SHIPPED="(see this story's completion entry above)"
  else
    SHIPPED="the commit that adds this entry"
  fi

  {
    echo
    echo "---"
    echo
    case "$LABEL" in
      reverify) echo "## ${TODAY} — ${ID} re-verified at \`${SHIP}\`" ;;
      backfill) echo "## ${TODAY} — ${ID} verified (backfill)" ;;
      *)        echo "## ${TODAY} — ${ID} completed" ;;
    esac
    echo
    echo "**${TITLE}**"
    echo
    echo "| | |"
    echo "|---|---|"
    case "$LABEL" in
      reverify) echo "| Entry | story re-verification — today's grader run in a worktree at the shipping commit \`${SHIP}\` (S84); **not** a capture of the original completion run |" ;;
      backfill) echo "| Entry | **backfill** — this story shipped before the ledger existed. The grader run below is real and happened today, at the HEAD below, not at the shipping commit |" ;;
      *)        echo "| Entry | story completion |" ;;
    esac
    echo "| Captured (UTC) | \`${STAMP}\` |"
    echo "| Shipped in | ${SHIPPED} |"
    echo "| HEAD at capture | \`${HEAD_SHA}\` (tree ${TREE}) |"
    echo "| Grader | \`${GRADER}\` — exit \`${grader_exit}\` |"
    if [ "$RUN_VERIFY" -eq 1 ]; then
      echo "| \`pnpm verify\` | exit \`${verify_exit}\` |"
    else
      echo "| \`pnpm verify\` | not re-run for this entry — one repo-wide run covers the tree, recorded in the newest completion entry |"
    fi
    echo
    echo "**What was tested and verified**"
    echo
    if [ -n "$check_lines" ]; then
      echo '```'
      echo "$check_lines"
      echo '```'
      [ -n "$tally" ] && { echo; echo "**${tally}**"; }
    else
      echo "_This grader predates the per-check reporting contract"
      echo "(\`scripts/lib/checks.sh\`) and emitted no per-check lines. Only its"
      echo "exit code is recorded above._"
    fi
    if [ -n "$DESIGN_MATCH" ]; then
      design_match_section "$match_rows" "$DESIGN_MATCH"
    fi
    echo
    echo "<details><summary>Grader output</summary>"
    echo
    echo '```'
    cat "$grader_log"
    echo '```'
    echo
    echo "</details>"
    echo
    if [ "$RUN_VERIFY" -eq 1 ]; then
      echo "<details><summary><code>pnpm verify</code> (tail)</summary>"
      echo
      echo '```'
      tail -30 "$verify_log"
      echo '```'
      echo
      echo "</details>"
    fi
  } >>"$LEDGER"

  rm -f "$grader_log" "$verify_log"

  echo
  echo "audit ${ID}: appended to ${LEDGER}"
  echo
  echo "--- commit message summary (paste into the commit body) ---"
  echo "Verification (${GRADER}, exit ${grader_exit}; pnpm verify, ${verify_exit}):"
  if [ -n "$check_lines" ]; then
    echo "$check_lines" | sed 's/^/  /'
  fi
  echo "Ledger: ${LEDGER}"
  echo "---"

  if [ "$grader_exit" -ne 0 ]; then exit 1; fi
  if [ "$RUN_VERIFY" -eq 1 ] && [ "$verify_exit" -ne 0 ]; then exit 1; fi
  exit 0
fi

# --- answers -------------------------------------------------------------------
if [ "$MODE" = "answers" ]; then
  case "${1:-}" in
    backlog) KIND="backlog review" ;;
    parity) KIND="doc parity review" ;;
    *) echo "audit: answers needs 'backlog' or 'parity' (which review was answered)" >&2; exit 2 ;;
  esac
  shift
  REVIEW_DATE=""
  ANSWERS=""
  APPLIED_IN="the commit that adds this entry"
  while [ $# -gt 0 ]; do
    case "$1" in
      --review) REVIEW_DATE="${2:-}"; shift 2 ;;
      --answers) ANSWERS="$(read_arg "${2:-}")"; shift 2 ;;
      --commit) APPLIED_IN="\`$(git rev-parse --short "${2:-}")\` — $(git log -1 --format=%s "${2:-}")"; shift 2 ;;
      *) echo "audit: unknown option $1" >&2; usage ;;
    esac
  done
  [ -n "$REVIEW_DATE" ] || { echo "audit: --review <date of the review answered> is required" >&2; exit 2; }
  grep -qE "^## ${REVIEW_DATE} — ${KIND} \(" "$LEDGER" || {
    echo "audit: no ${KIND} entry dated ${REVIEW_DATE} in ${LEDGER}" >&2
    exit 2
  }
  [ -n "$ANSWERS" ] || { echo "audit: --answers is required (quote the owner, then what was applied)" >&2; exit 2; }
  {
    echo
    echo "---"
    echo
    echo "## ${TODAY} — ${KIND} answers (${REVIEW_DATE})"
    echo
    echo "| | |"
    echo "|---|---|"
    echo "| Entry | owner's answers to the ${REVIEW_DATE} ${KIND} — part of finishing that review, not new drift |"
    echo "| Captured (UTC) | \`${STAMP}\` |"
    echo "| HEAD at capture | \`${HEAD_SHA}\` (tree ${TREE}) |"
    echo "| Applied in | ${APPLIED_IN} |"
    echo
    echo "**Answers and what was applied**"
    echo
    echo "$ANSWERS"
  } >>"$LEDGER"
  echo "audit answers: appended the owner's answers to the ${REVIEW_DATE} ${KIND} to ${LEDGER}"
  exit 0
fi

# --- skip ----------------------------------------------------------------------
# The owner declined a review for a drift event. The heading "— <kind> skipped" moves
# the debt scripts' drift base (it starts "— <kind>") but is not a review heading
# ("— <kind> (`verdict`)"), so the stories-done count runs on through it.
if [ "$MODE" = "skip" ]; then
  case "${1:-}" in
    backlog) KIND="backlog review" ;;
    parity) KIND="doc parity review" ;;
    *) echo "audit: skip needs 'backlog' or 'parity' (which review was declined)" >&2; exit 2 ;;
  esac
  shift
  ANSWERS=""
  APPLIED_IN="the commit that adds this entry"
  while [ $# -gt 0 ]; do
    case "$1" in
      --answers) ANSWERS="$(read_arg "${2:-}")"; shift 2 ;;
      --commit) APPLIED_IN="\`$(git rev-parse --short "${2:-}")\` — $(git log -1 --format=%s "${2:-}")"; shift 2 ;;
      *) echo "audit: unknown option $1" >&2; usage ;;
    esac
  done
  [ -n "$ANSWERS" ] || { echo "audit: --answers is required (what changed, then the owner's \"no\", quoted)" >&2; exit 2; }
  {
    echo
    echo "---"
    echo
    echo "## ${TODAY} — ${KIND} skipped"
    echo
    echo "| | |"
    echo "|---|---|"
    echo "| Entry | the owner declined a ${KIND} for this change — its drift no longer makes one due; the stories-done count is unchanged |"
    echo "| Captured (UTC) | \`${STAMP}\` |"
    echo "| HEAD at capture | \`${HEAD_SHA}\` (tree ${TREE}) |"
    echo "| Change | ${APPLIED_IN} |"
    echo
    echo "**What changed, and the owner's answer**"
    echo
    echo "$ANSWERS"
  } >>"$LEDGER"
  echo "audit skip: appended the owner's skip of a ${KIND} to ${LEDGER}"
  exit 0
fi

# --- review / parity -----------------------------------------------------------
if [ "$MODE" = "parity" ]; then
  KIND="doc parity review"
else
  KIND="backlog review"
fi

TRIGGER=""
SINCE=""
VERDICT=""
FINDINGS=""
DATE="$TODAY"
while [ $# -gt 0 ]; do
  case "$1" in
    --trigger) TRIGGER="$(read_arg "${2:-}")"; shift 2 ;;
    --since) SINCE="$(read_arg "${2:-}")"; shift 2 ;;
    --verdict) VERDICT="${2:-}"; shift 2 ;;
    --findings) FINDINGS="$(read_arg "${2:-}")"; shift 2 ;;
    --date) DATE="${2:-}"; shift 2 ;;
    --commit) HEAD_SHA="$(git rev-parse --short "${2:-}")"; shift 2 ;;
    *) echo "audit: unknown option $1" >&2; usage ;;
  esac
done

case "$VERDICT" in
  continue|amended|blocked) ;;
  *) echo "audit: --verdict must be continue, amended or blocked" >&2; exit 2 ;;
esac
[ -n "$TRIGGER" ] || { echo "audit: --trigger is required" >&2; exit 2; }
[ -n "$FINDINGS" ] || { echo "audit: --findings is required (a verdict with no cited evidence does not count as a review)" >&2; exit 2; }

{
  echo
  echo "---"
  echo
  echo "## ${DATE} — ${KIND} (\`${VERDICT}\`)"
  echo
  echo "| | |"
  echo "|---|---|"
  echo "| Entry | ${KIND} pass |"
  echo "| Captured (UTC) | \`${STAMP}\` |"
  echo "| HEAD at review | \`${HEAD_SHA}\` (tree ${TREE}) |"
  echo "| Trigger | ${TRIGGER} |"
  echo "| Stories \`done\` since last review | ${SINCE:-—} |"
  echo "| Verdict | \`${VERDICT}\` |"
  echo
  echo "**Findings / amendments**"
  echo
  echo "$FINDINGS"
} >>"$LEDGER"

echo "audit ${MODE}: appended a \`${VERDICT}\` ${KIND} entry to ${LEDGER}"
if [ "$VERDICT" = "blocked" ]; then
  echo "audit ${MODE}: verdict is 'blocked' — stop and ask the user. Do not start a story." >&2
  exit 1
fi
