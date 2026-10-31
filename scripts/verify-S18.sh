#!/usr/bin/env bash
# Grader for BACKLOG story S18 — the live hub (ADR-020 layer 2, ADR-022): a LiveGameHub
# port with an in-memory adapter; the game-hub Durable Object on the Hibernation API,
# one-way; GET /api/v1/games/:gamePk/live upgrades only in-window games; only newer
# versions reach viewers, full state on connect when behind; cold start loads from the
# repository; first viewer registers with ingest, last disconnect unregisters. A
# commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "a LiveGameHub port in packages/ports (publish; connect a viewer by gamePk) with an in-memory adapter (test)"
check 2 "the game-hub Durable Object accepts sockets with acceptWebSocket and auto-answers pings with setWebSocketAutoResponse; client messages are ignored (test)"
check 3 "GET /api/v1/games/:gamePk/live upgrades only in-window games; others get a 4xx pointing at GET /api/v1/games/:gamePk (tests); it is a named streaming exception"
check 4 "workerd: publish v1, v1, v2 → a viewer receives exactly v1 and v2; ?since=1 after v2 receives v2; ?since=2 receives nothing"
check 5 "a freshly started hub loads the latest state through the repository port and sends it on connect (test)"
check 6 "the first viewer registers the hub with its game's ingest object; the last disconnect unregisters it (test with an ingest stub)"
check 7 "README.md names the live route, says streaming routes sit outside ApiRoutes and the OpenAPI spec, and that short-poll of the cached GET is the fallback"
check 8 "web/ contains no statsapi.mlb.com"
check 9 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
HT="src/game-hub-object.test.ts"

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

# --- Check 1: the port -------------------------------------------------------------------------
grep -rqE 'export interface LiveGameHub' packages/ports/src || bad 1 "packages/ports exports no LiveGameHub"
grep -rqE 'implements LiveGameHub' functions/src/adapters/memory 2>/dev/null || bad 1 "no in-memory LiveGameHub adapter under functions/src/adapters/memory"
run_vitest 1 functions src/adapters/memory/live-hub.test.ts

# --- Check 2: hibernation, one-way -------------------------------------------------------------
grep -qw 'acceptWebSocket' functions/src/game-hub-object.ts 2>/dev/null || bad 2 "game-hub-object.ts does not call acceptWebSocket"
grep -qw 'setWebSocketAutoResponse' functions/src/game-hub-object.ts 2>/dev/null || bad 2 "game-hub-object.ts does not call setWebSocketAutoResponse"
run_vitest 2 functions "$HT" -t "ignored"
run_vitest 2 functions "$HT" -t "hibernation"

# --- Check 3: the route -------------------------------------------------------------------------
grep -qF '"GET /api/v1/games/:gamePk/live"' functions/src/handlers/api.ts || bad 3 "the live route is not dispatched / named a streaming exception in handlers/api.ts"
run_vitest 3 functions src/handlers/live.test.ts -t "in-window"
run_vitest 3 functions src/handlers/live.test.ts -t "out of window"
run_vitest 3 functions src/handlers/route-table.test.ts

# --- Check 4: workerd versions -----------------------------------------------------------------
W="src/game-hub.workerd.test.ts"
if [ ! -f "functions/$W" ]; then
  bad 4 "functions/$W missing"
elif ! (cd functions && pnpm exec vitest run --config vitest.workers.config.ts "$W" --reporter=json --outputFile="$TMP/w.json" >"$TMP/w.log" 2>&1); then
  bad 4 "$W failed:"; tail -15 "$TMP/w.log" | sed 's/^/        /'
elif ! node -e 'const r=require(process.argv[1]);process.exit(r.numPassedTests >= 2 && r.numFailedTests === 0 ? 0 : 1)' "$TMP/w.json"; then
  bad 4 "$W ran fewer than two passing tests"
fi

# --- Check 5: cold start ------------------------------------------------------------------------
run_vitest 5 functions "$HT" -t "freshly started"

# --- Check 6: registration ----------------------------------------------------------------------
run_vitest 6 functions "$HT" -t "first viewer"
run_vitest 6 functions "$HT" -t "last disconnect"

# --- Check 7: README ----------------------------------------------------------------------------
grep -qF '/api/v1/games/:gamePk/live' README.md || bad 7 "README.md does not name the live route"
grep -qE 'ApiRoutes' README.md && grep -qiE 'OpenAPI' README.md || bad 7 "README.md does not say streaming routes sit outside ApiRoutes and the OpenAPI spec"
grep -qiE 'short-poll|poll' README.md || bad 7 "README.md does not name short-poll as the fallback"

# --- Check 8: no MLB in the browser -------------------------------------------------------------
hits="$(grep -rlF 'statsapi.mlb.com' web --exclude-dir=node_modules --exclude-dir=dist 2>/dev/null || true)"
[ -z "$hits" ] || bad 8 "web/ names statsapi.mlb.com: $hits"

# --- Check 9: backlog Status is done ------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S18\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 9 "S18 row in the Story status table is not \`done\`"
awk '/^### S18 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s18.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s18.md" || bad 9 "S18 story heading Status is not \`done\`"

report "verify-S18"
exit $?
