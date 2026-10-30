#!/usr/bin/env bash
# Grader for BACKLOG story S45 — the API as a Cloudflare Worker (ADR-017): wrangler.jsonc,
# functions/src/worker.ts with fetch + scheduled, fixtures loaded without node:fs, a
# workerd test via @cloudflare/vitest-pool-workers, `pnpm dev` on the local Workers
# runtime, and the Node-only tools still working. It also proves, over the Worker
# composition, what verify-S12 / -S16 / -S22 proved of local-server.ts (pinned there,
# S84). A commit-time proof of this story.
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "wrangler.jsonc: main functions/src/worker.ts, assets from web/dist, one cron trigger, compatibility_date 2026-08-04 or later; no account_id, no secrets"
check 2 "functions/src/worker.ts default-exports { fetch, scheduled }; fetch calls handleApiRequest; the Worker's fixture client loads fixtures without node:fs"
check 3 "a @cloudflare/vitest-pool-workers test runs inside workerd and gets 200 for the schedule and game 744834; it exits 0 run alone"
check 4 "the root dev script starts the API on the local Workers runtime plus the web app, no Cloudflare login; README documents it"
check 5 "the Node-only tools still run: pnpm api:spec leaves openapi/bt-api.v1.json unchanged; pnpm mlb:scan-drift exits 0 offline"
check 6 "functions coverage thresholds are unchanged or higher"
check 7 "no package.json script contains wrangler deploy"
check 8 "the Worker composition: fixture client by default, live only on BT_USE_LIVE_MLB; tickIngest from scheduled behind a BT_* gate in dev; no replay capture in fetch or dev; verify-S12/-S16/-S22 not edited"
check 9 "CLAUDE.md's Testing line describes the Workers test runner, not a real http server"
check 10 "backlog Status is done (story heading and Story status table)"

BASE=969916a
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
WORKER="functions/src/worker.ts"
APP="functions/src/worker-app.ts"
WTEST="src/worker.workerd.test.ts"

# --- Check 1: wrangler.jsonc --------------------------------------------------------------------
if [ ! -f wrangler.jsonc ]; then
  bad 1 "wrangler.jsonc missing"
else
  node -e '
const src = require("fs").readFileSync("wrangler.jsonc", "utf8");
// Strip // and /* */ comments outside strings, then trailing commas.
let out = "", inStr = false;
for (let i = 0; i < src.length; i++) {
  const c = src[i], n = src[i + 1];
  if (inStr) { out += c; if (c === "\\") { out += n; i++; } else if (c === "\"") inStr = false; continue; }
  if (c === "\"") { inStr = true; out += c; continue; }
  if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
  if (c === "/" && n === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; continue; }
  out += c;
}
const cfg = JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
const fail = (m) => { console.log(m); process.exitCode = 1; };
if (cfg.main !== "functions/src/worker.ts") fail(`main is ${cfg.main}`);
if (!cfg.assets || !/^(\.\/)?web\/dist\/?$/.test(cfg.assets.directory ?? "")) fail(`assets.directory is ${cfg.assets?.directory}`);
const crons = cfg.triggers?.crons ?? [];
if (crons.length !== 1) fail(`${crons.length} cron triggers, want 1`);
if (!(String(cfg.compatibility_date) >= "2026-08-04")) fail(`compatibility_date ${cfg.compatibility_date} is before 2026-08-04`);
if ("account_id" in cfg) fail("declares account_id");
const flat = JSON.stringify(cfg);
if (/secret|password|token|api[_-]?key/i.test(flat.replace(/"BT_[A-Z_]+"/g, ""))) fail("looks like it carries a secret");
' >"$TMP/w.log" 2>&1 || { while read -r l; do bad 1 "wrangler.jsonc: $l"; done <"$TMP/w.log"; }
fi

# --- Check 2: the Worker entry and its fixture loading ------------------------------------------
if [ ! -f "$WORKER" ]; then
  bad 2 "$WORKER missing"
else
  grep -qE '^export default \{' "$WORKER" || bad 2 "$WORKER has no default-exported object"
  awk '/^export default \{/{f=1} f{print} f&&/^\}/{exit}' "$WORKER" >"$TMP/default.txt"
  grep -qE '\bfetch\b' "$TMP/default.txt" || bad 2 "$WORKER's default export has no fetch"
  grep -qE '\bscheduled\b' "$TMP/default.txt" || bad 2 "$WORKER's default export has no scheduled"
  cat "$WORKER" "$APP" 2>/dev/null | grep -qw 'handleApiRequest' || bad 2 "the Worker never calls handleApiRequest"
fi
for f in "$WORKER" "$APP" functions/src/adapters/fixtures/fixture-client.ts functions/src/adapters/fixtures/bundled.ts; do
  if [ ! -f "$f" ]; then bad 2 "$f missing"; continue; fi
  grep -nE "from \"node:fs|require\(\"node:fs|from \"fs" "$f" >/dev/null && bad 2 "$f imports node:fs"
done
grep -qE '\.json"' functions/src/adapters/fixtures/bundled.ts 2>/dev/null || bad 2 "functions/src/adapters/fixtures/bundled.ts imports no JSON fixture"

# --- Check 3: the workerd test ------------------------------------------------------------------
if [ ! -f "functions/$WTEST" ]; then
  bad 3 "functions/$WTEST missing"
