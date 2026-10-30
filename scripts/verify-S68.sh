#!/usr/bin/env bash
# Grader for BACKLOG story S68 — collapse non-favorites and Hide Scores on the scoreboard:
# non-favorite games fold into slim bars that expand on click; Hide Scores masks scores,
# records and the pitchers of record, decided by one function (`shouldHideScores`) behind
# one hook. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "scoreboardRows(games, favoriteTeamIds, collapseNonFavorites) in packages/domain marks non-favorite games collapsed; with no favorites nothing collapses (test)"
# Check 2 re-scoped by the owner, 2026-10-30: the bar centered — "NYY  5 - 2  BOS, with the BSO subtly under it" — and the favorite full-width on desktop.
check 2 "a collapsed bar is centered: swatches and abbreviations either side of {away}–{home} (@ when hidden or before runs), the inning and count or Final or start time under it; it expands to the full module on click; at medium / desktop a favorite's module spans the row (RTL)"
check 3 "Hide Scores on: R·H·E show –, records ▒▒-▒▒, pitchers of record masked while count, AB / P and probables stay; collapsed bars show the state only; same module structure (RTL); no \"Scores hidden in settings\" text; one HiddenValue component"
check 4 "shouldHideScores(settings, game?) in packages/domain (tested on, off, with and without a game); one useScoresHidden(game?) hook in web/src/settings/; nothing else reads the Hide Scores setting"
check 5 "Settings → Game List toggles for Collapse Non-Favorites and Hide Scores save to the account and update a mounted scoreboard without reload (test)"
check 6 "files this story adds or edits have no team logo and no useMediaQuery / hiddenFrom / visibleFrom outside web/src/layout/"
check 7 "design match: e2e/design/S68.spec.ts names the collapsed and scores-hidden frames it builds; docs/v3/design-checks/S68/ holds them at their pairing widths"
check 8 "backlog Status is done (story heading and Story status table)"

BASE=6ae2e0c
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
WT="src/components/scoreboard/CollapseHide.test.tsx"

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

# --- Check 1: the row ordering / collapse function ----------------------------------------------
grep -rqE 'export function scoreboardRows\(' packages/domain/src || bad 1 "packages/domain exports no scoreboardRows"
grep -qE 'describe\("scoreboardRows' packages/domain/src/scoreboard-rows.test.ts 2>/dev/null || bad 1 "packages/domain/src/scoreboard-rows.test.ts has no describe(\"scoreboardRows…\")"
run_vitest 1 packages/domain src/scoreboard-rows.test.ts
grep -qw 'scoreboardRows' web/src/pages/ScoreboardPage.tsx || bad 1 "ScoreboardPage does not lay out rows with scoreboardRows"

# --- Check 2: the collapsed bar -----------------------------------------------------------------
grep -qE 'export function CollapsedBar\(' web/src/components/scoreboard/CollapsedBar.tsx 2>/dev/null || bad 2 "web/src/components/scoreboard/CollapsedBar.tsx exports no CollapsedBar"
grep -qw 'inningLabel' web/src/components/scoreboard/CollapsedBar.tsx 2>/dev/null || bad 2 "CollapsedBar does not read the state through inningLabel"
run_vitest 2 web "$WT" -t "collapsed bar"
run_vitest 2 web "$WT" -t "expands"

# --- Check 3: the masks -------------------------------------------------------------------------
defs="$(grep -rlE 'export function HiddenValue\(' web/src --include='*.tsx' | tr '\n' ' ')"
[ "$(echo "$defs" | wc -w | tr -d ' ')" = "1" ] || bad 3 "HiddenValue is defined in: ${defs:-nowhere}"
masks="$(grep -rlE '▒' web/src --include='*.tsx' --include='*.ts' | grep -v '\.test\.' | tr '\n' ' ')"
[ "$masks" = "${defs}" ] || bad 3 "the ▒ mask is drawn outside HiddenValue: $masks"
said="$(grep -rlF 'Scores hidden in settings' web/src | tr '\n' ' ')"
[ -z "$said" ] || bad 3 "\"Scores hidden in settings\" appears in: $said"
run_vitest 3 web "$WT" -t "hidden"
run_vitest 3 web "$WT" -t "structure"

