#!/usr/bin/env bash
# Grader for BACKLOG story S51 — representative local dev: `pnpm dev` runs the API on workerd
# against Postgres in Docker (compose.yaml, Neon's major version) through Hyperdrive's
# localConnectionString, seeded idempotently from fixtures/ by `pnpm db:seed`; the dev
# composition has no in-memory repository; README names Docker as the one prerequisite and
# what local cannot represent; CLAUDE.md says so. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No Docker (CI has none; `pnpm dev` coming up is human-judged). No writes
# outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "compose.yaml runs postgres pinned to Neon's major version (18); README names Docker as the one prerequisite"
check 2 "the root dev script starts that Postgres, runs pnpm db:seed, then wrangler dev (workerd) with Hyperdrive's localConnectionString pointing at it; seeding twice on PGlite leaves row counts unchanged (test)"
check 3 "the Worker composition imports no in-memory repository and wires Postgres repositories; a test composes it on PGlite and serves through it"
check 4 "README lists what local cannot represent (Hyperdrive pooling and caching, Neon wake-up, edge-cache distribution, Durable Object placement and eviction) and checks them on a preview deploy against a Neon branch, never production"
check 5 "CLAUDE.md no longer says the local default is fixtures + in-memory repos; it names Postgres in Docker"
check 6 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
COMPOSITION="functions/src/worker-app.ts"

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

# --- Check 1: compose and the prerequisite -----------------------------------------------------------
if [ -f compose.yaml ]; then
  grep -qE '^\s*image:\s*"?postgres:18(\.[0-9]+)*(-[a-z0-9]+)?"?\s*$' compose.yaml || bad 1 "compose.yaml does not pin image postgres:18 (Neon's major version)"
else
  bad 1 "compose.yaml missing"
fi
grep -qiE 'docker.*(only|one) prerequisite|(only|one) prerequisite.*docker' README.md || bad 1 "README.md does not name Docker as the one prerequisite"

# --- Check 2: the dev script, the seed, idempotence ---------------------------------------------------
DEV="$(node -e 'process.stdout.write(require("./package.json").scripts.dev ?? "")')"
echo "$DEV" | grep -qE 'docker compose up' || bad 2 "the root dev script does not start compose.yaml's Postgres (docker compose up)"
echo "$DEV" | grep -qE 'db:seed' || bad 2 "the root dev script does not run pnpm db:seed"
node -e 'process.exit(require("./package.json").scripts["db:seed"] ? 0 : 1)' || bad 2 "package.json has no db:seed script"
grep -qE '"dev":\s*"[^"]*wrangler dev' functions/package.json || bad 2 "the functions dev script does not run wrangler dev (workerd)"
node -e '
  const fs = require("fs");
  const text = fs.readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, "");
  const hd = (JSON.parse(text).hyperdrive || []).find((h) => h.binding === "HYPERDRIVE");
  if (!hd || !hd.localConnectionString) { console.log("wrangler.jsonc has no HYPERDRIVE localConnectionString"); process.exit(1); }
  const url = new URL(hd.localConnectionString);
  const compose = fs.readFileSync("compose.yaml", "utf8");
  const want = [["POSTGRES_USER", url.username], ["POSTGRES_PASSWORD", url.password], ["POSTGRES_DB", url.pathname.slice(1)]];
  const errs = want.filter(([k, v]) => !new RegExp(k + "\\s*:\\s*\"?" + v + "\"?\\s*$", "m").test(compose)).map(([k, v]) => k + " is not " + v);
  if (!new RegExp(":?\"?" + (url.port || "5432") + ":5432").test(compose)) errs.push("compose.yaml does not publish port " + (url.port || "5432"));
  if (errs.length) { console.log("localConnectionString and compose.yaml disagree: " + errs.join("; ")); process.exit(1); }
' >"$TMP/hd.log" 2>&1 || bad 2 "$(cat "$TMP/hd.log")"
run_vitest 2 functions src/services/seed.test.ts -t "twice"

# --- Check 3: the composition ----------------------------------------------------------------------------
if [ -f "$COMPOSITION" ]; then
  grep -nE 'InMemory|adapters/memory' "$COMPOSITION" >"$TMP/mem.txt" && { bad 3 "$COMPOSITION still has an in-memory repository:"; sed 's/^/        /' "$TMP/mem.txt"; }
  for repo in PostgresScheduleRepository PostgresGameRepository PostgresGameProjectionRepository PostgresUserRepository PostgresSettingsRepository PostgresDeletionLog; do
    grep -qw "$repo" "$COMPOSITION" || bad 3 "$COMPOSITION does not wire $repo"
  done
  grep -qF 'HYPERDRIVE' functions/src/worker.ts "$COMPOSITION" 2>/dev/null || bad 3 "the Worker does not connect through the HYPERDRIVE binding"
else
  bad 3 "$COMPOSITION missing"
fi
run_vitest 3 functions src/worker-app.test.ts -t "PGlite"

# --- Check 4: what local cannot represent -------------------------------------------------------------------
for phrase in "Hyperdrive" "pooling" "caching" "wake-up" "edge cache" "Durable Object placement" "eviction" "preview deploy" "Neon branch" "never production"; do
  grep -qiF "$phrase" README.md || bad 4 "README.md does not mention \"$phrase\""
done

# --- Check 5: CLAUDE.md -----------------------------------------------------------------------------------
grep -qiF 'local default is fixtures + in-memory repos' CLAUDE.md && bad 5 "CLAUDE.md still says the local default is fixtures + in-memory repos"
grep -qiF 'Postgres in Docker' CLAUDE.md || bad 5 "CLAUDE.md does not name Postgres in Docker"

# --- Check 6: backlog Status is done -------------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S51\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 6 "S51 row in the Story status table is not \`done\`"
awk '/^### S51 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s51.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s51.md" || bad 6 "S51 story heading Status is not \`done\`"

report "verify-S51"
exit $?
