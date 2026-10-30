#!/usr/bin/env bash
# Grader for BACKLOG story S67 — the scoreboard's game-row slot: what sits at the right
# of each module, chosen by the Game-Row Slot setting. Status (the default) shows the
# pitchers of record on finals, the count on live games and the probables before first
# pitch; Room Menu lists the game's rooms for its phase. A commit-time proof (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "slotOccupant(setting, phase) in packages/domain: pitchers of record / count / probables for Status by phase, room menu otherwise (table test)"
check 2 "the room-menu occupant lists exactly roomsForPhase(gamePhase(game)) as links to /game/:pk/:room (a test per phase)"
check 3 "the count occupant reuses BaseDiamond and shows the count as shorthand text from countShorthand (no pips; owner, 2026-10-30); no second diamond exists under web/src/"
check 4 "Settings → Game List has a Game-Row Slot radio with exactly Status (default) and Room Menu; changing it re-renders a mounted scoreboard without reload and saves to the account (test)"
check 5 "files this story adds or edits have no team logo and no useMediaQuery / hiddenFrom / visibleFrom outside web/src/layout/"
check 6 "design match: e2e/design/S67.spec.ts names scoreboard-mobile / -medium / -desktop and scoreboard-slot-room-menu-mobile; docs/v3/design-checks/S67/ holds them at 390/768/1200/390"
check 7 "backlog Status is done (story heading and Story status table)"

BASE=69ecb88
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
WT="src/components/scoreboard/GameRowSlot.test.tsx"
DT="src/slot-occupant.test.ts"
SLOT="web/src/components/scoreboard/GameRowSlot.tsx"

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

# --- Check 1: the domain chooser ----------------------------------------------------------------
grep -rqE 'export function slotOccupant\(' packages/domain/src || bad 1 "packages/domain exports no slotOccupant"
grep -qE 'describe\("slotOccupant' "packages/domain/$DT" 2>/dev/null || bad 1 "packages/domain/$DT has no describe(\"slotOccupant…\")"
grep -qE '\.each\(' "packages/domain/$DT" 2>/dev/null || bad 1 "packages/domain/$DT is not a table test (.each)"
run_vitest 1 packages/domain "$DT" -t "slotOccupant"
grep -qw 'slotOccupant' "$SLOT" 2>/dev/null || bad 1 "$SLOT does not choose its occupant with slotOccupant"

# --- Check 2: the room menu, per phase ----------------------------------------------------------
grep -qw 'roomsForPhase' "$SLOT" 2>/dev/null || bad 2 "$SLOT does not list rooms with roomsForPhase"
for phase in pregame live final; do
  run_vitest 2 web "$WT" -t "room menu: $phase"
done

# --- Check 3: one diamond; the count as shorthand text, no pips ---------------------------------
# Re-scoped by the owner, 2026-10-30: "There shouldn't be pips in s67. BSO are just shorthand text as seen in the design".
defs="$(grep -rlE "export function BaseDiamond\(" web/src --include='*.tsx' | tr '\n' ' ')"
[ "$(echo "$defs" | wc -w | tr -d ' ')" = "1" ] || bad 3 "BaseDiamond is defined in: ${defs:-nowhere}"
grep -qw 'BaseDiamond' "$SLOT" 2>/dev/null || bad 3 "$SLOT does not render BaseDiamond"
grep -qw 'countShorthand' "$SLOT" 2>/dev/null || bad 3 "$SLOT does not write the count with countShorthand"
grep -qwE 'BsoPips|Pips' "$SLOT" 2>/dev/null && bad 3 "$SLOT draws pips"
grep -rqE 'export function countShorthand\(' packages/domain/src || bad 3 "packages/domain exports no countShorthand"
others="$(grep -rlE 'function [A-Za-z]*Diamond[A-Za-z]*\(' web/src --include='*.tsx' | grep -vE '/BaseDiamond\.tsx$' | tr '\n' ' ')"
[ -z "$others" ] || bad 3 "a second diamond component: $others"
run_vitest 3 packages/domain "$DT" -t "countShorthand"
run_vitest 3 web "$WT" -t "count"

# --- Check 4: the setting -----------------------------------------------------------------------
grep -qE 'gameRowSlot' packages/domain/src/settings.ts || bad 4 "AccountSettings has no gameRowSlot"
grep -qE 'export function setGameRowSlot\(' web/src/settings/store.ts || bad 4 "web/src/settings/store.ts has no setGameRowSlot"
grep -qF 'Game-Row Slot' web/src/pages/SettingsPage.tsx || bad 4 "SettingsPage has no Game-Row Slot control"
grep -qF 'Win Probability' web/src/pages/SettingsPage.tsx && bad 4 "SettingsPage offers Win Probability (left out at launch)"
run_vitest 4 web "$WT" -t "setting"
run_vitest 4 packages/domain src/settings.test.ts

# --- Check 5: no logos, no viewport -------------------------------------------------------------
for f in $(story_changed_files S67 "$BASE" web/src); do
  [ -f "$f" ] || continue
  grep -nE '<img[^>]*logo|mlbstatic|/logos/' "$f" >/dev/null && bad 5 "$f references a team logo"
  case "$f" in
    web/src/layout/*) ;;
    *) grep -nwE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" >/dev/null && bad 5 "$f reads the viewport" ;;
  esac
done

# --- Check 6: design match captures -------------------------------------------------------------
S="e2e/design/S67.spec.ts"
for fw in scoreboard-mobile:390 scoreboard-medium:768 scoreboard-desktop:1200 scoreboard-slot-room-menu-mobile:390; do
  name="${fw%%:*}"; w="${fw##*:}"; png="docs/v3/design-checks/S67/$name.png"
  grep -qF "\"$name\"" "$S" 2>/dev/null || bad 6 "$S does not name $name"
  if [ -f "$png" ]; then
    [ "$(png_width "$png")" = "$w" ] || bad 6 "$png is $(png_width "$png")px wide, want $w"
  else
    bad 6 "$png missing"
  fi
done

# --- Check 7: backlog Status is done ------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S67\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 7 "S67 row in the Story status table is not \`done\`"
awk '/^### S67 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md \
  | grep -qE '^\*\*Status:\*\* `done`$' ||
  bad 7 "S67 story heading Status is not \`done\`"

report "verify-S67"
exit $?
