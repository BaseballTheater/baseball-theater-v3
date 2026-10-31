#!/usr/bin/env bash
# Grader for BACKLOG story S19 — the web client follows a watched game live (ADR-020,
# ADR-022, ADR-014): a WebSocket to /api/v1/games/:gamePk/live for an in-progress game,
# newer versions only through S25's cache writer, reconnect with backoff and ?since=, a
# refetch on a version gap, a polling fallback, reconnect on visible / online, close on
# leave; open rows, a selected pitch and a playing video survive an update; the Live
# panel's render count holds its baseline. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "an in-progress game route opens a WebSocket to /api/v1/games/:gamePk/live (test); web/src has no EventSource"
check 2 "two socket payloads: the Live status block shows the second's values without navigation, and the top bar shows no score before or after (test file exits 0 alone)"
check 3 "payloads reach the cache only through writeGame and only when newer: v2, v2, v1 leaves v2, written once (test)"
check 4 "on close it reconnects with backoff and jitter, passing ?since=<last version> (fake-timer test)"
check 5 "a version gap (v2 then v4) refetches the game query (test)"
check 6 "after repeated failures it falls back to polling GET /api/v1/games/:gamePk (fake-timer test)"
check 7 "it reconnects on visibilitychange → visible and on online (test)"
check 8 "unmounting or leaving the route closes the socket (test)"
check 9 "an update keeps an open at-bat row, a selected pitch and a playing video (test)"
check 10 "the Live panel's render count for one streamed update stays at its baseline (S54 helper)"
check 11 "design match: e2e/design/S19.spec.ts names live-mobile and game-phase-live-mobile; docs/v3/design-checks/S19/ holds them at 390"
check 12 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ST="src/api/live.test.ts"
PT="src/pages/GamePage.live.test.tsx"

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

# --- Check 1: the socket -----------------------------------------------------------------------
grep -rqw 'EventSource' web/src && bad 1 "web/src mentions EventSource"
run_vitest 1 web "$PT" -t "opens a WebSocket"

# --- Check 2: two payloads, no score in the top bar ---------------------------------------------
run_vitest 2 web "$PT"
run_vitest 2 web "$PT" -t "second payload"

# --- Check 3..7: the stream ---------------------------------------------------------------------
grep -qw 'writeGame' web/src/api/live.ts 2>/dev/null || bad 3 "web/src/api/live.ts does not write through writeGame"
grep -rqE 'setQueryData' web/src --include='*.ts' --include='*.tsx' -l | grep -v 'web/src/api/game.ts' | grep -v '\.test\.' >/dev/null && bad 3 "setQueryData outside web/src/api/game.ts"
run_vitest 3 web "$ST" -t "newer"
run_vitest 4 web "$ST" -t "reconnects"
run_vitest 5 web "$ST" -t "gap"
run_vitest 6 web "$ST" -t "polling"
run_vitest 7 web "$ST" -t "visible"
run_vitest 7 web "$ST" -t "online"

# --- Check 8: close on leave --------------------------------------------------------------------
run_vitest 8 web "$PT" -t "closes"

# --- Check 9: state survives --------------------------------------------------------------------
run_vitest 9 web "$PT" -t "keeps"

# --- Check 10: render count ---------------------------------------------------------------------
grep -qw 'createRenderCounter' "web/$PT" 2>/dev/null || bad 10 "$PT does not use the S54 render counter"
run_vitest 10 web "$PT" -t "render count"

# --- Check 11: design match ---------------------------------------------------------------------
S="e2e/design/S19.spec.ts"
for fw in live-mobile:390 game-phase-live-mobile:390; do
  name="${fw%%:*}"; w="${fw##*:}"; png="docs/v3/design-checks/S19/$name.png"
  grep -qF "\"$name\"" "$S" 2>/dev/null || bad 11 "$S does not name $name"
  if [ -f "$png" ]; then
    [ "$(png_width "$png")" = "$w" ] || bad 11 "$png is $(png_width "$png")px wide, want $w"
  else
    bad 11 "$png missing"
  fi
done

# --- Check 12: backlog Status is done -----------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S19\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 12 "S19 row in the Story status table is not \`done\`"
awk '/^### S19 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s19.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s19.md" || bad 12 "S19 story heading Status is not \`done\`"

report "verify-S19"
exit $?
