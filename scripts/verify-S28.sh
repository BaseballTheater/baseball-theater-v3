#!/usr/bin/env bash
# Grader for BACKLOG story S28 — the version sunset path (ADR-015): one lifecycle table in
# packages/domain (supported / deprecated / sunset, with dates); a deprecated version answers
# with Deprecation and Sunset headers, a sunset one with 426 version_unsupported and no data;
# every request's version is recorded through a seam a test reads; the one web client turns a
# 426 into the shared update notice without losing what is on screen; README documents it.
# A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "version lifecycle state lives in one exported table in packages/domain (supported / deprecated / sunset, with dates) beside the route table"
check 2 "a deprecated version answers 200 with Deprecation and Sunset headers and the same body (functions test, alone)"
check 3 "a sunset version answers 426 version_unsupported with no payload data (functions test, alone); the spec declares the 426"
check 4 "each request's version is recorded through a seam a test reads; two versions make two distinct records"
check 5 "the web client's one middleware turns a 426 into the reload-to-update notice, and a 200 doesn't (web test, alone via pnpm --filter @bt/web); after a 426, Update Now asks the service worker for the new version (registration.update()), activates it, then reloads (web test; 2026-11-02 design intake note)"
check 6 "after a 426 the content already on screen stays readable behind the notice (web test); one tested keep-what's-on-screen rule (queryScreen) that the Scoreboard, Standings and Game pages all call (ADR-025; 2026-11-02 design intake note)"
check 7 "README.md documents the lifecycle states, that retiring a version needs the usage log to show no traffic, and that pnpm verify needs no network for it"
check 8 "the 426 notice renders through NoticeSlot / NoticeBanner; no second notice component exists"
check 9 "design match: e2e/design/S28.spec.ts names shell-notice-mobile/-medium/-desktop; docs/v3/design-checks/S28/ holds them at 390 / 768 / 1200"
check 10 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
VT="src/handlers/versions.test.ts"
WT="src/api/versionNotice.test.tsx"

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

# --- Check 1: one lifecycle table ------------------------------------------------------------------
F="packages/domain/src/api-versions.ts"
grep -qE '^export const API_VERSIONS\b' "$F" 2>/dev/null || bad 1 "$F exports no API_VERSIONS"
for s in supported deprecated sunset; do grep -qF "\"$s\"" "$F" 2>/dev/null || bad 1 "$F has no \"$s\" state"; done
grep -qE 'from "\./api-versions\.js"' packages/domain/src/index.ts || bad 1 "packages/domain's index does not export api-versions.ts"
n="$(grep -rlE 'export const API_VERSIONS\b' packages functions/src web/src 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')"
[ "$n" = "1" ] || bad 1 "$n files export API_VERSIONS (want one)"
run_vitest 1 packages/domain src/api-versions.test.ts -t "lifecycle"

# --- Check 2 / 3: deprecated and sunset ------------------------------------------------------------
run_vitest 2 functions "$VT" -t "deprecated"
run_vitest 3 functions "$VT" -t "sunset"
(cd functions && pnpm exec vitest run "$VT" >"$TMP/alone.log" 2>&1) || { bad 2 "functions/$VT fails run alone"; bad 3 "functions/$VT fails run alone"; }
grep -qF '"version_unsupported"' functions/src/handlers/api.ts || bad 3 "functions/src/handlers/api.ts has no version_unsupported"
node -e '
  const spec = require("./openapi/bt-api.v1.json");
  const missing = [];
  for (const [path, ops] of Object.entries(spec.paths)) for (const [m, op] of Object.entries(ops)) if (!op.responses || !op.responses["426"]) missing.push(m.toUpperCase() + " " + path);
  if (missing.length) { console.log(missing.join(", ")); process.exit(1); }
' >"$TMP/spec.log" 2>&1 || bad 3 "the spec declares no 426 on: $(cat "$TMP/spec.log")"

# --- Check 4: usage records ------------------------------------------------------------------------
run_vitest 4 functions "$VT" -t "usage"