# --- Check 4: one function, one hook ------------------------------------------------------------
grep -rqE 'export function shouldHideScores\(' packages/domain/src || bad 4 "packages/domain exports no shouldHideScores"
grep -qE 'describe\("shouldHideScores' packages/domain/src/hide-scores.test.ts 2>/dev/null || bad 4 "packages/domain/src/hide-scores.test.ts has no describe(\"shouldHideScores…\")"
run_vitest 4 packages/domain src/hide-scores.test.ts
hooks="$(grep -rlE 'export function useScoresHidden\(' web/src | tr '\n' ' ')"
[ "$hooks" = "web/src/settings/useScoresHidden.ts " ] || bad 4 "useScoresHidden is defined in: ${hooks:-nowhere}"
grep -qw 'shouldHideScores' web/src/settings/useScoresHidden.ts 2>/dev/null || bad 4 "useScoresHidden does not ask shouldHideScores"
readers="$( { grep -rlE '\.hideScores\b|\bhideScores\b' web/src --include='*.ts' --include='*.tsx' | grep -vE '\.test\.|/api/generated/|^web/src/settings/store\.ts$|^web/src/pages/SettingsPage\.tsx$';
  grep -rlE '\.hideScores\b' packages/domain/src | grep -vE '\.test\.|/settings\.ts$|/hide-scores\.ts$'; } | tr '\n' ' ')"
[ -z "$readers" ] || bad 4 "reads the Hide Scores setting directly: $readers"

# --- Check 5: the toggles -----------------------------------------------------------------------
for f in collapseNonFavorites hideScores; do
  grep -qE "$f" packages/domain/src/settings.ts || bad 5 "AccountSettings has no $f"
done
grep -qF 'Collapse Non-Favorites' web/src/pages/SettingsPage.tsx || bad 5 "SettingsPage has no Collapse Non-Favorites toggle"
grep -qF 'Hide Scores' web/src/pages/SettingsPage.tsx || bad 5 "SettingsPage has no Hide Scores toggle"
run_vitest 5 web "$WT" -t "toggles"
run_vitest 5 packages/domain src/settings.test.ts

# --- Check 6: no logos, no viewport -------------------------------------------------------------
for f in $(story_changed_files S68 "$BASE" web/src); do
  [ -f "$f" ] || continue
  grep -nE '<img[^>]*logo|/logos/' "$f" >/dev/null && bad 6 "$f references a team logo"
  case "$f" in
    web/src/layout/*) ;;
    *) grep -nwE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" >/dev/null && bad 6 "$f reads the viewport" ;;
  esac
done

# --- Check 7: design match captures -------------------------------------------------------------
S="e2e/design/S68.spec.ts"
for fw in scoreboard-collapsed-score-mobile:390 scoreboard-collapsed-medium:768 scoreboard-collapsed-desktop:1200 \
  scoreboard-slots-hidden-nonotice-mobile:390 scoreboard-scores-hidden-medium:768 scoreboard-scores-hidden-desktop:1200 \
  scoreboard-collapsed-hidden-nonotice-mobile:390; do
  name="${fw%%:*}"; w="${fw##*:}"; png="docs/v3/design-checks/S68/$name.png"
  grep -qF "\"$name\"" "$S" 2>/dev/null || bad 7 "$S does not name $name"
  if [ -f "$png" ]; then
    [ "$(png_width "$png")" = "$w" ] || bad 7 "$png is $(png_width "$png")px wide, want $w"
  else
    bad 7 "$png missing"
  fi
done

# --- Check 8: backlog Status is done ------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S68\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 8 "S68 row in the Story status table is not \`done\`"
awk '/^### S68 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md \
  | grep -qE '^\*\*Status:\*\* `done`$' ||
  bad 8 "S68 story heading Status is not \`done\`"

report "verify-S68"
exit $?
