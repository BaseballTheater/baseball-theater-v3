#!/usr/bin/env bash
# Grader for BACKLOG story S112 — the dev seed: `pnpm seed:refresh` records a date range (by
# default the most recent season's last month of the regular season through its last postseason
# game) through HttpMlbStatsClient into one gzipped, git-ignored file; `pnpm dev` loads it into
# the local Postgres idempotently (or says how to make it); the dev composition serves seeded
# days and games from the store without asking MLB; README documents it; no test or `pnpm verify`
# touches the seed file or the network. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No Docker. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "pnpm seed:refresh --start= --end= records every day in the range and its games (hydrated) through HttpMlbStatsClient into one gzipped file at a git-ignored path; no dates means the last season's final regular-season month through its last postseason game (test against a recorded fetch stand-in, named 'S112 AC 1')"
check 2 "pnpm dev (db:seed) loads the seed file into the local Postgres through the repositories, twice changing nothing (PGlite test named 'S112 AC 2'); without the file it starts as before and prints the command that makes one"
check 3 "the dev composition serves a seeded, final game and its day from the store on a refresh-on-read, asking MLB nothing (test named 'S112 AC 3')"
check 4 "README documents pnpm seed:refresh: its dates and defaults, size and time to expect, where the file goes, and that CI and pnpm verify never use it"
check 5 "no test reads the seed file or the network: tests name no default seed path and give every HttpMlbStatsClient a fetch stand-in"
check 6 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SEED_SRC="functions/src/services/dev-seed.ts"
SEED_DIR=".dev-seed"

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

# --- Check 1: the refresh command ------------------------------------------------------------------------
REFRESH="$(node -e 'process.stdout.write(require("./package.json").scripts["seed:refresh"] ?? "")')"
[ -n "$REFRESH" ] || bad 1 "package.json has no seed:refresh script"
if [ -f "$SEED_SRC" ]; then
  grep -qw 'HttpMlbStatsClient' functions/src/scripts/seed-refresh.ts 2>/dev/null || bad 1 "functions/src/scripts/seed-refresh.ts does not record through HttpMlbStatsClient"
  grep -qE 'gzip|createGzip|gzipSync' "$SEED_SRC" || bad 1 "$SEED_SRC does not gzip the seed file"
  grep -qF "$SEED_DIR" "$SEED_SRC" || bad 1 "$SEED_SRC does not write under $SEED_DIR/"
  grep -qw 'fetchSeasonCalendar' "$SEED_SRC" || bad 1 "$SEED_SRC does not take its default range from the season calendar (S111)"
else
  bad 1 "$SEED_SRC missing"
fi
grep -qxE "/?\\$SEED_DIR/?" .gitignore || bad 1 ".gitignore does not name $SEED_DIR/"
run_vitest 1 functions src/services/dev-seed.test.ts -t "S112 AC 1"

# --- Check 2: loaded on dev start ---------------------------------------------------------------------------
DEV="$(node -e 'process.stdout.write(require("./package.json").scripts.dev ?? "")')"
echo "$DEV" | grep -qE 'db:seed' || bad 2 "the root dev script no longer runs pnpm db:seed"
grep -qE 'loadDevSeed|readDevSeed' functions/src/scripts/db-seed.ts || bad 2 "db:seed (run by pnpm dev) does not load the seed file"
grep -qF 'pnpm seed:refresh' functions/src/scripts/db-seed.ts || bad 2 "db:seed does not print the command that makes the seed file when it is missing"
run_vitest 2 functions src/services/dev-seed.test.ts -t "S112 AC 2"

# --- Check 3: served from the store ----------------------------------------------------------------------------
run_vitest 3 functions src/worker-app.test.ts -t "S112 AC 3"

# --- Check 4: README ------------------------------------------------------------------------------------------------
for phrase in "pnpm seed:refresh" "--start=" "--end=" "$SEED_DIR" "MB" "minutes" "pnpm verify"; do
  grep -qF -- "$phrase" README.md || bad 4 "README.md does not mention \"$phrase\""
done
grep -qiE 'CI.{0,80}never|never.{0,80}CI' README.md || bad 4 "README.md does not say CI never uses the seed"

# --- Check 5: no test reads the seed file or the network ---------------------------------------------------------------
TESTS="$(git ls-files -co --exclude-standard -- '*.test.ts' '*.test.tsx')"
if [ -n "$TESTS" ]; then
  # shellcheck disable=SC2086
  grep -nE 'DEFAULT_SEED_(PATH|FILE)|\.dev-seed' $TESTS >"$TMP/seedpath.txt" && { bad 5 "a test names the default seed file:"; sed 's/^/        /' "$TMP/seedpath.txt"; }
  # shellcheck disable=SC2086
  grep -nE 'new HttpMlbStatsClient\(\s*\)' $TESTS >"$TMP/net.txt" && { bad 5 "a test builds HttpMlbStatsClient without a fetch stand-in:"; sed 's/^/        /' "$TMP/net.txt"; }
fi
if [ -f functions/src/services/dev-seed.test.ts ]; then
  # The stand-in lives in one shared test helper (the AC 3 test records through it too).
  STANDIN="functions/src/test/recorded-mlb.ts"
  grep -qE 'from "\.\./test/recorded-mlb\.js"' functions/src/services/dev-seed.test.ts || bad 5 "dev-seed.test.ts does not record through the fetch stand-in ($STANDIN)"
  grep -qw 'fetchImpl' "$STANDIN" 2>/dev/null || bad 5 "$STANDIN does not give HttpMlbStatsClient a fetch stand-in"
  grep -qE 'mkdtemp|tmpdir' functions/src/services/dev-seed.test.ts || bad 5 "dev-seed.test.ts does not write its seed file to a temporary directory"
fi

# --- Check 6: backlog Status is done ---------------------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S112\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 6 "S112 row in the Story status table is not \`done\`"
awk '/^### S112 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s112.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s112.md" || bad 6 "S112 story heading Status is not \`done\`"

report "verify-S112"
