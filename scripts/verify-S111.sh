#!/usr/bin/env bash
# Grader for BACKLOG story S111 — the scoreboard opens on today, or on the season's final day in
# the off-season: defaultScoreboardDate and MLB's "today" (America/New_York) in packages/domain,
# the season-calendar method on MlbStatsClient (parsed in packages/mlb-api from a recording),
# GET /api/v1/scoreboard/default-date, and the web's `/`, `/games` and ScoreboardPage using it,
# with ViewState while it loads and today as the fallback. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "defaultScoreboardDate(today, seasons) in packages/domain: today in season, the last postseason game's date until the next first spring game, and the final day when no next season is published (tests at each boundary)"
check 2 "MLB's today is the America/New_York date of an instant, computed in packages/domain (test across midnight UTC); no view names the zone"
check 3 "MlbStatsClient.fetchSeasonCalendar in the port, HTTP and fixture adapters; parseSeasonsResponse in packages/mlb-api from fixtures/raw/seasons-*.json (parse test, coverage); pnpm mlb:scan-drift clean and scans it; the fixture client serves it"
check 4 "GET /api/v1/scoreboard/default-date returns { date } (functions tests with a fixed clock, in and out of season); route table and spec; pnpm api:breaking exits 0"
check 5 "/ and /games open the default day and ScoreboardPage without a date uses it; 2024-07-04 is gone from routes.tsx and ScoreboardPage.tsx (RTL with the route stubbed)"
check 6 "ViewState loading while the default date loads; today in America/New_York when the route fails (RTL)"
check 7 "design match: e2e/design/S111.spec.ts names scoreboard-mobile opened from /; docs/v3/design-checks/S111/scoreboard-mobile.png exists at 390px"
check 8 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DOMAIN_FN="packages/domain/src/scoreboard-date.ts"
DOMAIN_TEST="src/scoreboard-date.test.ts"

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

# --- Check 1: the rule ------------------------------------------------------------------------------
grep -qE 'export function defaultScoreboardDate\(' "$DOMAIN_FN" 2>/dev/null || bad 1 "$DOMAIN_FN does not export defaultScoreboardDate"
grep -qF 'scoreboard-date.js' packages/domain/src/index.ts || bad 1 "packages/domain/src/index.ts does not export scoreboard-date"
for t in "day of the final" "day after the final" "day before the first spring game" "day of the first spring game" "no next season"; do
  run_vitest 1 packages/domain "$DOMAIN_TEST" -t "$t"
done

# --- Check 2: MLB's today ------------------------------------------------------------------------------
grep -qF 'America/New_York' "$DOMAIN_FN" 2>/dev/null || bad 2 "$DOMAIN_FN does not compute the date in America/New_York"
grep -qE 'export function mlbToday\(' "$DOMAIN_FN" 2>/dev/null || bad 2 "$DOMAIN_FN does not export mlbToday"
run_vitest 2 packages/domain "$DOMAIN_TEST" -t "midnight UTC"
# A zone in a string literal is code that computes in it; a comment naming one in backticks is not.
grep -rlE "[\"']America/New_York[\"']" web/src --include='*.tsx' --include='*.ts' 2>/dev/null | grep -v '\.test\.' >"$TMP/tz.txt"
[ -s "$TMP/tz.txt" ] && bad 2 "web code names America/New_York instead of calling mlbToday: $(tr '\n' ' ' <"$TMP/tz.txt")"

