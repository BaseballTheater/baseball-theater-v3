#!/usr/bin/env bash
# Grader for BACKLOG story S113 — the production database: `pnpm db:migrate` applies the committed
# migrations to the database BT_DATABASE_URL names (idempotent); the Worker composes Postgres
# through HYPERDRIVE with no in-memory repository; wrangler.jsonc's `production` env names the
# owner's real Hyperdrive config and commits no connection string; README holds the owner's
# one-time setup and restore runbook; the production tables are the labeled ones. A commit-time
# proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No Docker. Never touches a hosted database (tests migrate a PGlite served over a
# local socket). No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "pnpm db:migrate applies the committed migrations to the database BT_DATABASE_URL names (no committed default), twice changing nothing (PGlite test named 'S113 AC 1')"
check 2 "the Worker composes Postgres through the HYPERDRIVE binding with no in-memory repository or deletion log (grep), served in workerd against a PGlite stand-in (worker.workerd.test.ts)"
check 3 "wrangler.jsonc's production env names Hyperdrive config db27b03ce9734c3f928241ce8ee855f6 and restates its bindings; no postgres:// URL outside localhost is committed"
check 4 "README documents the owner's one-time setup (Neon project and production branch, Hyperdrive config and its id, pnpm db:migrate against it), the restore step that re-applies deletions (a command for reapplyDeletions), and that agents never touch production"
check 5 "the tables a migration creates are exactly the manifest's labeled postgresTables (test named 'S113 AC 5'); README says the deletion log survives a restore and is re-applied"
check 6 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
OWNER_HYPERDRIVE_ID="db27b03ce9734c3f928241ce8ee855f6"
MIGRATE_SCRIPT="functions/src/scripts/db-migrate.ts"
COMPOSITION="functions/src/worker-app.ts"

run_vitest() {
  local id="$1" dir="$2" file="$3" config="$4"
  shift 4
  if [ ! -f "$dir/$file" ]; then
    bad "$id" "$dir/$file missing"
  elif ! (cd "$dir" && pnpm exec vitest run $config "$file" "$@" --reporter=json --outputFile="$TMP/r.json" >"$TMP/r.log" 2>&1); then
    bad "$id" "$dir/$file $* failed:"; tail -15 "$TMP/r.log" | sed 's/^/        /'
  elif ! node -e 'process.exit(require(process.argv[1]).numPassedTests > 0 ? 0 : 1)' "$TMP/r.json"; then
    bad "$id" "$dir/$file $* ran no passing test"
  fi
}

# --- Check 1: db:migrate --------------------------------------------------------------------------------
node -e 'process.exit(/db-migrate\.ts/.test(require("./package.json").scripts["db:migrate"] ?? "") ? 0 : 1)' ||
  bad 1 "package.json's db:migrate script does not run $MIGRATE_SCRIPT"
if [ -f "$MIGRATE_SCRIPT" ]; then
  grep -qF 'BT_DATABASE_URL' "$MIGRATE_SCRIPT" || bad 1 "$MIGRATE_SCRIPT does not read the connection string from BT_DATABASE_URL"
  grep -qE 'localConnectionString|postgres://' "$MIGRATE_SCRIPT" && bad 1 "$MIGRATE_SCRIPT falls back to a committed connection string"
else
  bad 1 "$MIGRATE_SCRIPT missing"
fi
run_vitest 1 functions src/adapters/postgres/migrate.test.ts "" -t "S113 AC 1"

# --- Check 2: the composition ------------------------------------------------------------------------------
if [ -f "$COMPOSITION" ]; then
  grep -nE 'InMemory[A-Za-z]*Repository|InMemoryDeletionLog' "$COMPOSITION" >"$TMP/mem.txt" && { bad 2 "$COMPOSITION falls back to an in-memory repository:"; sed 's/^/        /' "$TMP/mem.txt"; }
fi
grep -qE 'inDatabaseScope\(env\.HYPERDRIVE' functions/src/worker.ts || bad 2 "functions/src/worker.ts does not open its database through env.HYPERDRIVE"
run_vitest 2 functions src/worker.workerd.test.ts "--config vitest.workers.config.ts"

# --- Check 3: wrangler production env ----------------------------------------------------------------------
node -e '
  const text = require("fs").readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, "");
  const config = JSON.parse(text);
  const prod = config.env && config.env.production;
  const errs = [];
  if (!prod) errs.push("no env.production block");
  else {
    const hd = (prod.hyperdrive || []).find((h) => h.binding === "HYPERDRIVE");
    if (!hd) errs.push("env.production has no HYPERDRIVE binding");
    else if (hd.id !== process.argv[1]) errs.push("env.production HYPERDRIVE id is " + hd.id + ", not the owner config " + process.argv[1]);
    if (hd && hd.localConnectionString) errs.push("env.production carries a localConnectionString");
    const dos = ((prod.durable_objects || {}).bindings || []).map((b) => b.name).sort().join(",");
    const top = ((config.durable_objects || {}).bindings || []).map((b) => b.name).sort().join(",");
    if (dos !== top) errs.push("env.production does not restate the Durable Object bindings (" + top + ")");
  }
  if (errs.length) { console.log(errs.join("; ")); process.exit(1); }
' "$OWNER_HYPERDRIVE_ID" >"$TMP/env.log" 2>&1 || bad 3 "$(cat "$TMP/env.log")"
# A URL, not prose about one: something other than space or a quote follows the `//`.
git ls-files -co --exclude-standard -- ':!docs/**' ':!fixtures/**' ':!pnpm-lock.yaml' | xargs grep -nIE "postgres(ql)?://[^[:space:]\"'\`]" 2>/dev/null |
  grep -vE 'postgres(ql)?://[^ "`]*@(localhost|127\.0\.0\.1|\[::1\])|postgres(ql)?://<' >"$TMP/urls.txt"
[ -s "$TMP/urls.txt" ] && { bad 3 "a postgres:// URL outside localhost is committed:"; sed 's/^/        /' "$TMP/urls.txt"; }

# --- Check 4: README setup and runbook -----------------------------------------------------------------------
for phrase in "Neon" "production branch" "wrangler hyperdrive create" "$OWNER_HYPERDRIVE_ID" "pnpm db:migrate" "BT_DATABASE_URL" "pnpm db:reapply-deletions" "restore"; do
  grep -qF -- "$phrase" README.md || bad 4 "README.md does not mention \"$phrase\""
done
grep -qiE 'agents? (never|must not|do not) (touch|run|migrate)[^.]*production' README.md || bad 4 "README.md does not say agents never touch production"
node -e 'process.exit(/db-reapply-deletions\.ts/.test(require("./package.json").scripts["db:reapply-deletions"] ?? "") ? 0 : 1)' ||
  bad 4 "package.json has no db:reapply-deletions script running functions/src/scripts/db-reapply-deletions.ts"
grep -qw 'reapplyDeletions' functions/src/scripts/db-reapply-deletions.ts 2>/dev/null || bad 4 "functions/src/scripts/db-reapply-deletions.ts does not run reapplyDeletions"

# --- Check 5: ADR-028 tables and the deletion log ----------------------------------------------------------------
run_vitest 5 functions src/adapters/postgres/migrate.test.ts "" -t "S113 AC 5"
grep -qiE 'deletion log[^.]*(surviv|kept|restor)' README.md || bad 5 "README.md does not say the deletion log survives a restore"

# --- Check 6: backlog Status is done -------------------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S113\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 6 "S113 row in the Story status table is not \`done\`"
awk '/^### S113 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s113.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s113.md" || bad 6 "S113 story heading Status is not \`done\`"

report "verify-S113"
