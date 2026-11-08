#!/usr/bin/env bash
# Grader for BACKLOG story S128 — Standings follow the season: the day's table in the regular
# season, the season's final table from the day after it until the next spring starts, and
# spring training's table in the spring (owner, 2026-11-07). One domain function picks the
# phase from S111's season calendar (extended with the regular season's dates); the API asks
# MLB for that shape, falls back to the previous phase's table when the picked one is empty,
# and says which table it returned. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "standingsPhase(day, seasons) in packages/domain picks regularSeason / final / spring at every boundary (2025, 2026, 2027 calendars; early opener; next season unpublished; no calendar); SeasonCalendar carries regularSeasonStartDate/EndDate; dev-seed reads the calendar's regular-season end, no second implementation"
check 2 "GET /api/v1/standings answers the picked shape for ?date= or MLB's today: final (season, no date), spring (standingsTypes=springTraining), regular (standingsUrl), each one MlbStatsClient method with a named URL function the recorder also uses; payload carries phase, season and the table's date; past dates use their own calendars; spec has phase; pnpm api:breaking exits 0"
check 3 "an empty spring or regular-season table falls back to the previous phase's table, and phase/season/date describe the table returned (2027-02-19 morning: final, 2026, 2026-09-27)"
check 4 "fixtures/raw/standings-2026-final.json and standings-2026-spring.json (30 teams each), seasons-2027.json and worldseries-2027.json are committed, read by the fixture client, gated by the coverage test and scanned by pnpm mlb:scan-drift"
check 5 "every shape lists divisions AL East, Central, West, then NL East, Central, West: the spring recording reordered, the 2026-09-05 fixture unchanged"
check 6 "MLB request budget: at most two calendars (four requests) plus one standings request, plus one only for the fallback (counting client)"
check 7 "with no calendar the day's regular-season standings are served; an MLB error stays an error"
check 8 "no visual change: the story changes nothing under web/src outside web/src/api, and nothing outside its scope files"
check 9 "backlog Status is done (story heading and Story status table)"

BASE=bb38898fa27e7fac4cea6779dad28e08619de1e3
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DOMAIN_FN="packages/domain/src/standings-phase.ts"
DOMAIN_TEST="src/standings-phase.test.ts"
SERVICE_TEST="src/services/standings.test.ts"
MLB="functions/src/adapters/http/mlb.ts"

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

# --- Check 1: the phase rule -------------------------------------------------------------------------
grep -qE 'export function standingsPhase\(' "$DOMAIN_FN" 2>/dev/null || bad 1 "$DOMAIN_FN does not export standingsPhase"
grep -qF 'standings-phase.js' packages/domain/src/index.ts || bad 1 "packages/domain/src/index.ts does not export standings-phase"
grep -qE 'regularSeasonStartDate\??:' packages/domain/src/scoreboard-date.ts || bad 1 "SeasonCalendar has no regularSeasonStartDate"
grep -qE 'regularSeasonEndDate\??:' packages/domain/src/scoreboard-date.ts || bad 1 "SeasonCalendar has no regularSeasonEndDate"
grep -qF 'regularSeasonEndDate' functions/src/mappers/season-calendar.ts || bad 1 "mapSeasonCalendar does not carry regularSeasonEndDate"
grep -qE 'seasons\[0\]\?\.regularSeasonEndDate' "$MLB" && bad 1 "$MLB still reads regularSeasonEndDate in a second implementation"
grep -qF 'fetchRegularSeasonEndDate' functions/src/services/dev-seed.ts && bad 1 "dev-seed.ts still asks fetchRegularSeasonEndDate instead of the calendar"
for t in "last regular-season day" "day after the regular season" "postseason day" "January day" "day before spring" "first spring day" "day before the regular season" "first regular-season day" "early opener" "next season unpublished" "no calendar"; do
  run_vitest 1 packages/domain "$DOMAIN_TEST" -t "$t"
done
run_vitest 1 functions src/mappers/season-calendar.test.ts -t "regular season"
run_vitest 1 functions src/services/dev-seed.test.ts

# --- Check 2: the route answers the picked shape -----------------------------------------------------------
grep -qE 'export function finalStandingsUrl\(' "$MLB" || bad 2 "$MLB has no finalStandingsUrl"
grep -qE 'export function springStandingsUrl\(' "$MLB" || bad 2 "$MLB has no springStandingsUrl"
grep -qF 'standingsTypes=springTraining' "$MLB" || bad 2 "springStandingsUrl does not ask standingsTypes=springTraining"
grep -qE 'fetchFinalStandings\(season: number' packages/ports/src/mlb.ts || bad 2 "MlbStatsClient has no fetchFinalStandings(season)"
grep -qE 'fetchSpringStandings\(season: number, date: string' packages/ports/src/mlb.ts || bad 2 "MlbStatsClient has no fetchSpringStandings(season, date)"
for f in "$MLB" functions/src/adapters/fixtures/fixture-client.ts; do
  grep -qE 'async fetchFinalStandings\(' "$f" || bad 2 "$f has no fetchFinalStandings"
  grep -qE 'async fetchSpringStandings\(' "$f" || bad 2 "$f has no fetchSpringStandings"