# --- Check 3: the season calendar ---------------------------------------------------------------------
grep -qE 'fetchSeasonCalendar\(season: number\)' packages/ports/src/mlb.ts || bad 3 "MlbStatsClient has no fetchSeasonCalendar(season: number)"
grep -qE 'async fetchSeasonCalendar\(' functions/src/adapters/http/mlb.ts || bad 3 "the HTTP adapter has no fetchSeasonCalendar"
grep -qF 'api/v1/seasons/' functions/src/adapters/http/mlb.ts || bad 3 "the HTTP adapter does not call /api/v1/seasons/{season}"
grep -qE 'async fetchSeasonCalendar\(' functions/src/adapters/fixtures/fixture-client.ts || bad 3 "the fixture client has no fetchSeasonCalendar"
grep -qE 'export function parseSeasonsResponse\(' packages/mlb-api/src/parse.ts || bad 3 "packages/mlb-api has no parseSeasonsResponse"
ls fixtures/raw/seasons-*.json >/dev/null 2>&1 || bad 3 "no recorded fixtures/raw/seasons-*.json"
grep -qF 'seasons-' packages/mlb-api/src/coverage.test.ts || bad 3 "the coverage gate does not check a seasons recording"
run_vitest 3 packages/mlb-api src/parse.test.ts -t "seasons"
run_vitest 3 packages/mlb-api src/coverage.test.ts
run_vitest 3 functions src/adapters/fixtures/fixture-client.test.ts -t "season calendar"
run_vitest 3 functions src/adapters/http/mlb.test.ts -t "season calendar"
if pnpm -s mlb:scan-drift >"$TMP/drift.log" 2>&1; then
  grep -qE '^  seasons-[0-9]{4}\.json$' "$TMP/drift.log" || bad 3 "pnpm mlb:scan-drift does not scan a seasons recording"
else
  bad 3 "pnpm mlb:scan-drift reports drift:"; tail -10 "$TMP/drift.log" | sed 's/^/        /'
fi

# --- Check 4: the route ---------------------------------------------------------------------------------
grep -qE '"GET /api/v1/scoreboard/default-date": "[A-Za-z]+"' packages/domain/src/api-routes.ts || bad 4 "ApiRoutes has no GET /api/v1/scoreboard/default-date"
grep -qF 'route: "GET /api/v1/scoreboard/default-date"' functions/src/handlers/api.ts || bad 4 "the API router does not dispatch GET /api/v1/scoreboard/default-date"
grep -qF 'defaultScoreboardDate' functions/src/services/*.ts functions/src/handlers/api.ts 2>/dev/null || bad 4 "functions does not call defaultScoreboardDate"
grep -qF '"/api/v1/scoreboard/default-date"' openapi/bt-api.v1.json || bad 4 "openapi/bt-api.v1.json has no /api/v1/scoreboard/default-date path"
run_vitest 4 functions src/handlers/api.test.ts -t "default date in season"
run_vitest 4 functions src/handlers/api.test.ts -t "default date in the off-season"
run_vitest 4 functions src/handlers/route-table.test.ts
pnpm -s api:breaking >"$TMP/breaking.log" 2>&1 || { bad 4 "pnpm api:breaking fails:"; tail -10 "$TMP/breaking.log" | sed 's/^/        /'; }

# --- Check 5: the web opens it ----------------------------------------------------------------------------
for f in web/src/routes.tsx web/src/pages/ScoreboardPage.tsx; do
  grep -qF '2024-07-04' "$f" && bad 5 "$f still names 2024-07-04"
done
grep -qF '/api/v1/scoreboard/default-date' web/src/api/client.ts || bad 5 "web/src/api/client.ts does not call /api/v1/scoreboard/default-date"
run_vitest 5 web src/routes.test.tsx -t "default day"
run_vitest 5 web src/pages/ScoreboardPage.test.tsx -t "without a date"

# --- Check 6: loading and fallback ------------------------------------------------------------------------
run_vitest 6 web src/pages/ScoreboardPage.test.tsx -t "default date loading"
run_vitest 6 web src/pages/ScoreboardPage.test.tsx -t "default date fails"

# --- Check 7: design match capture ------------------------------------------------------------------------
S="e2e/design/S111.spec.ts"
grep -qF '"scoreboard-mobile"' "$S" 2>/dev/null || bad 7 "$S does not name scoreboard-mobile"
grep -qE 'goto\("/"\)' "$S" 2>/dev/null || bad 7 "$S does not open the scoreboard from /"
grep -qF '/api/v1/scoreboard/default-date' "$S" 2>/dev/null || bad 7 "$S does not stub the default-date route"
PNG="docs/v3/design-checks/S111/scoreboard-mobile.png"
if [ -f "$PNG" ]; then
  [ "$(png_width "$PNG")" = 390 ] || bad 7 "$PNG is $(png_width "$PNG")px wide, want 390"
else
  bad 7 "$PNG missing"
fi

# --- Check 8: backlog Status is done ---------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S111\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 8 "S111 row in the Story status table is not \`done\`"
awk '/^### S111 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s111.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s111.md" || bad 8 "S111 story heading Status is not \`done\`"

report "verify-S111"
exit $?