# --- Check 5 / 6: the client --------------------------------------------------------------------------
grep -qE 'onResponse' web/src/api/client.ts || bad 5 "web/src/api/client.ts has no onResponse middleware"
grep -qE '426' web/src/api/client.ts || bad 5 "web/src/api/client.ts does not check for 426"
run_vitest 5 web "$WT" -t "426"
run_vitest 5 web "$WT" -t "200"
if [ -f "web/$WT" ]; then
  pnpm --filter @bt/web exec vitest run "$WT" >"$TMP/walone.log" 2>&1 || bad 5 "web/$WT fails run alone"
fi
run_vitest 5 web "$WT" -t "Update Now asks the service worker"
grep -qE 'registration\.update\(\)|\.update\(\)' web/src/pwa/updates.ts || bad 5 "web/src/pwa/updates.ts never asks the service worker registration for the new version (.update())"
grep -qE 'SKIP_WAITING' web/src/pwa/updates.ts || bad 5 "web/src/pwa/updates.ts never activates the new worker (SKIP_WAITING)"
run_vitest 6 web "$WT" -t "readable"
# One keep-what's-on-screen rule (ADR-025): a failed refetch keeps the data shown; the error room is for no data.
Q="web/src/components/queryScreen.ts"
grep -qE '^export function queryScreen\b' "$Q" 2>/dev/null || bad 6 "$Q exports no queryScreen"
run_vitest 6 web src/components/queryScreen.test.ts
for page in GamePage ScoreboardPage StandingsPage; do
  f="web/src/pages/$page.tsx"
  grep -qE '\bqueryScreen\(' "$f" || bad 6 "$f does not call queryScreen"
  grep -qE 'if \(error\b|error && !' "$f" && bad 6 "$f still decides on error itself"
done

# --- Check 7: README --------------------------------------------------------------------------------
for word in supported deprecated sunset; do grep -qiw "$word" README.md || bad 7 "README.md does not name the $word state"; done
grep -qiE 'no traffic' README.md || bad 7 "README.md does not say retirement needs the usage log to show no traffic"
grep -qiE 'pnpm verify.{0,80}(network|offline)|(network|offline).{0,80}pnpm verify' README.md || bad 7 "README.md does not say pnpm verify needs no network for it"

# --- Check 8: one notice component ------------------------------------------------------------------
n="$(grep -rlE 'export function NoticeBanner\b' web/src | wc -l | tr -d ' ')"
[ "$n" = "1" ] || bad 8 "$n files define NoticeBanner (want one)"
grep -rlE 'role="(status|alert)"' web/src --include='*.tsx' | grep -v '\.test\.' | xargs grep -lE 'Reload' 2>/dev/null | grep -v 'web/src/layout/NoticeSlot.tsx' | grep -q . &&
  bad 8 "a component outside NoticeSlot.tsx draws its own Reload notice"
grep -rqE 'Notice\b' web/src/api/versionNotice.ts 2>/dev/null || bad 8 "web/src/api/versionNotice.ts does not build a Notice for the slot"

# --- Check 9: design match captures -------------------------------------------------------------------
S="e2e/design/S28.spec.ts"
for fw in shell-notice-mobile:390 shell-notice-medium:768 shell-notice-desktop:1200; do
  name="${fw%%:*}"; w="${fw##*:}"; png="docs/v3/design-checks/S28/$name.png"
  grep -qF "\"$name\"" "$S" 2>/dev/null || bad 9 "$S does not name $name"
  if [ -f "$png" ]; then
    [ "$(png_width "$png")" = "$w" ] || bad 9 "$png is $(png_width "$png")px wide, want $w"
  else
    bad 9 "$png missing"
  fi
done

# --- Check 10: backlog Status is done -----------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S28\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 10 "S28 row in the Story status table is not \`done\`"
awk '/^### S28 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s28.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s28.md" || bad 10 "S28 story heading Status is not \`done\`"

report "verify-S28"
exit $?
