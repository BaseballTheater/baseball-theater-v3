#!/usr/bin/env bash
# Grader for BACKLOG story S47 — graduated edge caching + refresh-on-read (ADR-021):
# out-of-window schedule / game responses carry Cache-Control with s-maxage from
# cacheLifetimeMs(now − lastChangedAt) and stale-while-revalidate; in-window never above
# the floor; refresh-on-read uses the same function; Workers Cache on in wrangler.jsonc;
# README and ADR-017 record it. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "out-of-window GET /api/v1/schedule and /api/v1/games/:gamePk carry Cache-Control: public, s-maxage=<cacheLifetimeMs(now − lastChangedAt)/1000>, stale-while-revalidate=<n>; a game unchanged 3h gets s-maxage=36000 (test)"
check 2 "in-window responses never carry an s-maxage above the floor (test)"
check 3 "refresh-on-read decides staleness with cacheLifetimeMs; export const CACHE_TTL_MS stays as the floor; functions/src/services/refresh.test.ts exits 0 run alone"
check 4 "a refresh that finds changed content resets the lifetime: the next response uses the floor (test)"
check 5 "README.md documents the edge cache (Workers Cache, tiered, every request billed, purge intent); ADR-017 in docs/v3/ARCHITECTURE.md names Workers Cache"
check 6 "wrangler.jsonc enables Workers Cache (\"cache\": { \"enabled\": true })"
check 7 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CT="src/handlers/cache-control.test.ts"

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

# --- Check 1: out-of-window headers ------------------------------------------------------------
grep -rqw 'cacheLifetimeMs' functions/src/handlers --include='*.ts' 2>/dev/null || bad 1 "functions/src/handlers never calls cacheLifetimeMs"
run_vitest 1 functions "$CT" -t "out of window"
run_vitest 1 functions "$CT" -t "36000"

# --- Check 2: in-window ------------------------------------------------------------------------
run_vitest 2 functions "$CT" -t "in window"

# --- Check 3: refresh-on-read uses the ladder --------------------------------------------------
grep -qE '^export const CACHE_TTL_MS' functions/src/services/refresh.ts || bad 3 "refresh.ts no longer exports CACHE_TTL_MS"
grep -qw 'cacheLifetimeMs' functions/src/services/ingest.ts functions/src/services/refresh.ts 2>/dev/null || bad 3 "refresh-on-read (ingest.ts / refresh.ts) does not use cacheLifetimeMs"
run_vitest 3 functions src/services/refresh.test.ts
run_vitest 3 functions src/services/ingest.test.ts -t "lifetime"

# --- Check 4: a change resets to the floor -----------------------------------------------------
run_vitest 4 functions "$CT" -t "resets"

# --- Check 5: README and ADR-017 ---------------------------------------------------------------
grep -q 'Workers Cache' README.md || bad 5 "README.md does not name Workers Cache"
grep -qiE 'tiered' README.md || bad 5 "README.md does not say the cache is tiered"
grep -qiE 'purge' README.md || bad 5 "README.md does not state the purge intent"
awk '/^### ADR-017/{f=1;next} /^### ADR-018/{f=0} f' docs/v3/ARCHITECTURE.md > "$TMP/adr17.md"
grep -q 'Workers Cache' "$TMP/adr17.md" || bad 5 "ADR-017 does not name Workers Cache"

# --- Check 6: wrangler.jsonc --------------------------------------------------------------------
node -e '
const src = require("fs").readFileSync("wrangler.jsonc", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
const cfg = JSON.parse(src);
process.exit(cfg.cache && cfg.cache.enabled === true ? 0 : 1);
' 2>/dev/null || bad 6 "wrangler.jsonc does not set \"cache\": { \"enabled\": true }"

# --- Check 7: backlog Status is done ------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S47\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 7 "S47 row in the Story status table is not \`done\`"
awk '/^### S47 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s47.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s47.md" || bad 7 "S47 story heading Status is not \`done\`"

report "verify-S47"
exit $?
