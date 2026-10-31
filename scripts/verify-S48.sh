#!/usr/bin/env bash
# Grader for BACKLOG story S48 — the per-game ingest Durable Object (ADR-020 layer 1):
# the cron ensures one `game-ingest:<gamePk>` object per in-window game; its alarm polls
# MLB, writes, then publishes to leased hubs; the window's end publishes the final and
# stops; one composition for Node and the Worker. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "scheduled() reads the schedule and calls an idempotent ensureRunning on game-ingest:<gamePk> only for in-window games; ensureRunning twice arms exactly one alarm (tests); wrangler.jsonc binds the class"
check 2 "the alarm polls through MlbStatsClient (fixture 745001); an unchanged payload creates no new version (test)"
check 3 "write before publish (test); with no registered hubs nothing is published (test)"
check 4 "hub leases persist in Durable Object storage: register, renew, unregister; an expired lease is dropped; three failed publishes in a row drop a hub (tests)"
check 5 "at the end of the window ingest publishes the final state and stops scheduling alarms (test)"
check 6 "tickIngest stays exported; functions/src/services/tick-ingest.test.ts exits 0 run alone"
check 7 "the Durable Object tests run in @cloudflare/vitest-pool-workers; each *.workerd.test.ts exits 0 run alone"
check 8 "no codedGameState letter compared inline in functions/src outside tests; a game-over (O) game outside the window is fetched like a final (F) one (test)"
check 9 "local-server.ts composes through createWorkerApp: no new InMemory, no createMlbClient of its own"
check 10 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
GT="src/services/game-ingest.test.ts"
LT="src/services/hub-leases.test.ts"

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

# --- Check 1: cron → ensureRunning -------------------------------------------------------------
grep -qF 'game-ingest:' functions/src/worker.ts functions/src/services/game-ingest.ts 2>/dev/null || bad 1 "nothing names game-ingest:<gamePk>"
grep -qw 'ensureRunning' functions/src/worker.ts 2>/dev/null || bad 1 "worker.ts scheduled() does not ensure ingest objects"
grep -qE 'export class GameIngestObject' functions/src/game-ingest-object.ts 2>/dev/null || bad 1 "functions/src/game-ingest-object.ts exports no GameIngestObject"
grep -qw 'GameIngestObject' functions/src/worker.ts 2>/dev/null || bad 1 "worker.ts does not export GameIngestObject"
node -e '
const src = require("fs").readFileSync("wrangler.jsonc", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
const cfg = JSON.parse(src);
const bound = (cfg.durable_objects?.bindings ?? []).some((b) => b.class_name === "GameIngestObject");
const migrated = (cfg.migrations ?? []).some((m) => (m.new_sqlite_classes ?? []).includes("GameIngestObject"));
process.exit(bound && migrated ? 0 : 1);
' 2>/dev/null || bad 1 "wrangler.jsonc lacks a GameIngestObject durable_objects binding and new_sqlite_classes migration"
run_vitest 1 functions "$GT" -t "ensureRunning"
run_vitest 1 functions src/worker.test.ts -t "scheduled"

# --- Check 2: polls; unchanged makes no version -------------------------------------------------
run_vitest 2 functions "$GT" -t "unchanged"

# --- Check 3: write before publish --------------------------------------------------------------
run_vitest 3 functions "$GT" -t "write before publish"
run_vitest 3 functions "$GT" -t "no hubs"

# --- Check 4: hub leases ------------------------------------------------------------------------
for t in "register" "renew" "unregister" "expired" "three"; do
  run_vitest 4 functions "$LT" -t "$t"
done

# --- Check 5: end of window ---------------------------------------------------------------------
run_vitest 5 functions "$GT" -t "end of the window"

# --- Check 6: tickIngest ------------------------------------------------------------------------
grep -qE 'export async function tickIngest\(' functions/src/services/ingest.ts || bad 6 "tickIngest is no longer exported"
run_vitest 6 functions src/services/tick-ingest.test.ts

# --- Check 7: workerd ---------------------------------------------------------------------------
[ -f functions/src/game-ingest.workerd.test.ts ] || bad 7 "functions/src/game-ingest.workerd.test.ts missing"
for f in functions/src/*.workerd.test.ts; do
  [ -f "$f" ] || continue
  rel="${f#functions/}"
  if ! (cd functions && pnpm exec vitest run --config vitest.workers.config.ts "$rel" --reporter=json --outputFile="$TMP/w.json" >"$TMP/w.log" 2>&1); then
    bad 7 "$rel failed run alone:"; tail -15 "$TMP/w.log" | sed 's/^/        /'
  elif ! node -e 'process.exit(require(process.argv[1]).numPassedTests > 0 ? 0 : 1)' "$TMP/w.json"; then
    bad 7 "$rel ran no passing test"
  fi
done

# --- Check 8: one final / window decision -------------------------------------------------------
hits="$(grep -rnE 'codedGameState\s*[!=]==?\s*["'"'"']' functions/src --include='*.ts' | grep -v '\.test\.ts' || true)"
[ -z "$hits" ] || { bad 8 "inline codedGameState comparisons:"; printf '%s\n' "$hits" | sed 's/^/        /'; }
run_vitest 8 functions src/services/ingest.test.ts -t "game-over"

# --- Check 9: one composition -------------------------------------------------------------------
grep -q 'new InMemory' functions/src/local-server.ts && bad 9 "local-server.ts builds its own in-memory repositories"
grep -qE 'function createMlbClient' functions/src/local-server.ts && bad 9 "local-server.ts defines its own createMlbClient"
grep -qw 'createWorkerApp' functions/src/local-server.ts || bad 9 "local-server.ts does not call createWorkerApp"

# --- Check 10: backlog Status is done -----------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S48\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 10 "S48 row in the Story status table is not \`done\`"
awk '/^### S48 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s48.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s48.md" || bad 10 "S48 story heading Status is not \`done\`"

report "verify-S48"
exit $?