else
  grep -qF '@cloudflare/vitest-pool-workers' functions/vitest.workers.config.ts 2>/dev/null || bad 3 "functions/vitest.workers.config.ts does not use @cloudflare/vitest-pool-workers"
  grep -qF '/api/v1/schedule?date=2024-07-04' "functions/$WTEST" || bad 3 "the workerd test does not request the 2024-07-04 schedule"
  grep -qF '/api/v1/games/744834' "functions/$WTEST" || bad 3 "the workerd test does not request game 744834"
  if ! (cd functions && pnpm exec vitest run --config vitest.workers.config.ts "$WTEST" --reporter=json --outputFile="$TMP/r.json" >"$TMP/r.log" 2>&1); then
    bad 3 "the workerd test failed:"; tail -15 "$TMP/r.log" | sed 's/^/        /'
  elif ! node -e 'process.exit(require(process.argv[1]).numPassedTests > 0 ? 0 : 1)' "$TMP/r.json"; then
    bad 3 "the workerd test ran no passing test"
  fi
fi

# --- Check 4: pnpm dev on workerd ---------------------------------------------------------------
dev="$(node -e 'const r=require("./package.json").scripts.dev||"";const f=require("./functions/package.json").scripts.dev||"";console.log(r+" || "+f)')"
echo "$dev" | grep -qE 'wrangler dev|@cloudflare/vite-plugin' || bad 4 "the dev scripts do not start wrangler dev: $dev"
echo "$dev" | grep -qE '@bt/web|vite' || bad 4 "the root dev script does not start the web app: $dev"
echo "$dev" | grep -qE 'wrangler login' && bad 4 "the dev scripts log in to Cloudflare"
grep -qE 'workerd|Workers runtime' README.md || bad 4 "README.md does not describe the local Workers runtime"

# --- Check 5: Node-only tools -------------------------------------------------------------------
pnpm -s --filter @bt/functions exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1 || { bad 5 "pnpm api:spec would change openapi/bt-api.v1.json:"; tail -4 "$TMP/spec.log" | sed 's/^/        /'; }
pnpm -s mlb:scan-drift >"$TMP/drift.log" 2>&1 || { bad 5 "pnpm mlb:scan-drift fails offline:"; tail -6 "$TMP/drift.log" | sed 's/^/        /'; }

# --- Check 6: coverage thresholds ---------------------------------------------------------------
git show "$BASE:functions/vitest.config.ts" >"$TMP/base.cfg"
for k in lines functions branches statements; do
  was="$(grep -E "^\s+$k: [0-9]+" "$TMP/base.cfg" | head -1 | grep -oE '[0-9]+')"
  now="$(grep -E "^\s+$k: [0-9]+" functions/vitest.config.ts | head -1 | grep -oE '[0-9]+')"
  if [ -z "$now" ] || [ "$now" -lt "$was" ]; then bad 6 "functions coverage $k is ${now:-gone}, was $was"; fi
done

# --- Check 7: no deploy scripts -----------------------------------------------------------------
dep="$(git ls-files '*package.json' | xargs grep -lE '"[^"]+": *"[^"]*wrangler deploy' 2>/dev/null | tr '\n' ' ')"
[ -z "$dep" ] || bad 7 "a script deploys: $dep"

# --- Check 8: the composition keeps local-server's behavior -------------------------------------
cat "$WORKER" "$APP" >"$TMP/comp.ts" 2>/dev/null
grep -qE 'BT_USE_LIVE_MLB' "$TMP/comp.ts" || bad 8 "the composition has no BT_USE_LIVE_MLB switch"
grep -qE 'BT_USE_LIVE_MLB[^\n]*=== *"1"' "$TMP/comp.ts" || bad 8 "the live client is not opt-in on BT_USE_LIVE_MLB === \"1\""
grep -qE 'FixtureMlbStatsClient|BundledFixture|createFixtureClient' "$TMP/comp.ts" || bad 8 "the composition does not default to the fixture client"
awk '/scheduled/{f=1} f' "$WORKER" 2>/dev/null | grep -qw 'tickIngest' || bad 8 "tickIngest does not run from scheduled"
grep -qE 'BT_INGEST_TICK' "$TMP/comp.ts" || bad 8 "the dev ingest tick is not behind BT_INGEST_TICK"
grep -nE 'capture|Capture' "$TMP/comp.ts" >/dev/null && bad 8 "replay capture is wired into the Worker"
grep -E '"dev"' functions/package.json package.json | grep -qiE 'capture' && bad 8 "replay capture is wired into pnpm dev"
others="$(story_changed_files S45 "$BASE" scripts/ | grep -vx 'scripts/verify-S45.sh' | tr '\n' ' ')"
[ -z "$others" ] || bad 8 "the story edits scripts/: $others"

# --- Check 9: CLAUDE.md Testing line ------------------------------------------------------------
grep -qF 'Functions tests spin a real `http` server' CLAUDE.md && bad 9 "CLAUDE.md still says functions tests spin a real http server"
grep -qE 'vitest-pool-workers|workerd' CLAUDE.md || bad 9 "CLAUDE.md does not describe the Workers test runner"

# --- Check 10: backlog Status is done -----------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S45\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 10 "S45 row in the Story status table is not \`done\`"
awk '/^### S45 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md \
  | grep -qE '^\*\*Status:\*\* `done`$' ||
  bad 10 "S45 story heading Status is not \`done\`"

report "verify-S45"
exit $?
