#!/usr/bin/env bash
# Grader for BACKLOG story S109 — the Live status shows the inning, count and outs in one
# place (game-rooms A5): the status row and card read the inning alone (`Bot 7th`, no outs
# after it) beside the score, base diamond and B / S / O pips, and the mobile matchup line
# has no `Count: … · … Out` text. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "the status row and card read the inning alone, with score, diamond and pips, at every variant (RTL, 823823)"
check 2 "on mobile the matchup line has no Count: or outs text; the result line stays (RTL)"
check 3 "with Hide Scores on, the status still reads the inning alone and the matchup line has no Count: or outs text (RTL)"
check 4 "files this story adds or edits reference no team logo and read no viewport outside web/src/layout/"
check 5 "design match: e2e/design/S109.spec.ts names live-mobile, live-medium, live-desktop; docs/v3/design-checks/S109/ holds them at 390 / 768 / 1200"
check 6 "backlog Status is done (story heading and Story status table)"

BASE=fcd3e62
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
LT="src/components/game/LiveRoom.test.tsx"

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

# --- Check 1: the inning alone, at every variant -------------------------------------------------
grep -qw 'outsLabel' web/src/components/game/LiveStatus.tsx && bad 1 "LiveStatus.tsx still joins outsLabel onto the inning"
for v in mobile medium desktop; do
  run_vitest 1 web "$LT" -t "one status row \(S109\): $v"
done

# --- Check 2: the matchup line -------------------------------------------------------------------
grep -q 'Count:' web/src/components/game/LiveRoom.tsx && bad 2 "LiveRoom.tsx still prints Count:"
run_vitest 2 web "$LT" -t "one status row \(S109\): matchup line"

# --- Check 3: Hide Scores on ---------------------------------------------------------------------
run_vitest 3 web "$LT" -t "one status row \(S109\): hidden"

# --- Check 4: no logos, no viewport --------------------------------------------------------------
for f in $(story_changed_files S109 "$BASE" web/src); do
  [ -f "$f" ] || continue
  grep -nE '<img[^>]*logo|/logos/' "$f" >/dev/null && bad 4 "$f references a team logo"
  case "$f" in
    web/src/layout/*) ;;
    *) grep -nwE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" >/dev/null && bad 4 "$f reads the viewport" ;;
  esac
done

# --- Check 5: design match captures --------------------------------------------------------------
S="e2e/design/S109.spec.ts"
for fw in live-mobile:390 live-medium:768 live-desktop:1200; do
  name="${fw%%:*}"; w="${fw##*:}"; png="docs/v3/design-checks/S109/$name.png"
  grep -qF "\"$name\"" "$S" 2>/dev/null || bad 5 "$S does not name $name"
  if [ -f "$png" ]; then
    [ "$(png_width "$png")" = "$w" ] || bad 5 "$png is $(png_width "$png")px wide, want $w"
  else
    bad 5 "$png missing"
  fi
done

# --- Check 6: backlog Status is done -------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S109\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 6 "S109 row in the Story status table is not \`done\`"
awk '/^### S109 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s109.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s109.md" || bad 6 "S109 story heading Status is not \`done\`"

report "verify-S109"
exit $?
