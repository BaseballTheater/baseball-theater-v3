#!/usr/bin/env bash
# Grader for BACKLOG story S110 — the first download has room to grow: the game, standings,
# search and settings pages load on demand as their own chunks (React.lazy), the scoreboard
# stays in the entry, a lazy page shows ViewState's loading treatment while it arrives, and
# the entry chunk sits at least 15,000 bytes under ADR-026's 200 KB budget. A commit-time
# proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp (the web build goes to a temp dir). Does its own
# checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "routes.tsx loads GamePage, StandingsPage, SearchPage and SettingsPage with React.lazy; ScoreboardPage stays eager (grep); the routes tests pass"
check 2 "while a lazy page loads, the fallback is ViewState's loading treatment (RTL with a deferred import)"
check 3 "the built entry chunk (web/dist/assets/index-*.js, gzip) is at least 15,000 bytes under the 200 KB limit"
check 4 "files this story adds or edits reference no team logo and read no viewport outside web/src/layout/"
check 5 "backlog Status is done (story heading and Story status table)"

BASE=ef5e6ed
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
RS="web/src/routes.tsx"

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

# --- Check 1: lazy routes, eager scoreboard ------------------------------------------------------
for page in GamePage StandingsPage SearchPage SettingsPage; do
  grep -qE "lazy\(\(\) => import\(\"\./pages/$page\.js\"\)" "$RS" || bad 1 "$RS does not lazy-load $page"
  grep -qE "^import \{[^}]*\b$page\b[^}]*\} from \"\./pages/$page\.js\"" "$RS" && bad 1 "$RS still imports $page statically"
done
grep -qE '^import \{ ScoreboardPage \} from "\./pages/ScoreboardPage\.js"' "$RS" || bad 1 "$RS does not import ScoreboardPage eagerly"
run_vitest 1 web src/routes.test.tsx

# --- Check 2: the fallback is ViewState loading --------------------------------------------------
grep -qE '<Suspense fallback=\{<ViewState kind="loading"' "$RS" || bad 2 "$RS's Suspense fallback is not <ViewState kind=\"loading\" …>"
run_vitest 2 web src/routes.lazy.test.tsx -t "fallback"

# --- Check 3: the entry chunk's headroom ---------------------------------------------------------
# Built to a temp dir; measured as .size-limit.json measures it (the files matching
# web/dist/assets/index-*.js, gzipped), so the grader writes nothing in the tree.
if ! (cd web && pnpm exec vite build --outDir "$TMP/dist" --emptyOutDir >"$TMP/build.log" 2>&1); then
  bad 3 "vite build failed:"; tail -10 "$TMP/build.log" | sed 's/^/        /'
else
  SIZE="$(node -e '
    const fs = require("fs"), path = require("path"), zlib = require("zlib");
    const dir = path.join(process.argv[1], "assets");
    const files = fs.readdirSync(dir).filter((f) => /^index-.*\.js$/.test(f));
    let total = 0;
    for (const f of files) total += zlib.gzipSync(fs.readFileSync(path.join(dir, f)), { level: 9 }).length;
    process.stdout.write(String(total));
  ' "$TMP/dist")"
  LIMIT="$(node -e 'const c=require("./.size-limit.json");const l=String(c[0].limit).match(/^(\d+)\s*KB$/i);process.stdout.write(String(l?Number(l[1])*1000:0))')"
  if [ "$LIMIT" -eq 0 ]; then
    bad 3 ".size-limit.json's limit is not in KB"
  elif [ "$SIZE" -gt $((LIMIT - 15000)) ]; then
    bad 3 "the entry chunk is $SIZE bytes gzipped, $((LIMIT - SIZE)) under $LIMIT; want at least 15000 under"
  else
    echo "  entry chunk: $SIZE bytes gzipped, $((LIMIT - SIZE)) under $LIMIT"
  fi
fi

# --- Check 4: no logos, no viewport --------------------------------------------------------------
for f in $(story_changed_files S110 "$BASE" web/src); do
  [ -f "$f" ] || continue
  grep -nE '<img[^>]*logo|/logos/' "$f" >/dev/null && bad 4 "$f references a team logo"
  case "$f" in
    web/src/layout/*) ;;
    *) grep -nwE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" >/dev/null && bad 4 "$f reads the viewport" ;;
  esac
done

# --- Check 5: backlog Status is done -------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S110\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 5 "S110 row in the Story status table is not \`done\`"
awk '/^### S110 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s110.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s110.md" || bad 5 "S110 story heading Status is not \`done\`"

report "verify-S110"
exit $?
