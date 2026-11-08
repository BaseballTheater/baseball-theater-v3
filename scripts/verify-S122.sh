#!/usr/bin/env bash
# Grader for BACKLOG story S122 — Backfill every game between two dates, gently, resumably,
# back to 1901 (owner, 2026-11-07). `pnpm mlb:backfill` walks newest to oldest, skips the
# off-season, stores each day through ingest's version-guarded path, paces itself per host,
# gives up an extra source after 14 failed days, keeps its resume state per database, and
# reports the game tables' sizes. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "pnpm mlb:backfill [--from] [--to]: --to defaults to mlbToday, --from to a year before, nothing before 1901-04-18; BT_DATABASE_URL else localConnectionString (one implementation, shared with db:seed); production refused without --allow-production (local always allowed, other hosts refused unless NEON_API_KEY shows a non-default branch)"
check 2 "isOffSeasonDay in packages/domain skips Nov 15 through Feb 15 (boundaries 11-14, 11-15, 02-15, 02-16 tested) and the backfill makes no request for those days"
check 3 "a day is stored through ingest's version-guarded path (storeSchedule / ingestGame); 823823 through PGlite is not rewritten when unchanged"
check 4 "idempotent and resumable: a second run asks MLB nothing for complete days and writes nothing; a missing or older projection is repaired without MLB; unsettled days are re-checked; a stopped run resumes with total requests equal to one clean run's"
check 5 "the walk goes newest to oldest"
check 6 "per-host pacing: at most 2 requests in flight per host, minimum gaps (named constants, >= 1 s recent, >= 3 s older than 10 years, overridable by flag), exponential per-host backoff on 429/5xx honoring Retry-After"
check 7 "each extra source (content, play metrics, GraphQL) is given up after 14 consecutive failed days of games, the streak survives a split run, and the live feed is never given up"
check 8 "resume state lives in a git-ignored file keyed by the database's host and name; a different database starts fresh"
check 9 "progress lines while running and a final report of rows and pg_total_relation_size for schedule_days, games and game_projections (tested on PGlite)"
check 10 "tests never reach MLB: no statsapi.mlb.com request outside the HTTP adapter"
check 11 "README documents the command, defaults, off-season skip, pacing, give-up rule, resuming, the local default and --allow-production"
check 12 "backlog Status is done (story heading and Story status table), and the story stays inside its scope files"

BASE=e25c276516d0dded2b0d501cabedb9ac763ba204
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DOMAIN_FN="packages/domain/src/backfill.ts"
DOMAIN_TEST="src/backfill.test.ts"
SERVICE="functions/src/services/backfill.ts"
SERVICE_TEST="src/services/backfill.test.ts"
PACE_TEST="src/services/polite-fetch.test.ts"
GUARD_TEST="src/services/backfill-target.test.ts"

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

# --- Check 1: the command, its dates, its database and the production guard ---------------------------
grep -qE '"mlb:backfill": *"pnpm --filter @bt/functions exec tsx src/scripts/backfill\.ts"' package.json || bad 1 "package.json has no mlb:backfill script running functions/src/scripts/backfill.ts"
[ -f functions/src/scripts/backfill.ts ] || bad 1 "functions/src/scripts/backfill.ts missing"
grep -qF 'mlbToday' functions/src/scripts/backfill.ts 2>/dev/null || bad 1 "the command does not default --to with mlbToday"
grep -qF 'BT_DATABASE_URL' functions/src/scripts/backfill.ts 2>/dev/null || bad 1 "the command does not read BT_DATABASE_URL"
grep -qF -- '--allow-production' functions/src/scripts/backfill.ts 2>/dev/null || bad 1 "the command has no --allow-production flag"
n="$(grep -rlE 'function localConnectionString\(' functions/src | wc -l)"
[ "$n" = 1 ] || bad 1 "localConnectionString is defined in $n files, want 1"
grep -qE 'function localConnectionString\(' functions/src/scripts/db-seed.ts && bad 1 "db-seed.ts still keeps its own localConnectionString"
grep -qF 'localConnectionString' functions/src/scripts/backfill.ts 2>/dev/null || bad 1 "the command does not use localConnectionString"
grep -qF 'BACKFILL_EARLIEST_DATE = "1901-04-18"' "$DOMAIN_FN" 2>/dev/null || bad 1 "$DOMAIN_FN has no BACKFILL_EARLIEST_DATE = 1901-04-18"
run_vitest 1 packages/domain "$DOMAIN_TEST" -t "range"
run_vitest 1 functions src/scripts/backfill-args.test.ts
run_vitest 1 functions "$GUARD_TEST" -t "production"

# --- Check 2: the off-season ------------------------------------------------------------------------------
grep -qE 'export function isOffSeasonDay\(' "$DOMAIN_FN" 2>/dev/null || bad 2 "$DOMAIN_FN does not export isOffSeasonDay"
grep -qF 'backfill.js' packages/domain/src/index.ts || bad 2 "packages/domain/src/index.ts does not export backfill"
for d in 11-14 11-15 02-15 02-16; do
  grep -qF -- "-$d" "packages/domain/$DOMAIN_TEST" 2>/dev/null || bad 2 "the domain test does not test the $d boundary"
done
run_vitest 2 packages/domain "$DOMAIN_TEST" -t "off-season"
run_vitest 2 functions "$SERVICE_TEST" -t "off-season"

# --- Check 3: ingest's store path -------------------------------------------------------------------------
grep -qE 'ingestGame' "$SERVICE" 2>/dev/null || bad 3 "the backfill does not store games through ingestGame"
grep -qE 'storeSchedule' "$SERVICE" 2>/dev/null || bad 3 "the backfill does not store days through storeSchedule"
grep -qE '\.upsert\(' "$SERVICE" 2>/dev/null && bad 3 "the backfill writes a repository directly instead of through ingest"
run_vitest 3 functions "$SERVICE_TEST" -t "823823"

