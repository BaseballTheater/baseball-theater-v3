#!/usr/bin/env bash
# Grader for BACKLOG story S66 — the scoreboard to the ratified shell-scoreboard frames:
# one ScoreboardModule for final, live and scheduled games (team-color edges, records,
# R·H·E, the live dot with the inning, start time and venue before first pitch), one
# column on mobile and two on medium / desktop, the date control, and the loading /
# empty / error states. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "one ScoreboardModule renders final (FINAL, R·H·E, ABBR (W-L)), live (LiveIndicator + inningLabel) and scheduled (formatGameTime, venue, W - L (.pct)) games, venue on scheduled only (RTL on the S65 fixtures, the folded moments committed and drift-checked)"
check 2 "each team row has a TeamEdge colored by contrastSafeTeamColor (RTL asserts the style)"
check 3 "one column at mobile, two at medium / desktop (RTL via variant)"
check 4 "the date control's previous / next navigate to /games/<date ± 1> (test)"
check 5 "empty, loading (title kept) and error (Couldn't load games, hint, Retry refetches) use ViewState (a test per state)"
check 6 "teamRecordLabel and inningLabel live in packages/domain with tests; the scoreboard files pass the no-domain-arithmetic lint rule"
check 7 "a render-count baseline is recorded for one schedule update"
check 8 "files this story adds or edits have no team logo and no useMediaQuery / hiddenFrom / visibleFrom outside web/src/layout/"
check 9 "design match: e2e/design/S66.spec.ts names the scoreboard, empty, loading and error frames at each pairing; docs/v3/design-checks/S66/ holds them at 390/768/1200"
check 10 "one date formatter: formatDate in web/src/format/datetime.ts prints calendar dates too, formatOfficialDate is gone, the date control formats through it, and no month table or Intl.DateTimeFormat date formatter sits under web/src/components/ or web/src/pages/"
check 11 "backlog Status is done (story heading and Story status table)"

BASE=989e767
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
WT="src/pages/ScoreboardPage.test.tsx"
DT="src/team-record.test.ts"
MOD="web/src/components/scoreboard/ScoreboardModule.tsx"
DC="web/src/components/scoreboard/DateControl.tsx"
PAGE="web/src/pages/ScoreboardPage.tsx"

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

# --- Check 1: one ScoreboardModule, three phases, on the S65 fixtures ---------------------------
defs="$(grep -rlE 'export function ScoreboardModule\(' web/src --include='*.tsx' | tr '\n' ' ')"
[ "$defs" = "$MOD " ] || bad 1 "ScoreboardModule is defined in: ${defs:-nowhere}"
grep -qw 'ScoreboardModule' "$PAGE" 2>/dev/null || bad 1 "$PAGE does not render ScoreboardModule"
for f in teamRecordLabel inningLabel formatGameTime LiveIndicator; do
  grep -qw "$f" "$MOD" 2>/dev/null || bad 1 "$MOD does not use $f"
done
for fx in schedule-2026-09-05.json schedule-823823-moments.json; do
  grep -qF "$fx" "web/$WT" 2>/dev/null || bad 1 "web/$WT does not read fixtures/$fx"
done
[ -f fixtures/schedule-823823-moments.json ] || bad 1 "fixtures/schedule-823823-moments.json missing"
grep -qF 'schedule-823823-moments.json' functions/src/services/schedule-fixture.test.ts || bad 1 "schedule-fixture.test.ts does not regenerate fixtures/schedule-823823-moments.json"
run_vitest 1 functions src/services/schedule-fixture.test.ts -t "moments"
run_vitest 1 web "$WT" -t "final"
run_vitest 1 web "$WT" -t "live"
run_vitest 1 web "$WT" -t "scheduled"
run_vitest 1 web "$WT" -t "venue"

# --- Check 2: team-color edges ------------------------------------------------------------------
grep -qw 'TeamEdge' "$MOD" 2>/dev/null || bad 2 "$MOD does not render TeamEdge"
grep -qw 'contrastSafeTeamColor' "web/$WT" 2>/dev/null || bad 2 "web/$WT does not assert contrastSafeTeamColor"
run_vitest 2 web "$WT" -t "edge"

# --- Check 3: columns by variant ----------------------------------------------------------------
run_vitest 3 web "$WT" -t "columns"

# --- Check 4: the date control ------------------------------------------------------------------
[ -f "$DC" ] || bad 4 "$DC missing"
grep -qw 'DateControl' "$PAGE" 2>/dev/null || bad 4 "$PAGE does not render DateControl"
run_vitest 4 web "$WT" -t "date control"

