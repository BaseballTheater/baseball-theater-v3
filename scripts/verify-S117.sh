#!/usr/bin/env bash
# Grader for BACKLOG story S117 — Copy production's baseball data into staging, on request, with
# no fans' data (owner, 2026-11-05: "No user data, copied baseball data"). `pnpm db:copy-baseball`
# copies only the tables DATA_CLASSIFICATION labels `none`, through version-guarded writes, only
# adding to the target (matching columns only, nothing deleted), migrating the target first and
# never production; it runs only by hand and refuses to write production. A commit-time proof of
# this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "one command copies only DATA_CLASSIFICATION's 'none' tables; a PGlite-to-PGlite test finds every baseball row copied and every personal table and the deletion log never written in the target"
check 2 "idempotent: a second copy writes nothing, and a newer target row survives (version-guarded writes, ADR-022)"
check 3 "additive: never deletes, truncates or drops; matching columns only; a target one migration ahead keeps its extra column and staging-only row; it migrates the target first and never changes production"
check 4 "runs only by hand: a workflow_dispatch-only workflow on stage runs it, and no other workflow does; package.json has db:copy-baseball; connection strings are masked"
check 5 "refuses to write production: the production branch and bt-production are refused (test), through S122's databaseTarget host reading, with no new URL().hostname check"
check 6 "README says what it copies, what it never does, how to run it, and that deploys never run it"
check 7 "backlog Status is done (story heading and Story status table), and the story stays inside its scope files"

BASE=12ee905d5f1ea046e62cfd8558740fe6ee187c62
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SERVICE="functions/src/services/baseball-copy.ts"
SERVICE_TEST="src/services/baseball-copy.test.ts"
TARGET="functions/src/services/baseball-copy-target.ts"
TARGET_TEST="src/services/baseball-copy-target.test.ts"
SCRIPT="functions/src/scripts/db-copy-baseball.ts"
RUN="functions/src/scripts/copy-baseball-run.ts"
RUN_TEST="src/scripts/copy-baseball-run.test.ts"
WORKFLOW=".github/workflows/copy-baseball-data.yml"

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

# Code lines of a TS file with // and /* */ comments removed, so a comment saying "never DROP" isn't read as SQL.
code_of() { perl -0777 -pe 's{/\*.*?\*/}{}gs; s{//[^\n]*}{}g' "$1" 2>/dev/null; }

# --- Check 1: only the 'none' tables ---------------------------------------------------------------------------
[ -f "$SERVICE" ] || bad 1 "$SERVICE missing"
grep -qF 'DATA_CLASSIFICATION' "$SERVICE" 2>/dev/null || bad 1 "the copy does not take its tables from DATA_CLASSIFICATION"
grep -qE 'kind === "none"' "$SERVICE" 2>/dev/null || bad 1 "the copy does not select the tables labeled none"
for t in users entitlements identity_links account_settings deletion_log; do
  code_of "$SERVICE" | grep -qE "\b$t\b" && bad 1 "the copy names the $t table itself instead of reading the manifest"
done
run_vitest 1 functions "$SERVICE_TEST" -t "personal"
run_vitest 1 functions "$SERVICE_TEST" -t "never reads"
run_vitest 1 functions "$SERVICE_TEST" -t "bytes"

# --- Check 2: idempotent, version-guarded ------------------------------------------------------------------------
grep -qE 'excluded\.version > ' "$SERVICE" 2>/dev/null || bad 2 "the copy's writes are not guarded by excluded.version > the stored version"
run_vitest 2 functions "$SERVICE_TEST" -t "twice"
run_vitest 2 functions "$SERVICE_TEST" -t "newer"

# --- Check 3: additive, matching columns, migrates the target only -----------------------------------------------
for f in "$SERVICE" "$SCRIPT" "$RUN" "$TARGET"; do
  code_of "$f" | grep -qiE '\b(DELETE[[:space:]]+FROM|TRUNCATE|DROP)\b' && bad 3 "$f deletes, truncates or drops"
  grep -qF 'prepareSchemaOnlyCopy' "$f" 2>/dev/null && bad 3 "$f calls prepareSchemaOnlyCopy, which can drop the public schema"
done
grep -qF 'information_schema.columns' "$SERVICE" 2>/dev/null || bad 3 "the copy does not read each side's columns"
grep -qE 'READ ONLY' "$SERVICE" 2>/dev/null || bad 3 "the copy does not open production read-only"
grep -qE 'migrateDatabaseAt|migratePostgres' "$SCRIPT" 2>/dev/null || bad 3 "the command does not migrate the target"
grep -qE 'migrate\(writer\.db\)' "$RUN" 2>/dev/null || bad 3 "$RUN does not migrate the target (writer.db)"
grep -qE 'SET SESSION' "$SERVICE" 2>/dev/null && bad 3 "the copy sets a session characteristic on production, which a pooler can leave on another client's connection"
run_vitest 3 functions "$SERVICE_TEST" -t "ahead"
run_vitest 3 functions "$SERVICE_TEST" -t "production unchanged"
run_vitest 3 functions "$SERVICE_TEST" -t "pooler"
run_vitest 3 functions "$SERVICE_TEST" -t "required"
run_vitest 3 functions "$RUN_TEST" -t "production unchanged"