done
grep -qF 'finalStandingsUrl' functions/src/services/recorder.ts || bad 2 "the recorder does not record finalStandingsUrl"
grep -qF 'springStandingsUrl' functions/src/services/recorder.ts || bad 2 "the recorder does not record springStandingsUrl"
grep -qE 'phase\?: StandingsPhaseName|phase\?: "regularSeason"' packages/domain/src/types.ts || bad 2 "StandingsSnapshot has no optional phase"
grep -qE 'season\?: number' packages/domain/src/types.ts || bad 2 "StandingsSnapshot has no optional season"
node -e '
const s = require("./openapi/bt-api.v1.json");
const t = JSON.stringify(s);
process.exit(t.includes("\"regularSeason\"") && t.includes("\"springTraining\"") === false && t.includes("\"final\"") && t.includes("\"spring\"") ? 0 : 1);
' || bad 2 "openapi/bt-api.v1.json does not describe phase regularSeason | final | spring"
grep -A12 'route: "GET /api/v1/standings"' functions/src/handlers/api.ts | grep -qF 'toISOString().slice(0, 10)' && bad 2 "the standings route still uses the UTC day"
for t in "final table" "spring table" "regular-season table" "past date" "MLB's today"; do
  run_vitest 2 functions "$SERVICE_TEST" -t "$t"
done
run_vitest 2 functions src/handlers/api.test.ts -t "standings"
run_vitest 2 functions src/services/recorder.test.ts -t "standings"
run_vitest 2 functions src/adapters/http/mlb.test.ts -t "standings"
pnpm -s api:breaking >"$TMP/breaking.log" 2>&1 || { bad 2 "pnpm api:breaking fails:"; tail -10 "$TMP/breaking.log" | sed 's/^/        /'; }

# --- Check 3: an empty table falls back --------------------------------------------------------------------
run_vitest 3 functions "$SERVICE_TEST" -t "empty"

# --- Check 4: recordings ---------------------------------------------------------------------------------
for f in standings-2026-final standings-2026-spring seasons-2027 worldseries-2027; do
  [ -f "fixtures/raw/$f.json" ] || bad 4 "fixtures/raw/$f.json missing"
  grep -qF "$f.json" packages/mlb-api/src/coverage.test.ts || bad 4 "the coverage gate does not check $f.json"
done
for f in standings-2026-final standings-2026-spring; do
  [ -f "fixtures/raw/$f.json" ] || continue
  n="$(node -e 'const r=require(process.argv[1]).records||[];process.stdout.write(String(r.reduce((a,g)=>a+(g.teamRecords||[]).length,0)))' "./fixtures/raw/$f.json")"
  [ "$n" = 30 ] || bad 4 "fixtures/raw/$f.json has $n teams, want 30"
done
grep -qF '"springStartDate":"2027-02-19"' fixtures/raw/seasons-2027.json 2>/dev/null || bad 4 "seasons-2027.json is not MLB's 2027 calendar (spring 2027-02-19)"
run_vitest 4 functions src/adapters/fixtures/fixture-client.test.ts -t "standings"
run_vitest 4 packages/mlb-api src/coverage.test.ts
if pnpm -s mlb:scan-drift >"$TMP/drift.log" 2>&1; then
  for f in standings-2026-final standings-2026-spring seasons-2027 worldseries-2027; do
    grep -qE "^  $f\.json$" "$TMP/drift.log" || bad 4 "pnpm mlb:scan-drift does not scan $f.json"
  done
else
  bad 4 "pnpm mlb:scan-drift reports drift:"; tail -10 "$TMP/drift.log" | sed 's/^/        /'
fi

# --- Check 5: division order -------------------------------------------------------------------------------
run_vitest 5 functions src/mappers/standings.test.ts -t "division order"

# --- Check 6: request budget --------------------------------------------------------------------------------
run_vitest 6 functions "$SERVICE_TEST" -t "request budget"

# --- Check 7: no calendar, MLB errors -----------------------------------------------------------------------
run_vitest 7 functions "$SERVICE_TEST" -t "no calendar"
run_vitest 7 functions "$SERVICE_TEST" -t "MLB error"

# --- Check 8: no visual change, inside the fence -------------------------------------------------------------
story_changed_files S128 "$BASE" web/src | grep -v '^web/src/api/' >"$TMP/web.txt"
[ -s "$TMP/web.txt" ] && bad 8 "the story changes web code outside web/src/api: $(tr '\n' ' ' <"$TMP/web.txt")"
story_changed_files S128 "$BASE" . | grep -vE '^(functions/src/|functions/vitest\.config\.ts$|packages/domain/|packages/ports/|packages/mlb-api/|fixtures/|openapi/|web/src/api/|docs/v3/BACKLOG\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S128\.sh$|docs/v3/\.obsidian/)' >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 8 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"

# --- Check 9: backlog Status is done ---------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S128\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 9 "S128 row in the Story status table is not \`done\`"
awk '/^### S128 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s128.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s128.md" || bad 9 "S128 story heading Status is not \`done\`"

report "verify-S128"
exit $?
