#!/usr/bin/env bash
# Grader for BACKLOG story S124 — Games per day for a month, from BT's store. One request,
# `GET /api/v1/schedule/month/:month`, answers each day's game count from the stored schedule
# days in one query; missing current-season or future days are filled with one schedule-only
# range request through ingest's version-guarded write; freshness follows ADR-021's ladder from
# when the month last changed. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "GET /api/v1/schedule/month/:month (in api-routes.ts) answers every day of the month with its date and its stored schedule day's game count (games not yet final included, not the games table), in one repository query, tested on PGlite and the memory repos"
check 2 "missing current-season/future days are filled by one schedule-only range request (fetchScheduleRange on the port and every adapter), stored through storeSchedule (stampVersion), no fetchGame; a day still unknown is count null, distinct from 0 (empty month and month holding one day: one schedule request, no game request)"
check 3 "freshness: Cache-Control from the ADR-021 ladder (cacheLifetimeMs) by the month's last change, so a changed past month's headers reset; an empty future month gains its games after expiry with one schedule request and no game request"
check 4 "the route is in openapi/bt-api.v1.json, the committed spec is up to date (pnpm api:spec), and pnpm api:breaking exits 0"
check 5 "months before 1901-04 and malformed months (1901-4, 2026-13, 2026-00) answer 400, checked by isCalendarMonth beside isCalendarDate in packages/domain/src/calendar-date.ts, not a pattern in the handler"
check 6 "backlog Status is done (story heading and Story status table), and the story stays inside its scope files"

BASE=59b53edcee6a48fad76662dc5eed3108ce057a77
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SERVICE="functions/src/services/schedule-month.ts"
SERVICE_TEST="src/services/schedule-month.test.ts"
HANDLER="functions/src/handlers/api.ts"
ROUTE='GET /api/v1/schedule/month/:month'
# The month route's own entry in the router, from its `route:` line to the entry's closing `},`.
ROUTE_BLOCK="$TMP/month-route.ts"
sed -n '/route: "GET \/api\/v1\/schedule\/month\/:month"/,/^\t},$/p' "$HANDLER" >"$ROUTE_BLOCK"

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

# The story's own test file runs once; each AC then needs at least one passing test whose
# full name carries its tag ("S124 AC <n>"), and nothing in the file may fail.
SERVICE_JSON="$TMP/service.json"
SERVICE_OK=0
if [ -f "functions/$SERVICE_TEST" ] && (cd functions && pnpm exec vitest run "$SERVICE_TEST" --reporter=json --outputFile="$SERVICE_JSON" >"$TMP/service.log" 2>&1); then
  SERVICE_OK=1
fi
tagged() {
  local id="$1" tag="$2"
  if [ "$SERVICE_OK" != 1 ]; then
    bad "$id" "functions/$SERVICE_TEST missing or failing:"; tail -15 "$TMP/service.log" 2>/dev/null | sed 's/^/        /'
    return
  fi
  node -e '
    const r = require(process.argv[1]);
    const tag = process.argv[2];
    const hits = r.testResults.flatMap((f) => f.assertionResults).filter((t) => t.fullName.includes(tag));
    process.exit(hits.length > 0 && hits.every((t) => t.status === "passed") ? 0 : 1);
  ' "$SERVICE_JSON" "$tag" || bad "$id" "no passing test in functions/$SERVICE_TEST named \"$tag\""
}

# --- Check 1: the route, the counts, one query ----------------------------------------------------------
grep -qF "\"$ROUTE\": \"ScheduleMonthResponse\"" packages/domain/src/api-routes.ts || bad 1 "ApiRoutes has no \"$ROUTE\": \"ScheduleMonthResponse\""
grep -qF "route: \"$ROUTE\"" "$HANDLER" || bad 1 "the API router does not dispatch $ROUTE"
grep -qE 'export function monthGameCounts\(' packages/domain/src/schedule-month.ts 2>/dev/null || bad 1 "packages/domain/src/schedule-month.ts has no monthGameCounts (ADR-025: one implementation)"
grep -qE 'listGameCounts\(from: string, to: string\)' packages/ports/src/repositories.ts || bad 1 "ScheduleRepository has no listGameCounts(from, to)"
grep -qE 'jsonb_array_length' functions/src/adapters/postgres/repos.ts || bad 1 "the Postgres repository does not count games in the query (jsonb_array_length)"
grep -qE '\bgames\.(listByDate|getByPk)\(' "$SERVICE" 2>/dev/null && bad 1 "the month service reads the games table"
run_vitest 1 packages/domain src/schedule-month.test.ts
tagged 1 "S124 AC 1 memory"
tagged 1 "S124 AC 1 PGlite"
tagged 1 "S124 AC 1 one query"
run_vitest 1 functions src/handlers/route-table.test.ts