# --- Check 4: manual only --------------------------------------------------------------------------------------------
grep -qE '"db:copy-baseball": *"pnpm --filter @bt/functions exec tsx src/scripts/db-copy-baseball\.ts"' package.json || bad 4 "package.json has no db:copy-baseball script running $SCRIPT"
[ -f "$SCRIPT" ] || bad 4 "$SCRIPT missing"
[ "$(grep -o 'db:copy-baseball' package.json | wc -l)" -eq 1 ] || bad 4 "package.json names db:copy-baseball more than once (or not at all)"
grep -qF 'copy-baseball-run.js' "$SCRIPT" 2>/dev/null || bad 4 "$SCRIPT does not run the tested runCopy"
grep -qF '::add-mask::' "$RUN" 2>/dev/null || bad 4 "the command does not mask the connection strings"
# The copy service is reached only through runCopy (and tests), so nothing else can run it.
for f in $(grep -rlE 'baseball-copy\.js"' functions/src 2>/dev/null); do
  case "$f" in "$RUN"|*.test.ts) ;; *) bad 4 "$f imports the copy service; only $RUN may" ;; esac
done
run_vitest 4 functions "$RUN_TEST" -t "masked"
if [ ! -f "$WORKFLOW" ]; then
  bad 4 "$WORKFLOW missing"
else
  # The workflow's triggers: the keys directly under the top-level `on:`.
  triggers="$(awk '/^on:/{f=1;next} /^[^[:space:]#]/{f=0} f && /^    [a-z_]+:/{sub(/^ +/,"");sub(/:.*/,"");print}' "$WORKFLOW" | sort -u | tr '\n' ' ')"
  [ "$triggers" = "workflow_dispatch " ] || bad 4 "$WORKFLOW triggers on '$triggers', want workflow_dispatch only"
  grep -qE 'pnpm db:copy-baseball' "$WORKFLOW" || bad 4 "$WORKFLOW does not run pnpm db:copy-baseball"
  grep -qE 'ref: *stage' "$WORKFLOW" || bad 4 "$WORKFLOW does not check out stage"
  grep -qE 'environment: *production' "$WORKFLOW" && bad 4 "$WORKFLOW uses the production environment"
fi
for f in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -f "$f" ] || continue
  [ "$f" = "$WORKFLOW" ] && continue
  grep -qE 'db:copy-baseball|db-copy-baseball|copy-baseball-data' "$f" && bad 4 "$f runs the copy; only $WORKFLOW may"
  grep -qiE 'copy baseball data' "$f" && bad 4 "$f is named for the copy; only $WORKFLOW may be"
done

# --- Check 5: never production ---------------------------------------------------------------------------------------
[ -f "$TARGET" ] || bad 5 "$TARGET missing"
grep -qE 'databaseTarget|checkBackfillTarget' "$TARGET" 2>/dev/null || bad 5 "the refusal does not reuse S122's databaseTarget / checkBackfillTarget"
grep -qF 'HYPERDRIVE_CONFIG' "$TARGET" 2>/dev/null || bad 5 "the refusal does not reuse HYPERDRIVE_CONFIG (bt-production)"
grep -qF 'checkCopyTarget' "$RUN" 2>/dev/null || bad 5 "the command does not check its target with checkCopyTarget"
for f in $(story_changed_files S117 "$BASE" functions/src); do
  [ -f "$f" ] || continue
  if story_diff S117 "$BASE" -- "$f" | grep -E '^\+' | grep -qE 'new URL\([^)]*\)\.hostname|\.hostname\b'; then
    bad 5 "$f adds a URL hostname read; use databaseTarget"
  fi
done
grep -qE '\.hostname' "$TARGET" "$SCRIPT" "$SERVICE" "$RUN" 2>/dev/null && bad 5 "a copy file reads a URL hostname"
run_vitest 5 functions "$TARGET_TEST" -t "production"
run_vitest 5 functions "$TARGET_TEST" -t "deploy staging first"
run_vitest 5 functions "$RUN_TEST" -t "refused"

# --- Check 6: README ----------------------------------------------------------------------------------------------------
for s in "pnpm db:copy-baseball" "BT_SOURCE_DATABASE_URL" "BT_DATABASE_URL" "Copy baseball data" "deletion log" "never deletes" "renamed" "No deploy"; do
  grep -qF -- "$s" README.md || bad 6 "README.md does not mention $s"
done

# --- Check 7: Status done, inside the fence -------------------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S117\].*\| `done` \|$' docs/v3/BACKLOG.md || bad 7 "S117 row in the Story status table is not \`done\`"
awk '/^### S117 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s117.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s117.md" || bad 7 "S117 story heading Status is not \`done\`"
story_changed_files S117 "$BASE" . | grep -vE '^(functions/|\.github/workflows/|package\.json$|pnpm-lock\.yaml$|README\.md$|docs/v3/BACKLOG\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S117\.sh$)' >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 7 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"

report "verify-S117"
exit $?
