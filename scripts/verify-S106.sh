#!/usr/bin/env bash
# Grader for BACKLOG story S106 — the Live room's win-probability chart (game-rooms
# live-medium / live-desktop, hidden as A5's live-hidden-status-medium).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "winProbabilitySeries(game) in packages/domain: the home team's chance after each at-bat with play metrics, in order, each with its inning, plus the current value; on 823823 one point per measured at-bat ending at 0 or 100; none without metrics (unit tests named 'S106 AC 1')"
check 2 "medium and desktop: the card under the status card, beside the zone — 'Win probability (HOME)', the current percent top right, the line with the area under it, a dashed 50% line, the innings along the bottom; no card at mobile (RTL named 'S106 AC 2')"
check 3 "Hide Scores on: same title and size, '–' and 'Hidden with scores', no line or value (RTL named 'S106 AC 3')"
check 4 "no play metrics: no card, the room as S64 built it (RTL named 'S106 AC 4')"
check 5 "a newer game in the cache with another at-bat's metrics adds that point without a reload (RTL named 'S106 AC 5')"
check 6 "one chart component, no new charting dependency, pnpm size within 200 KB; the story's files have no team logo and no useMediaQuery / hiddenFrom / visibleFrom outside web/src/layout/"
check 7 "design captures live-medium (768), live-desktop (1200) and live-hidden-status-medium (768) saved by e2e/design/S106.spec.ts under docs/v3/design-checks/S106/"
check 8 "backlog Status is done (story heading and Story status table)"

# The commit S106 started from (HEAD when its grader was written).
BASE=431bca0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
WT="src/components/game/WinProbabilityCard.test.tsx"

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

# --- Check 1: the series --------------------------------------------------------------------
grep -rqE 'export function winProbabilitySeries' packages/domain/src || bad 1 "no winProbabilitySeries in packages/domain/src"
run_vitest 1 packages/domain src/win-probability.test.ts -t "S106 AC 1"

# --- Checks 2–5: the card ---------------------------------------------------------------------
run_vitest 2 web "$WT" -t "S106 AC 2"
run_vitest 3 web "$WT" -t "S106 AC 3"
run_vitest 4 web "$WT" -t "S106 AC 4"
run_vitest 5 web "$WT" -t "S106 AC 5"

# --- Check 6: one component, no dependency, budget, no logos or media queries ------------------
[ "$(grep -rlE 'export function WinProbability(Card|Chart)' web/src --include='*.tsx' | grep -vc '\.test\.tsx$')" = 1 ] ||
	bad 6 "not exactly one WinProbability chart component under web/src"
story_diff S106 "$BASE" -- web/package.json package.json | grep -E '^\+' | grep -iE 'chart|d3|victory|nivo|plot|visx' &&
	bad 6 "S106 adds a charting dependency"
pnpm -s size > "$TMP/size.log" 2>&1 || {
	bad 6 "pnpm size fails:"
	tail -8 "$TMP/size.log" | sed 's/^/        /'
}
for f in $(story_changed_files S106 "$BASE" web/src); do
	[ -f "$f" ] || continue
	case "$f" in web/src/layout/*) continue ;; esac
	grep -qE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" && bad 6 "$f chooses layout with a media query"
	grep -qiE 'TeamLogo|logo\.(svg|png)|/logos/' "$f" && bad 6 "$f draws a team logo"
done

# --- Check 7: design captures at their pairing widths ------------------------------------------
[ -f e2e/design/S106.spec.ts ] || bad 7 "e2e/design/S106.spec.ts missing"
for pair in live-medium:768 live-desktop:1200 live-hidden-status-medium:768; do
	f="docs/v3/design-checks/S106/${pair%%:*}.png"
	if [ ! -f "$f" ]; then
		bad 7 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "${pair##*:}" ] || bad 7 "$f is ${w}px wide, not ${pair##*:}"
	fi
done

# --- Check 8: backlog Status is done ------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S106\].*\| `done` \|' docs/v3/BACKLOG.md ||
	bad 8 "S106 row in the Story status table is not \`done\`"
awk '/^### S106 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md |
	grep -qE '^\*\*Status:\*\* `done`$' || bad 8 "S106 story heading Status is not \`done\`"

report "verify-S106"
exit $?
