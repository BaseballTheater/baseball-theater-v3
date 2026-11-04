#!/usr/bin/env bash
# Grader for BACKLOG story S98 — rank videos by how much their play changed the odds of
# winning (S93's play metrics, S95's video → play links).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "rankHighlightsByImpact in packages/domain ranks a clip with a play by the absolute win probability its play added, key moments and lead changes first among ties, clips without a play by keyword score after them; withGameExtras hands it the play metrics, the one place it runs with them (unit tests named 'S98 AC 1')"
check 2 "on 823823 the server's order puts the clip of the largest win-probability swing first, and Griffin Conine's two-run home run (+19.6%) above the solo home runs that swung less (test named 'S98 AC 2')"
check 3 "with no play metrics the order is today's keyword order (test named 'S98 AC 3')"
check 4 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FT="src/mappers/game-extras.test.ts"

run_vitest() {
	local id="$1" dir="$2" file="$3"
	shift 3
	if [ ! -f "$dir/$file" ]; then
		bad "$id" "$dir/$file missing"
	elif ! (cd "$dir" && pnpm exec vitest run "$file" "$@" --reporter=json --outputFile="$TMP/r.json" > "$TMP/r.log" 2>&1); then
		bad "$id" "$dir/$file $* failed:"
		tail -15 "$TMP/r.log" | sed 's/^/        /'
	elif ! node -e 'process.exit(require(process.argv[1]).numPassedTests > 0 ? 0 : 1)' "$TMP/r.json"; then
		bad "$id" "$dir/$file $* ran no passing test"
	fi
}

# --- Check 1: the rule, in one place -----------------------------------------------------------
I="packages/domain/src/impact.ts"
grep -qE 'WinProbabilityAdded' "$I" || bad 1 "$I does not read the win probability a play added"
grep -qE 'keyMoment' "$I" || bad 1 "$I does not order key moments first among ties"
grep -qE 'leadChange' "$I" || bad 1 "$I does not order lead changes first among ties"
# The rank's own second argument carries the metrics (not the nested videoPlayLinks call).
# (The call is formatted over several lines, so read the file as one.)
tr '\n' ' ' < functions/src/mappers/game-extras.ts | grep -qE 'rankHighlightsByImpact\([A-Za-z]+,[[:space:]]*\{[^}]*playMetrics' ||
	bad 1 "withGameExtras does not hand the play metrics to rankHighlightsByImpact"
# No second ranking by win probability anywhere else in product code.
others=$(grep -rlE 'WinProbabilityAdded' packages/domain/src functions/src web/src --include='*.ts' --include='*.tsx' |
	grep -vE '\.test\.tsx?$' | grep -vE '^(packages/domain/src/(impact|types)\.ts|functions/src/mappers/play-metrics\.ts)$' |
	xargs -r grep -lE 'sort\(' 2> /dev/null)
[ -z "$others" ] || bad 1 "another file sorts by win probability added: $others"
run_vitest 1 packages/domain src/impact.test.ts -t "S98 AC 1"

# --- Check 2: 823823 on the server ---------------------------------------------------------------
run_vitest 2 functions "$FT" -t "S98 AC 2"

# --- Check 3: no play metrics, keyword order ----------------------------------------------------
run_vitest 3 functions "$FT" -t "S98 AC 3"

# --- Check 4: backlog Status is done --------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S98\].*\| `done` \|' docs/v3/BACKLOG.md ||
	bad 4 "S98 row in the Story status table is not \`done\`"
awk '/^### S98 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md |
	grep -qE '^\*\*Status:\*\* `done`$' || bad 4 "S98 story heading Status is not \`done\`"

report "verify-S98"
exit $?