# --- Check 2: the fill --------------------------------------------------------------------------------------
grep -qE 'fetchScheduleRange\(startDate: string, endDate: string\)' packages/ports/src/mlb.ts || bad 2 "MlbStatsClient has no fetchScheduleRange(startDate, endDate)"
for f in functions/src/adapters/http/mlb.ts functions/src/adapters/fixtures/fixture-client.ts; do
  grep -qE 'async fetchScheduleRange\(' "$f" || bad 2 "$f has no fetchScheduleRange"
done
grep -qF 'fetchScheduleRange' functions/src/adapters/overlay-mlb.ts || bad 2 "overlayMlbClient has no fetchScheduleRange"
grep -qF 'startDate=' functions/src/adapters/http/mlb.ts || bad 2 "the HTTP adapter does not ask MLB for a startDate/endDate range"
grep -qF 'storeSchedule' "$SERVICE" 2>/dev/null || bad 2 "the month fill does not store days through storeSchedule"
grep -qF 'scheduleWindowMode' "$SERVICE" 2>/dev/null || bad 2 "the month fill does not decide windowMode with scheduleWindowMode"
grep -qE 'fetchGame\b|ingestScheduleDay|\.upsert\(' "$SERVICE" 2>/dev/null && bad 2 "the month fill hydrates games or writes a repository directly"
tagged 2 "S124 AC 2 empty month"
tagged 2 "S124 AC 2 holding one day"
tagged 2 "S124 AC 2 null"
tagged 2 "S124 AC 2 absent day"
run_vitest 2 functions src/adapters/http/mlb.test.ts -t "schedule range"
run_vitest 2 functions src/adapters/overlay-mlb.test.ts -t "schedule range"
run_vitest 2 functions src/adapters/fixtures/fixture-client.test.ts -t "schedule range"

# --- Check 3: freshness ----------------------------------------------------------------------------------------
grep -qF 'withCacheControl(' "$ROUTE_BLOCK" && grep -qF 'result.lastChangedAt' "$ROUTE_BLOCK" ||
  bad 3 "the month route does not set its Cache-Control from the month's last change (withCacheControl, ADR-021's ladder)"
tagged 3 "S124 AC 3 headers reset"
tagged 3 "S124 AC 3 gains games after expiry"

# --- Check 4: the spec ------------------------------------------------------------------------------------------
grep -qF '"/api/v1/schedule/month/{month}"' openapi/bt-api.v1.json || bad 4 "openapi/bt-api.v1.json has no /api/v1/schedule/month/{month} path"
if ! (cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1); then
  bad 4 "openapi/bt-api.v1.json is stale (pnpm api:spec):"; tail -5 "$TMP/spec.log" | sed 's/^/        /'
fi
pnpm -s api:breaking >"$TMP/breaking.log" 2>&1 || { bad 4 "pnpm api:breaking fails:"; tail -10 "$TMP/breaking.log" | sed 's/^/        /'; }
grep -qF '/api/v1/schedule/month/{month}' web/src/api/client.ts || bad 4 "web/src/api/client.ts has no client function for the month route"

# --- Check 5: the month parameter ---------------------------------------------------------------------------------
grep -qE 'export function isCalendarMonth\(' packages/domain/src/calendar-date.ts || bad 5 "packages/domain/src/calendar-date.ts has no isCalendarMonth"
for m in 1901-03 1901-04 1901-4 2026-13 2026-00; do
  grep -qF "\"$m\"" packages/domain/src/calendar-date.test.ts || bad 5 "the domain test does not try $m"
done
run_vitest 5 packages/domain src/calendar-date.test.ts -t "isCalendarMonth"
grep -qF 'if (!isCalendarMonth(' "$ROUTE_BLOCK" && grep -qF 'sendError(400' "$ROUTE_BLOCK" ||
  bad 5 "the month route's 400 does not come from isCalendarMonth"
story_diff S124 "$BASE" -U0 -- "$HANDLER" | grep -E '^\+' | grep -qE '\\d\{4\}-\\d\{2\}"?\)?\$?/' && bad 5 "the story adds a date pattern to the handler"
tagged 5 "S124 AC 5"

# --- Check 6: Status done, inside the fence ------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S124\].*\| `done` \|$' docs/v3/BACKLOG.md || bad 6 "S124 row in the Story status table is not \`done\`"
awk '/^### S124 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s124.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s124.md" || bad 6 "S124 story heading Status is not \`done\`"
story_changed_files S124 "$BASE" . | grep -vE '^(functions/src/|functions/vitest\.config\.ts$|packages/domain/|packages/ports/|openapi/|fixtures/|web/src/api/|docs/v3/BACKLOG\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S124\.sh$)' >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 6 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
# The Goal condition: nothing under the root test/ folder (functions/src/test/ is inside functions/src/).
story_changed_files S124 "$BASE" . | grep -E '^test/' >"$TMP/test-dir.txt"
[ -s "$TMP/test-dir.txt" ] && bad 6 "the story changes files under test/: $(tr '\n' ' ' <"$TMP/test-dir.txt")"

report "verify-S124"
exit $?
