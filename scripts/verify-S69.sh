#!/usr/bin/env bash
# Grader for BACKLOG story S69 — the Videos room to the ratified game-shell frames: a
# 2 / 3 / 4-column grid of video stills by pairing, a List mode built from the same card,
# search, and the Featured team and Stat / viz quick filters, impact order kept; no
# Filter button (A1). MediaHighlight gains kind, date, team ids and tags from MLB's
# content keywords. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "MediaHighlight additively gains kind, date, teamIds and tags, mapped from fixtures/raw/content-823823.json (regeneration test; pnpm api:breaking exits 0)"
check 2 "the grid has 2 / 3 / 4 columns at mobile / medium / desktop; List mode shows rows of the same VideoCard (RTL; one card component)"
# Checks 3 and 4 re-scoped by the owner, 2026-10-30: "Add a sort option to the left of the grid/list option" and, for the
# filters, "If not, show as many as possible with the last item being a Filters button that opens a drawer from the bottom".
check 3 "search filters by title or blurb through filterHighlights in packages/domain; the quick filters use classifyHighlight there; impact order by default, and the sort reorders through sortHighlights (tests)"
check 4 "the quick filters show as many as fit, then a last Filters button opening a bottom drawer with every filter and Apply (RTL); the empty state reads \"No videos yet.\" via ViewState"
check 5 "a card is a button that calls onPlay(highlight) (test)"
check 6 "files this story adds or edits have no team logo and no useMediaQuery / hiddenFrom / visibleFrom outside web/src/layout/"
check 7 "design match: e2e/design/S69.spec.ts names game-videos-grid-mobile / -medium / -desktop and game-videos-list-mobile; docs/v3/design-checks/S69/ holds them at 390/768/1200/390"
check 8 "backlog Status is done (story heading and Story status table)"

BASE=e09fd93
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
WT="src/components/videos/VideosRoom.test.tsx"
DT="src/highlights.test.ts"
ROOM="web/src/components/videos/VideosRoom.tsx"
CARD="web/src/components/videos/VideoCard.tsx"

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

# --- Check 1: the new highlight fields, mapped and regenerated ----------------------------------
block="$(awk '/^export type MediaHighlight = \{/{f=1} f{print} f&&/^\};/{exit}' packages/domain/src/types.ts)"
for field in kind date teamIds tags; do
  echo "$block" | grep -qE "^\s+$field\??:" || bad 1 "MediaHighlight has no $field"
done
grep -qE 'keywordsAll' functions/src/mappers/content.ts || bad 1 "functions/src/mappers/content.ts does not read keywordsAll"
n="$(grep -o '"teamIds"' fixtures/game-823823.json | wc -l | tr -d ' ')"
[ "$n" -ge 40 ] || bad 1 "fixtures/game-823823.json carries teamIds on $n highlights, want all 40"
grep -qE '"kind": "recap"' fixtures/game-823823.json || bad 1 "fixtures/game-823823.json has no recap-kind highlight"
run_vitest 1 functions src/services/fixture-823823.test.ts -t "regenerates"
run_vitest 1 functions src/mappers/content.test.ts -t "keywords"
pnpm -s api:breaking >"$TMP/breaking.log" 2>&1 || { bad 1 "pnpm api:breaking fails:"; tail -8 "$TMP/breaking.log" | sed 's/^/        /'; }

# --- Check 2: grid by pairing, list of the same card --------------------------------------------
defs="$(grep -rlE 'export function [A-Za-z]*(Card|Row|Tile)\(' web/src/components/videos --include='*.tsx' 2>/dev/null | tr '\n' ' ')"
[ "$defs" = "$CARD " ] || bad 2 "video card components under web/src/components/videos: ${defs:-none}"
grep -qE 'export function VideoCard\(' "$CARD" 2>/dev/null || bad 2 "$CARD exports no VideoCard"
grep -qw 'VideoCard' "$ROOM" 2>/dev/null || bad 2 "$ROOM does not render VideoCard"
run_vitest 2 web "$WT" -t "columns"
run_vitest 2 web "$WT" -t "list"

# --- Check 3: search and quick filters in packages/domain ---------------------------------------
for f in filterHighlights classifyHighlight sortHighlights; do
  grep -rqE "export function $f\(" packages/domain/src || bad 3 "packages/domain exports no $f"
  grep -qE "describe\(\"$f" "packages/domain/$DT" 2>/dev/null || bad 3 "packages/domain/$DT has no describe(\"${f}…\")"
done
grep -qw 'filterHighlights' "$ROOM" 2>/dev/null || bad 3 "$ROOM does not filter with filterHighlights"
grep -qw 'classifyHighlight' packages/domain/src/highlights.ts 2>/dev/null || bad 3 "packages/domain/src/highlights.ts missing or does not use classifyHighlight"
run_vitest 3 packages/domain "$DT"
run_vitest 3 packages/domain "$DT" -t "impact"
run_vitest 3 web "$WT" -t "search"
run_vitest 3 web "$WT" -t "quick filter"
grep -qw 'sortHighlights' "$ROOM" 2>/dev/null || bad 3 "$ROOM does not sort with sortHighlights"
run_vitest 3 web "$WT" -t "sort"

# --- Check 4: no Filter button; empty state -----------------------------------------------------
grep -qF 'No videos yet.' "$ROOM" 2>/dev/null || bad 4 "$ROOM has no \"No videos yet.\""
grep -qw 'ViewState' "$ROOM" 2>/dev/null || bad 4 "$ROOM does not use ViewState"
run_vitest 4 web "$WT" -t "empty"
run_vitest 4 web "$WT" -t "filters overflow"
run_vitest 4 web src/components/videos/fit-filters.test.ts

# --- Check 5: a card plays through onPlay -------------------------------------------------------
grep -qw 'onPlay' "$CARD" 2>/dev/null || bad 5 "$CARD has no onPlay"
run_vitest 5 web "$WT" -t "onPlay"

# --- Check 6: no logos, no viewport -------------------------------------------------------------
for f in $(story_changed_files S69 "$BASE" web/src); do
  [ -f "$f" ] || continue
  grep -nE '<img[^>]*logo|/logos/' "$f" >/dev/null && bad 6 "$f references a team logo"
  case "$f" in
    web/src/layout/*) ;;
    *) grep -nwE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" >/dev/null && bad 6 "$f reads the viewport" ;;
  esac
done

# --- Check 7: design match captures -------------------------------------------------------------
S="e2e/design/S69.spec.ts"
for fw in game-videos-grid-mobile:390 game-videos-grid-medium:768 game-videos-grid-desktop:1200 game-videos-list-mobile:390; do
  name="${fw%%:*}"; w="${fw##*:}"; png="docs/v3/design-checks/S69/$name.png"
  grep -qF "\"$name\"" "$S" 2>/dev/null || bad 7 "$S does not name $name"
  if [ -f "$png" ]; then
    [ "$(png_width "$png")" = "$w" ] || bad 7 "$png is $(png_width "$png")px wide, want $w"
  else
    bad 7 "$png missing"
  fi
done

# --- Check 8: backlog Status is done ------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S69\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 8 "S69 row in the Story status table is not \`done\`"
awk '/^### S69 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md \
  | grep -qE '^\*\*Status:\*\* `done`$' ||
  bad 8 "S69 story heading Status is not \`done\`"

report "verify-S69"
exit $?