# --- Check 4: idempotent and resumable ---------------------------------------------------------------------
for t in "second run" "repairs" "unsettled" "resumes"; do
  run_vitest 4 functions "$SERVICE_TEST" -t "$t"
done

# --- Check 5: newest to oldest ------------------------------------------------------------------------------
run_vitest 5 functions "$SERVICE_TEST" -t "newest"

# --- Check 6: pacing ---------------------------------------------------------------------------------------
grep -qE 'export const MAX_IN_FLIGHT_PER_HOST = 2;' functions/src/services/polite-fetch.ts 2>/dev/null || bad 6 "no MAX_IN_FLIGHT_PER_HOST = 2"
grep -qE 'export const RECENT_GAP_MS = [0-9_]+;' functions/src/services/polite-fetch.ts 2>/dev/null || bad 6 "no RECENT_GAP_MS constant"
grep -qE 'export const OLD_GAP_MS = [0-9_]+;' functions/src/services/polite-fetch.ts 2>/dev/null || bad 6 "no OLD_GAP_MS constant"
node -e '
const t = require("fs").readFileSync("functions/src/services/polite-fetch.ts", "utf8");
const n = (k) => Number((new RegExp(k + " = ([0-9_]+);").exec(t) || [, "0"])[1].replace(/_/g, ""));
process.exit(n("RECENT_GAP_MS") >= 1000 && n("OLD_GAP_MS") >= 3000 ? 0 : 1);
' 2>/dev/null || bad 6 "the gaps are below 1 s recent / 3 s older"
grep -qF -- '--gap-ms' functions/src/scripts/backfill-args.ts 2>/dev/null || bad 6 "no --gap-ms flag"
grep -qF -- '--old-gap-ms' functions/src/scripts/backfill-args.ts 2>/dev/null || bad 6 "no --old-gap-ms flag"
for t in "in flight" "gap" "older" "429" "Retry-After" "5xx"; do
  run_vitest 6 functions "$PACE_TEST" -t "$t"
done
run_vitest 6 functions "$SERVICE_TEST" -t "pacing"

# --- Check 7: giving up a source ---------------------------------------------------------------------------
grep -qE 'export const GIVE_UP_AFTER_DAYS = 14;' "$DOMAIN_FN" 2>/dev/null || bad 7 "no GIVE_UP_AFTER_DAYS = 14 in the domain"
run_vitest 7 packages/domain "$DOMAIN_TEST" -t "streak"
for t in "gives up" "split run" "live feed"; do
  run_vitest 7 functions "$SERVICE_TEST" -t "$t"
done
grep -qE 'fetchGameFeed\(gamePk: number\)' packages/ports/src/mlb.ts || bad 7 "the port has no feed-only fetchGameFeed"
for f in functions/src/adapters/http/mlb.ts functions/src/adapters/fixtures/fixture-client.ts; do
  grep -qE 'async fetchGameFeed\(' "$f" || bad 7 "$f has no fetchGameFeed"
  grep -qE 'async fetchGameEditorial\(' "$f" || bad 7 "$f has no fetchGameEditorial"
done

# --- Check 8: the resume file --------------------------------------------------------------------------------
grep -qxF '.backfill/' .gitignore || bad 8 ".gitignore does not ignore .backfill/"
run_vitest 8 functions "$SERVICE_TEST" -t "resume file"

# --- Check 9: progress and the size report -----------------------------------------------------------------------
grep -qF 'pg_total_relation_size' functions/src/services/backfill-report.ts 2>/dev/null || bad 9 "the report does not use pg_total_relation_size"
run_vitest 9 functions src/services/backfill-report.test.ts
run_vitest 9 functions "$SERVICE_TEST" -t "progress"

# --- Check 10: tests never reach MLB ------------------------------------------------------------------------------
story_changed_files S122 "$BASE" functions/src packages | grep -vE '^functions/src/adapters/http/mlb\.ts$' >"$TMP/files.txt"
while read -r f; do
  [ -f "$f" ] || continue
  if grep -qE 'fetch\([^)]*statsapi\.mlb\.com' "$f"; then bad 10 "$f requests statsapi.mlb.com"; fi
  case "$f" in *.test.ts)
    if grep -qE 'new HttpMlbStatsClient\(\)' "$f"; then bad 10 "$f builds an HttpMlbStatsClient on the real fetch"; fi ;;
  esac
done <"$TMP/files.txt"
grep -qE 'new HttpMlbStatsClient\(' functions/src/scripts/backfill.ts 2>/dev/null || bad 10 "the command does not use the HTTP adapter"

# --- Check 11: README -----------------------------------------------------------------------------------------
for s in "pnpm mlb:backfill" "1901-04-18" "November 15" "February 15" "2 requests" "14" "resume" "BT_DATABASE_URL" "--allow-production" "pg_total_relation_size"; do
  grep -qF -- "$s" README.md || bad 11 "README.md does not mention $s"
done

# --- Check 12: Status done, inside the fence ------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S122\].*\| `done` \|$' docs/v3/BACKLOG.md || bad 12 "S122 row in the Story status table is not \`done\`"
awk '/^### S122 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s122.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s122.md" || bad 12 "S122 story heading Status is not \`done\`"
story_changed_files S122 "$BASE" . | grep -vE '^(functions/|packages/domain/|packages/ports/|package\.json$|pnpm-lock\.yaml$|README\.md$|\.gitignore$|docs/v3/BACKLOG\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S122\.sh$|docs/v3/\.obsidian/)' >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 12 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"

report "verify-S122"
exit $?
