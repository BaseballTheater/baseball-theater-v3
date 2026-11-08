#!/usr/bin/env bash
# Grader for BACKLOG story S126 — a collapsed (non-favorite) game bar on the scoreboard opens
# its game page instead of expanding in place (owner, 2026-11-07: "collapsed games in the game
# list should not expand on click, they should go to the game page."). A commit-time proof of
# this story (S84): its "unchanged" checks read only the story's own diff.
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "a collapsed bar is a link to /game/<gamePk>, the full module's destination; choosing it navigates there and never expands the bar in place (RTL: the route changes to the game, no full module appears)"
check 2 "the scoreboard keeps no expanded-bar state: ScoreboardPage tracks no expanded games, CollapsedBar takes no onExpand, has no aria-expanded, and its comment and accessible name say it opens the game"
check 3 "the bar looks as before: the existing collapsed-bar and hidden tests pass, their score, swatch-order, hidden-score and state assertions unchanged; CollapsedBar's drawn content and styles unchanged beyond what a link needs"
check 4 "backlog Status is done (story heading and Story status table)"

BASE=d6d88fb3b74d964174512feb93366c22f70e4579
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BAR="web/src/components/scoreboard/CollapsedBar.tsx"
PAGE="web/src/pages/ScoreboardPage.tsx"
MODULE="web/src/components/scoreboard/ScoreboardModule.tsx"
TEST="src/components/scoreboard/CollapseHide.test.tsx"

run_vitest() {
  local id="$1" dir="$2" file="$3"
  shift 3
  if [ ! -f "$dir/$file" ]; then
    bad "$id" "$dir/$file missing"
  elif ! (cd "$dir" && pnpm exec vitest run "$file" "$@" --reporter=json --outputFile="$TMP/r.json" >"$TMP/r.log" 2>&1); then
    bad "$id" "$dir/$file $* failed:"; tail -15 "$TMP/r.log" | sed 's/^/        /'
  elif ! node -e 'process.exit(require(process.argv[1]).numPassedTests > 0 ? 0 : 1)' "$TMP/r.json"; then
    bad "$id" "$dir/$file $* ran no passing test"
  fi
}

# Lines the story's diff of $1 removes and does not add back elsewhere in the same file.
dropped_lines() {
  story_diff S126 "$BASE" -U0 -- "$1" >"$TMP/d.diff"
  grep -E '^-[^-]' "$TMP/d.diff" | sed -E 's/^-[[:space:]]*//' | sort -u >"$TMP/removed"
  grep -E '^\+[^+]' "$TMP/d.diff" | sed -E 's/^\+[[:space:]]*//' | sort -u >"$TMP/added"
  comm -23 "$TMP/removed" "$TMP/added"
}

# --- Check 1: the bar links to the game ---------------------------------------------------------
grep -qE 'to=\{`/game/\$\{game\.gamePk\}`\}' "$MODULE" || bad 1 "the full module no longer links to /game/\${game.gamePk} (the destination to match)"
grep -qE '\bLink\b' "$BAR" 2>/dev/null || bad 1 "$BAR does not use react-router's Link"
grep -qE 'to=\{`/game/\$\{game\.gamePk\}`\}' "$BAR" 2>/dev/null || bad 1 "$BAR does not link to /game/\${game.gamePk}"
grep -qE 'it\("opens the game' "web/$TEST" 2>/dev/null || bad 1 "web/$TEST has no it(\"opens the game…\") test"
run_vitest 1 web "$TEST" -t "opens the game"

# --- Check 2: no expanded state, no onExpand, says it opens the game ----------------------------
grep -nE 'expanded|setExpanded|useState' "$PAGE" >/dev/null && bad 2 "$PAGE still tracks expanded games: $(grep -nE 'expanded|setExpanded|useState' "$PAGE" | head -3 | tr '\n' ' ')"
hits="$(grep -rlE '\bonExpand\b' web/src | tr '\n' ' ')"
[ -z "$hits" ] || bad 2 "onExpand still appears in: $hits"
grep -qE 'aria-expanded' "$BAR" && bad 2 "$BAR still sets aria-expanded"
grep -qF 'show the game' "$BAR" && bad 2 "$BAR's accessible name still says \"show the game\""
grep -qE 'aria-label=.*open the game' "$BAR" || bad 2 "$BAR's accessible name does not say it opens the game"
grep -qE '^\s*\*.*opens (its|the) game' "$BAR" || bad 2 "$BAR's comment does not say choosing it opens the game"
grep -qE 'toHaveAccessibleName\(".*: open the game"\)' "web/$TEST" || bad 2 "web/$TEST asserts no \"…: open the game\" accessible name"

# --- Check 3: looks as before -------------------------------------------------------------------
run_vitest 3 web "$TEST" -t "collapsed bar"
run_vitest 3 web "$TEST" -t "hidden"
# Assertions about what the bar draws (score, swatch order, hidden score, state) may not be dropped.
lost="$(dropped_lines "web/$TEST" | grep -E 'collapsed-score|collapsed-state|team-swatch|compareDocumentPosition|HiddenValue|▒|order' || true)"
[ -z "$lost" ] || bad 3 "the story drops drawn-content assertions from web/$TEST: $(echo "$lost" | head -3 | tr '\n' ' ')"
# CollapsedBar: what it draws and how it is styled stays; only the element, handler, ARIA, imports and comment may change.
changed="$(dropped_lines "$BAR" | grep -vE '^$|^\*|^/\*\*|^import|^\}|^Box, Group, Text, UnstyledButton,$|UnstyledButton|onClick=\{onExpand\}|aria-expanded|aria-label=|^export function CollapsedBar|^onExpand: \(\) => void; \}\)$' || true)"
[ -z "$changed" ] || bad 3 "the story changes CollapsedBar's drawn content or styles: $(echo "$changed" | head -3 | tr '\n' ' ')"
for s in 'data-testid="collapsed-bar"' 'display: "block"' 'width: "100%"' 'borderRadius: "var(--mantine-radius-md)"' 'border: "1px solid var(--bt-hairline)"' 'background: "var(--bt-raised)"' 'padding: "10px 16px"'; do
  grep -qF "$s" "$BAR" || bad 3 "$BAR lost $s"
done

# --- Check 4: backlog Status is done ------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S126\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 4 "S126 row in the Story status table is not \`done\`"
awk '/^### S126 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md \
  | grep -qE '^\*\*Status:\*\* `done`$' ||
  bad 4 "S126 story heading Status is not \`done\`"

report "verify-S126"
exit $?
