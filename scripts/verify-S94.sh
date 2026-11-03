#!/usr/bin/env bash
# Grader for BACKLOG story S94 — MLB's GraphQL game content (data-graph.mlb.com,
# getGamesByGamePks): recorded once, typed and parsed in packages/mlb-api, fetched by ingest
# through MlbStatsClient.fetchGameGraphContent, and projected into GameSnapshot.videoPlayRefs
# (each video's playIdRef, keyed by its id) and relatedArticles, both optional. A commit-time
# proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "fixtures/raw/graphql-content-823823.json is MLB's recorded getGamesByGamePks response for 823823; the recorder and the HTTP adapter build the one request (persisted query, x-client-name: mlb); local dev bundles it; no web code calls it"
check 2 "packages/mlb-api types the payload as named interfaces split by purpose, parses it with zod (test on the recording); the coverage gate and pnpm mlb:scan-drift cover it with no drift"
check 3 "MlbStatsClient.fetchGameGraphContent(gamePk) in the fixture and HTTP adapters (tests)"
check 4 "a functions mapper projects GameSnapshot.videoPlayRefs (18 of 823823's 25 videos, each a real pitch playId, keyed so they join the content feed) and relatedArticles (headline, blurb, slug); spec additive, api:breaking 0"
check 5 "the source is optional: when the call fails or returns nothing the fields are absent and the game is served as before (test)"
check 6 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FX="fixtures/raw/graphql-content-823823.json"
MAP="src/mappers/graph-content.test.ts"

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

# --- Check 1: the recording and the one request ------------------------------------------------------------
node -e '
  const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const g = d?.data?.getGamesByGamePks?.[0];
  if (!g || g.gamePk !== 823823) { console.log("no getGamesByGamePks game 823823"); process.exit(1); }
  const v = g.content?.videoContent ?? [];
  if (v.length !== 25) { console.log(`videoContent has ${v.length} videos, want 25`); process.exit(1); }
' "$FX" >"$TMP/fx.log" 2>&1 || bad 1 "$FX: $(cat "$TMP/fx.log" 2>/dev/null || echo missing)"
H="functions/src/adapters/http/mlb.ts"
grep -qF 'e12a5c2692406844d5f15f52ce7754208f53da81867de7d3e9e773611f4a040a' "$H" || bad 1 "$H does not carry the persisted-query hash"
grep -qF 'data-graph.mlb.com/graphql' "$H" || bad 1 "$H does not call data-graph.mlb.com/graphql"
grep -qF 'x-client-name' "$H" || bad 1 "$H does not send x-client-name"
grep -qw 'graphContentRequest' functions/src/services/recorder.ts || bad 1 "the recorder does not record through graphContentRequest"
grep -qF 'graphql-content-823823.json' functions/src/adapters/fixtures/bundled.ts || bad 1 "bundled.ts does not bundle graphql-content-823823.json (pnpm dev reads only bundled fixtures)"
grep -rqiE 'data-graph|getGamesByGamePks' web/src && bad 1 "web/src names the GraphQL content call"
run_vitest 1 functions src/services/recorder.test.ts -t "graphql"

# --- Check 2: types and parser ----------------------------------------------------------------------------------
P="packages/mlb-api/src/graphql-content.ts"
n="$(grep -cE '^export interface ' "$P" 2>/dev/null || echo 0)"
[ "$n" -ge 3 ] || bad 2 "$P declares $n named interfaces (want at least 3, split by purpose)"
grep -qE 'export function parseGraphContentResponse' packages/mlb-api/src/parse.ts || bad 2 "parse.ts has no parseGraphContentResponse"
grep -qF '"graphql-content-823823.json"' packages/mlb-api/src/coverage.test.ts || bad 2 "the coverage gate does not list graphql-content-823823.json"
run_vitest 2 packages/mlb-api src/parse.test.ts -t "graphql content"
run_vitest 2 packages/mlb-api src/coverage.test.ts
grep -qE 'graphql-content-' functions/src/services/scan-drift.ts || bad 2 "scan-drift has no parser for graphql-content-*.json"
if pnpm -s mlb:scan-drift >"$TMP/drift.log" 2>&1; then
  grep -q 'graphql-content-823823.json' "$TMP/drift.log" || bad 2 "pnpm mlb:scan-drift did not scan graphql-content-823823.json"
else
  bad 2 "pnpm mlb:scan-drift reports drift:"; tail -8 "$TMP/drift.log" | sed 's/^/        /'
fi

# --- Check 3: the port and its adapters ------------------------------------------------------------------------
grep -qE 'fetchGameGraphContent\(gamePk: number\)' packages/ports/src/mlb.ts || bad 3 "MlbStatsClient has no fetchGameGraphContent(gamePk: number)"
grep -qE 'async fetchGameGraphContent\(' functions/src/adapters/fixtures/fixture-client.ts || bad 3 "the fixture client does not implement fetchGameGraphContent"
grep -qE 'async fetchGameGraphContent\(' "$H" || bad 3 "the HTTP client does not implement fetchGameGraphContent"
run_vitest 3 functions src/adapters/http/mlb.test.ts -t "fetchGameGraphContent"
run_vitest 3 functions "$MAP" -t "fixture"

# --- Check 4: the projection -------------------------------------------------------------------------------------
grep -qE 'videoPlayRefs\?:' packages/domain/src/types.ts || bad 4 "GameSnapshot has no optional videoPlayRefs"
grep -qE 'relatedArticles\?:' packages/domain/src/types.ts || bad 4 "GameSnapshot has no optional relatedArticles"
grep -qF '"videoPlayRefs"' openapi/bt-api.v1.json || bad 4 "the spec has no videoPlayRefs"
grep -qF '"relatedArticles"' openapi/bt-api.v1.json || bad 4 "the spec has no relatedArticles"
run_vitest 4 functions "$MAP" -t "play refs"
run_vitest 4 functions "$MAP" -t "articles"
pnpm -s api:breaking >"$TMP/b.log" 2>&1 || { bad 4 "pnpm api:breaking fails:"; tail -8 "$TMP/b.log" | sed 's/^/        /'; }

# --- Check 5: optional ---------------------------------------------------------------------------------------------
run_vitest 5 functions "$MAP" -t "optional"

# --- Check 6: backlog Status is done -------------------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S94\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 6 "S94 row in the Story status table is not \`done\`"
awk '/^### S94 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s94.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s94.md" || bad 6 "S94 story heading Status is not \`done\`"

report "verify-S94"
exit $?
