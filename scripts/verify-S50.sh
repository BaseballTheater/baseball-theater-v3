#!/usr/bin/env bash
# Grader for BACKLOG story S50 — the Postgres adapter (ADR-018; Drizzle, owner 2026-10-18):
# committed migrations creating the typed tables and JSONB documents with a GIN index on the
# game document; a version-guarded game upsert; the S46 storage contract run against the
# adapter on PGlite inside `pnpm test` with as many cases as the in-memory run; Drizzle and
# the drivers only inside functions/src/adapters/postgres/; a Hyperdrive binding with a local
# connection string only; every table labeled and the personal stores registered (ADR-028).
# A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "Drizzle migrations create schedule_days, games, game_projections, replay_artifacts, users, identity_links, entitlements, account_settings (+ deletion_log), JSONB documents, a GIN index on games"
check 2 "the game upsert is ON CONFLICT … DO UPDATE … WHERE excluded.version > games.version; a stale write changes 0 rows (test)"
check 3 "the S46 contract runs against the Postgres adapter on PGlite with as many cases as the in-memory run for the same stores, 0 skipped"
check 4 "no pg / postgres / pglite / Drizzle import outside functions/src/adapters/postgres/"
check 5 "wrangler.jsonc declares a Hyperdrive binding with a localConnectionString; no non-local connection string is committed"
check 6 "every migrated table is labeled in the classification manifest; the Postgres user and settings stores run the registry's deletion case under the in-memory stores' names"
check 7 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PG="functions/src/adapters/postgres"
PT="src/adapters/postgres/repos.contract.test.ts"
MT="src/adapters/memory/repos.contract.test.ts"

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

# --- Check 1: the migrations ------------------------------------------------------------------------
ls "$PG"/migrations/*.sql >/dev/null 2>&1 || bad 1 "$PG/migrations has no committed .sql migration"
[ -f "$PG/drizzle.config.ts" ] || bad 1 "$PG/drizzle.config.ts missing (drizzle-kit config)"
grep -qE 'from "drizzle-orm/pg-core"' "$PG/schema.ts" 2>/dev/null || bad 1 "$PG/schema.ts does not define the schema with drizzle-orm/pg-core"
cat "$PG"/migrations/*.sql 2>/dev/null > "$TMP/all.sql"
for t in schedule_days games game_projections replay_artifacts users identity_links entitlements account_settings deletion_log; do
  grep -qE "CREATE TABLE (IF NOT EXISTS )?\"$t\"" "$TMP/all.sql" || bad 1 "no migration creates \"$t\""
done
grep -iqE 'jsonb' "$TMP/all.sql" || bad 1 "no migration declares a jsonb column"
grep -iqE 'ON "games" USING gin' "$TMP/all.sql" || bad 1 "no GIN index on games"

# --- Check 2: version-guarded upsert ------------------------------------------------------------------
grep -rqE 'excluded\.version > ' "$PG"/*.ts 2>/dev/null || bad 2 "the Postgres adapter has no 'excluded.version >' guard"
grep -rqE 'onConflictDoUpdate' "$PG/repos.ts" 2>/dev/null || bad 2 "$PG/repos.ts does not upsert with onConflictDoUpdate"
run_vitest 2 functions "$PT" -t "stale write"

# --- Check 3: the contract on PGlite, case for case ---------------------------------------------------
if (cd functions && pnpm exec vitest run "$PT" "$MT" --reporter=json --outputFile="$TMP/c.json" >"$TMP/c.log" 2>&1); then
  node -e '
    const r = require(process.argv[1]);
    const cases = (file) => r.testResults.filter((t) => t.name.endsWith(file)).flatMap((t) => t.assertionResults);
    const pg = cases("postgres/repos.contract.test.ts"), mem = cases("memory/repos.contract.test.ts");
    const contract = (a) => a.ancestorTitles.some((t) => / — repository contract$/.test(t));
    // The stores the Postgres adapter replaces: everything but the R2 downloads and the mailer.
    const paired = (a) => contract(a) && !a.ancestorTitles.some((t) => /^(Cloud storage: data downloads|Cloudflare Email|InMemoryExportStore|InMemoryMailer)\b/.test(t));
    const pgCases = pg.filter(contract), memCases = mem.filter(paired);
    const skipped = pg.filter((a) => a.status !== "passed");
    if (skipped.length) { console.log(skipped.length + " Postgres case(s) not passed"); process.exit(1); }
    if (pgCases.length === 0 || pgCases.length !== memCases.length) { console.log("Postgres runs " + pgCases.length + " contract cases, in-memory " + memCases.length + " for the same stores"); process.exit(1); }
    console.log(pgCases.length + " contract cases each");
  ' "$TMP/c.json" >"$TMP/count.log" 2>&1 || bad 3 "$(cat "$TMP/count.log")"
else
  bad 3 "the contract files fail:"; tail -15 "$TMP/c.log" | sed 's/^/        /'
fi

# --- Check 4: imports fenced ---------------------------------------------------------------------------
grep -rlnE "from \"(drizzle-orm|drizzle-kit|postgres|pg|@electric-sql/pglite)([/\"])" functions/src packages web/src --include='*.ts' --include='*.tsx' 2>/dev/null |
  grep -v '^functions/src/adapters/postgres/' > "$TMP/imports.txt"
[ -s "$TMP/imports.txt" ] && bad 4 "ORM / driver imports outside $PG: $(tr '\n' ' ' < "$TMP/imports.txt")"
grep -lE "from \"(drizzle-orm|drizzle-kit|postgres|pg|@electric-sql/pglite)" functions/*.ts 2>/dev/null | grep -q . && bad 4 "a functions/ root file imports the ORM or a driver"

# --- Check 5: Hyperdrive ----------------------------------------------------------------------------------
node -e '
  const text = require("fs").readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, "");
  const hd = /"hyperdrive"\s*:\s*\[([\s\S]*?)\]/.exec(text);
  if (!hd) { console.log("no hyperdrive binding"); process.exit(1); }
  if (!/"binding"\s*:/.test(hd[1]) || !/"localConnectionString"\s*:\s*"postgres(ql)?:\/\/[^"]*@(localhost|127\.0\.0\.1)(:\d+)?\//.test(hd[1])) { console.log("the hyperdrive binding has no local localConnectionString"); process.exit(1); }
' >"$TMP/hd.log" 2>&1 || bad 5 "wrangler.jsonc: $(cat "$TMP/hd.log")"
grep -rhoE 'postgres(ql)?://[^"'"'"' ]+' wrangler.jsonc functions --include='*.ts' --include='*.json' --include='*.jsonc' 2>/dev/null |
  grep -vE '@(localhost|127\.0\.0\.1)(:[0-9]+)?/' | grep -q . && bad 5 "a non-local connection string is committed"

# --- Check 6: labels and registry -------------------------------------------------------------------------
grep -qE 'postgresTables' functions/src/services/data-classification.ts || bad 6 "the manifest has no postgresTables section"
for c in PostgresUserRepository PostgresSettingsRepository PostgresDeletionLog; do
  grep -qw "$c" functions/src/services/data-classification.ts || bad 6 "$c is not labeled in the manifest"
done
run_vitest 6 functions src/services/data-classification.test.ts
run_vitest 6 functions "$PT" -t "BT database: users"
run_vitest 6 functions "$PT" -t "BT database: settings"

# --- Check 7: backlog Status is done ------------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S50\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 7 "S50 row in the Story status table is not \`done\`"
awk '/^### S50 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s50.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s50.md" || bad 7 "S50 story heading Status is not \`done\`"

report "verify-S50"
exit $?
