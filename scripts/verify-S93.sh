#!/usr/bin/env bash
# Grader for BACKLOG story S93 — MLB's play metrics (win probability, key moments, lead changes,
# hard hits, ABS challenges) recorded once for 823823, typed and parsed in packages/mlb-api,
# fetched by ingest through MlbStatsClient.fetchPlayMetrics, and projected onto
# GameSnapshot.playMetrics additively; optional when the feed fails. A commit-time proof of this
# story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "fixtures/raw/playmetrics-823823.json is MLB's recorded bdfed play-metrics response; the recorder fetches it; local dev and tests read the fixture, never the network"
check 2 "packages/mlb-api types the payload as named interfaces split by purpose, parses it with zod (test on the recording), the coverage gate and pnpm mlb:scan-drift cover it with no drift"
check 3 "MlbStatsClient.fetchPlayMetrics, in the fixture and HTTP adapters (tests); no web code fetches the feed"
check 4 "a functions mapper projects GameSnapshot.playMetrics per at-bat: win probability, WPA, the flags and hit data; 823823's ABS challenges 34/39/69/82/83 and 14 key moments (test); spec additive, api:breaking 0"
check 5 "the feed is optional: when it fails or is empty, playMetrics is absent and the game is served as before (test)"
check 6 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FX="fixtures/raw/playmetrics-823823.json"

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

# --- Check 1: the recording ---------------------------------------------------------------------------
node -e '
  const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(d.allPlayMetrics) || d.allPlayMetrics.length === 0) { console.log("no allPlayMetrics"); process.exit(1); }
  if (JSON.stringify(d.keyMoments) !== JSON.stringify([15,21,41,46,53,64,67,68,72,73,74,75,82,84])) { console.log("keyMoments is not the recorded list"); process.exit(1); }
' "$FX" >"$TMP/fx.log" 2>&1 || bad 1 "$FX: $(cat "$TMP/fx.log" 2>/dev/null || echo missing)"
grep -qF 'bdfed.stitch.mlbinfra.com/bdfed/playMetrics' functions/src/adapters/http/mlb.ts 2>/dev/null || bad 1 "the HTTP adapter does not call the bdfed playMetrics feed"
grep -qE 'keyMoments=true&scoringPlays=true&homeRuns=true&strikeouts=true&hardHits=true&highLeverage=false&leadChange=true&winProb=true&absChallenge=true' functions/src/adapters/http/mlb.ts || bad 1 "the HTTP adapter's query is not the story's"
grep -qiE 'playmetrics' functions/src/scripts/record-fixtures.ts || bad 1 "record-fixtures.ts does not record the play metrics"
grep -qF 'playmetrics-823823.json' functions/src/adapters/fixtures/bundled.ts || bad 1 "bundled.ts does not bundle playmetrics-823823.json (pnpm dev reads only bundled fixtures)"
grep -rqiE 'bdfed|playMetrics/' web/src && bad 1 "web/src names the play-metrics feed"

# --- Check 2: types and parser ------------------------------------------------------------------------
P="packages/mlb-api/src/playmetrics.ts"
n="$(grep -cE '^export interface ' "$P" 2>/dev/null || echo 0)"
[ "$n" -ge 3 ] || bad 2 "$P declares $n named interfaces (want at least 3, split by purpose)"
grep -qE 'export function parsePlayMetricsResponse' packages/mlb-api/src/parse.ts || bad 2 "parse.ts has no parsePlayMetricsResponse"
grep -qF '"playmetrics-823823.json"' packages/mlb-api/src/coverage.test.ts || bad 2 "the coverage gate does not list playmetrics-823823.json"
run_vitest 2 packages/mlb-api src/parse.test.ts -t "play metrics"
run_vitest 2 packages/mlb-api src/coverage.test.ts
grep -qE 'playmetrics-' functions/src/services/scan-drift.ts || bad 2 "scan-drift has no parser for playmetrics-*.json"
if pnpm -s mlb:scan-drift >"$TMP/drift.log" 2>&1; then
  grep -q 'playmetrics-823823.json' "$TMP/drift.log" || bad 2 "pnpm mlb:scan-drift did not scan playmetrics-823823.json"
else
  bad 2 "pnpm mlb:scan-drift reports drift:"; tail -8 "$TMP/drift.log" | sed 's/^/        /'
fi

# --- Check 3: the port and its adapters -----------------------------------------------------------------
grep -qE 'fetchPlayMetrics\(gamePk: number\)' packages/ports/src/mlb.ts || bad 3 "MlbStatsClient has no fetchPlayMetrics(gamePk: number)"
grep -qE 'async fetchPlayMetrics\(' functions/src/adapters/fixtures/fixture-client.ts || bad 3 "the fixture client does not implement fetchPlayMetrics"
grep -qE 'async fetchPlayMetrics\(' functions/src/adapters/http/mlb.ts || bad 3 "the HTTP client does not implement fetchPlayMetrics"
run_vitest 3 functions src/adapters/http/mlb.test.ts -t "fetchPlayMetrics"
run_vitest 3 functions src/mappers/play-metrics.test.ts -t "fixture"

# --- Check 4: the projection ----------------------------------------------------------------------------
grep -qE 'playMetrics\?:' packages/domain/src/types.ts || bad 4 "GameSnapshot has no optional playMetrics"
grep -qF '"playMetrics"' openapi/bt-api.v1.json || bad 4 "the spec has no playMetrics"
run_vitest 4 functions src/mappers/play-metrics.test.ts -t "ABS"
run_vitest 4 functions src/mappers/play-metrics.test.ts -t "key moments"
run_vitest 4 functions src/mappers/play-metrics.test.ts -t "win probability"
pnpm -s api:breaking >"$TMP/b.log" 2>&1 || { bad 4 "pnpm api:breaking fails:"; tail -8 "$TMP/b.log" | sed 's/^/        /'; }

# --- Check 5: optional ------------------------------------------------------------------------------------
run_vitest 5 functions src/mappers/play-metrics.test.ts -t "optional"

# --- Check 6: backlog Status is done -------------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S93\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 6 "S93 row in the Story status table is not \`done\`"
awk '/^### S93 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s93.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s93.md" || bad 6 "S93 story heading Status is not \`done\`"

report "verify-S93"
exit $?
