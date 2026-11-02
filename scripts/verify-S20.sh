#!/usr/bin/env bash
# Grader for BACKLOG story S20 — the scoreboard keeps in-window games current on its own:
# the schedule day re-asks BT's /api/v1/schedule on a named, documented interval while the
# page is mounted, pauses while the tab is hidden, and a refresh shows the newer payload's
# scores. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "the schedule hook refreshes on a named, documented interval constant and fetches BT's /api/v1/schedule only (grep)"
check 2 "the refresh is visibility-aware in source, and a test shows a hidden tab does not fetch on the interval"
check 3 "two schedule payloads in sequence: after the refresh the scores are the second's (test file exits 0 alone)"
check 4 "design match: e2e/design/S20.spec.ts names scoreboard-mobile, -medium, -desktop; docs/v3/design-checks/S20/ holds them at 390 / 768 / 1200"
check 5 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FR="web/src/api/freshness.ts"
SC="web/src/api/schedule.ts"
CL="web/src/api/client.ts"
PG="web/src/pages/ScoreboardPage.tsx"
RT="src/pages/ScoreboardPage.refresh.test.tsx"

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

png_width() {
  node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$1"
}

# --- Check 1: a named, documented interval; BT's path only ---------------------------------------
# The constant is exported from freshness.ts (the only module allowed to name an interval) with a
# doc comment directly above it, and the schedule hook's refetch uses it.
CONST="$(grep -oE '^export const [A-Z_]+_MS\b' "$FR" 2>/dev/null | awk '{print $3}' | head -1)"
if [ -z "$CONST" ]; then
  bad 1 "$FR exports no *_MS interval constant"
else
  awk -v c="$CONST" '$0 ~ "^export const " c "\\>" { exit (prev ~ /\*\/[[:space:]]*$/) ? 0 : 1 } { prev = $0 }' "$FR" ||
    bad 1 "$CONST in $FR has no doc comment directly above it"
  grep -qE "refetchInterval:[^,]*$CONST" "$FR" || bad 1 "the active refetchInterval in $FR does not use $CONST"
fi
grep -qE 'refetchInterval' "$SC" || bad 1 "$SC sets no refetchInterval"
grep -qF '"/api/v1/schedule"' "$CL" || bad 1 "$CL does not call /api/v1/schedule"
grep -qF 'fetchSchedule' "$SC" || bad 1 "$SC does not fetch through fetchSchedule"
grep -l 'statsapi.mlb.com' "$FR" "$SC" "$CL" "$PG" 2>/dev/null | grep -q . && bad 1 "the page or hook names statsapi.mlb.com"

# --- Check 2: visibility-aware --------------------------------------------------------------------
grep -qE 'document\.hidden|visibilitychange' "$FR" "$SC" || bad 2 "neither $FR nor $SC reads document.hidden or listens for visibilitychange"
run_vitest 2 web "$RT" -t "hidden"

# --- Check 3: the second payload's scores --------------------------------------------------------
run_vitest 3 web "$RT"
run_vitest 3 web "$RT" -t "second payload"

# --- Check 4: design match captures --------------------------------------------------------------
S="e2e/design/S20.spec.ts"
for fw in scoreboard-mobile:390 scoreboard-medium:768 scoreboard-desktop:1200; do
  name="${fw%%:*}"; w="${fw##*:}"; png="docs/v3/design-checks/S20/$name.png"
  grep -qF "\"$name\"" "$S" 2>/dev/null || bad 4 "$S does not name $name"
  if [ -f "$png" ]; then
    [ "$(png_width "$png")" = "$w" ] || bad 4 "$png is $(png_width "$png")px wide, want $w"
  else
    bad 4 "$png missing"
  fi
done

# --- Check 5: backlog Status is done -------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S20\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 5 "S20 row in the Story status table is not \`done\`"
awk '/^### S20 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s20.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s20.md" || bad 5 "S20 story heading Status is not \`done\`"

report "verify-S20"
exit $?
