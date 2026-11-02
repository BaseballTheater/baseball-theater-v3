#!/usr/bin/env bash
# Grader for BACKLOG story S71 — the day digest, "Best of <date>": dayDigest ranks a day's
# highlights across its games with the existing impact rule and marks the first watch-first;
# GET /api/v1/digest?date= serves it (route table, spec, no breaking change); the scoreboard
# shows rank, still, title, duration and one WATCH FIRST, and a click plays the clip in S70's
# dialog with a link to its game; Hide Scores leaves it as MLB writes it. A commit-time proof
# of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "dayDigest in packages/domain ranks a day's highlights with rankHighlightsByImpact and flags the first watch-first (test)"
check 2 "GET /api/v1/digest is in ApiRoutes, dispatched and in the generated spec; the route serves the digest (test); pnpm api:breaking exits 0"
check 3 "the scoreboard shows rank, still, title, duration and one WATCH FIRST; a click opens PlayerDialog with the clip's game link (RTL)"
check 4 "with Hide Scores on (through useScoresHidden) the digest renders the same, titles as MLB writes them (RTL)"
check 5 "files this story adds or edits reference no team logo and read no viewport outside web/src/layout/"
check 6 "design match: e2e/design/S71.spec.ts names scoreboard-mobile/-medium/-desktop and scoreboard-digest-hidden-nonotice-mobile; docs/v3/design-checks/S71/ holds them at their widths"
check 7 "backlog Status is done (story heading and Story status table)"

BASE=9d10688
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DT="src/components/scoreboard/DayDigest.test.tsx"

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

# --- Check 1: dayDigest --------------------------------------------------------------------------
grep -qE '^export function dayDigest\(' packages/domain/src/digest.ts 2>/dev/null || bad 1 "packages/domain/src/digest.ts exports no dayDigest"
grep -qw 'rankHighlightsByImpact' packages/domain/src/digest.ts 2>/dev/null || bad 1 "dayDigest does not rank with rankHighlightsByImpact"
grep -qE 'from "\./digest\.js"' packages/domain/src/index.ts || bad 1 "packages/domain's index does not export digest.ts"
run_vitest 1 packages/domain src/digest.test.ts -t "dayDigest"
run_vitest 1 packages/domain src/digest.test.ts -t "watch first"

# --- Check 2: the route ----------------------------------------------------------------------------
grep -qF '"GET /api/v1/digest"' packages/domain/src/api-routes.ts || bad 2 "ApiRoutes has no GET /api/v1/digest"
grep -qF 'route: "GET /api/v1/digest"' functions/src/handlers/api.ts || bad 2 "the API router does not dispatch GET /api/v1/digest"
grep -qF '"/api/v1/digest"' openapi/bt-api.v1.json || bad 2 "openapi/bt-api.v1.json has no /api/v1/digest path"
grep -qF '"/api/v1/digest"' web/src/api/client.ts || bad 2 "web/src/api/client.ts does not call /api/v1/digest"
run_vitest 2 functions src/handlers/api.test.ts -t "digest"
run_vitest 2 functions src/handlers/route-table.test.ts
run_vitest 2 web src/api/generated.types.test.ts
pnpm -s api:breaking >"$TMP/breaking.log" 2>&1 || { bad 2 "pnpm api:breaking fails:"; tail -8 "$TMP/breaking.log" | sed 's/^/        /'; }

# --- Check 3: the digest on the scoreboard ---------------------------------------------------------
grep -qw 'DayDigest' web/src/pages/ScoreboardPage.tsx || bad 3 "ScoreboardPage does not render DayDigest"
n="$(grep -rlE 'lazy\(\(\) => import\("\./PlayerDialog\.js"\)' web/src | wc -l | tr -d ' ')"
[ "$n" = "1" ] || bad 3 "$n files lazy-load PlayerDialog (want one shared wrapper)"
run_vitest 3 web "$DT" -t "digest"
run_vitest 3 web "$DT" -t "plays"

# --- Check 4: Hide Scores --------------------------------------------------------------------------
run_vitest 4 web "$DT" -t "hidden"

# --- Check 5: no logos, no viewport ----------------------------------------------------------------
for f in $(story_changed_files S71 "$BASE" web/src); do
  [ -f "$f" ] || continue
  grep -nE '<img[^>]*logo|/logos/' "$f" >/dev/null && bad 5 "$f references a team logo"
  case "$f" in
    web/src/layout/*) ;;
    *) grep -nwE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" >/dev/null && bad 5 "$f reads the viewport" ;;
  esac
done

# --- Check 6: design match captures ----------------------------------------------------------------
S="e2e/design/S71.spec.ts"
for fw in scoreboard-mobile:390 scoreboard-medium:768 scoreboard-desktop:1200 scoreboard-digest-hidden-nonotice-mobile:390; do
  name="${fw%%:*}"; w="${fw##*:}"; png="docs/v3/design-checks/S71/$name.png"
  grep -qF "\"$name\"" "$S" 2>/dev/null || bad 6 "$S does not name $name"
  if [ -f "$png" ]; then
    [ "$(png_width "$png")" = "$w" ] || bad 6 "$png is $(png_width "$png")px wide, want $w"
  else
    bad 6 "$png missing"
  fi
done

# --- Check 7: backlog Status is done ---------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S71\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 7 "S71 row in the Story status table is not \`done\`"
awk '/^### S71 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s71.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s71.md" || bad 7 "S71 story heading Status is not \`done\`"

report "verify-S71"
exit $?