# --- Check 5: the three states through ViewState ------------------------------------------------
grep -qw 'ViewState' "$PAGE" 2>/dev/null || bad 5 "$PAGE does not use ViewState"
grep -qF 'No games scheduled for this date.' "$PAGE" 2>/dev/null || bad 5 "$PAGE has no empty-state sentence"
grep -qF "Couldn't load games" "$PAGE" 2>/dev/null || bad 5 "$PAGE has no error title"
run_vitest 5 web "$WT" -t "empty"
run_vitest 5 web "$WT" -t "loading"
run_vitest 5 web "$WT" -t "error"

# --- Check 6: domain labels and no arithmetic in views ------------------------------------------
grep -rqE 'export function teamRecordLabel\(' packages/domain/src || bad 6 "packages/domain exports no teamRecordLabel"
grep -qE 'export function inningLabel\(' packages/domain/src/inning.ts || bad 6 "packages/domain/src/inning.ts exports no inningLabel"
grep -qE 'describe\("teamRecordLabel' "packages/domain/$DT" 2>/dev/null || bad 6 "packages/domain/$DT has no describe(\"teamRecordLabel…\")"
grep -qE 'inningLabel' packages/domain/src/inning.test.ts || bad 6 "packages/domain/src/inning.test.ts does not test inningLabel"
run_vitest 6 packages/domain "$DT"
run_vitest 6 packages/domain src/inning.test.ts
lint_files=("$PAGE")
for f in web/src/components/scoreboard/*.tsx; do
  [ -f "$f" ] && lint_files+=("$f")
done
pnpm exec eslint "${lint_files[@]}" >"$TMP/lint.log" 2>&1 || { bad 6 "eslint fails on the scoreboard files:"; tail -10 "$TMP/lint.log" | sed 's/^/        /'; }

# --- Check 7: render-count baseline -------------------------------------------------------------
grep -qw 'createRenderCounter' "web/$WT" 2>/dev/null || bad 7 "web/$WT does not use createRenderCounter"
grep -qw 'writeScheduleDay' "web/$WT" 2>/dev/null || bad 7 "web/$WT does not write a schedule update"
run_vitest 7 web "$WT" -t "render count"

# --- Check 8: no logos, no viewport -------------------------------------------------------------
for f in $(story_changed_files S66 "$BASE" web/src); do
  [ -f "$f" ] || continue
  grep -nE '<img[^>]*logo|mlbstatic|/logos/' "$f" >/dev/null && bad 8 "$f references a team logo"
  case "$f" in
    web/src/layout/*) ;;
    *) grep -nwE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" >/dev/null && bad 8 "$f reads the viewport" ;;
  esac
done

# --- Check 9: design match captures -------------------------------------------------------------
S="e2e/design/S66.spec.ts"
for state in scoreboard scoreboard-empty scoreboard-loading scoreboard-error; do
  for pw in mobile:390 medium:768 desktop:1200; do
    name="$state-${pw%%:*}"; w="${pw##*:}"; png="docs/v3/design-checks/S66/$name.png"
    grep -qF "\"$name\"" "$S" 2>/dev/null || bad 9 "$S does not name $name"
    if [ -f "$png" ]; then
      [ "$(png_width "$png")" = "$w" ] || bad 9 "$png is $(png_width "$png")px wide, want $w"
    else
      bad 9 "$png missing"
    fi
  done
done

# --- Check 10: one date formatter ---------------------------------------------------------------
grep -qE '^export function formatDate\(' web/src/format/datetime.ts || bad 10 "web/src/format/datetime.ts exports no formatDate"
left="$(grep -rlw 'formatOfficialDate' web/src | tr '\n' ' ')"
[ -z "$left" ] || bad 10 "formatOfficialDate still appears in: $left"
grep -qE "from \"\.\./\.\./format/datetime\.js\"" "$DC" 2>/dev/null || bad 10 "$DC does not format its label through web/src/format/datetime.ts"
tables="$(grep -rlE '"Jan", *"Feb"|Intl\.DateTimeFormat' web/src/components web/src/pages | grep -v '\.test\.' | tr '\n' ' ')"
[ -z "$tables" ] || bad 10 "a month table or Intl.DateTimeFormat outside web/src/format/: $tables"
grep -qE 'Sep 5, 2026' web/src/format/datetime.test.ts 2>/dev/null || bad 10 "web/src/format/datetime.test.ts does not pin a calendar date as Sep 5, 2026"
run_vitest 10 web src/format/datetime.test.ts

# --- Check 11: backlog Status is done -----------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S66\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 11 "S66 row in the Story status table is not \`done\`"
awk '/^### S66 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md \
  | grep -qE '^\*\*Status:\*\* `done`$' ||
  bad 11 "S66 story heading Status is not \`done\`"

report "verify-S66"
exit $?
