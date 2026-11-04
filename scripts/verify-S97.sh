#!/usr/bin/env bash
# Grader for BACKLOG story S97 — video cards and the player link to their play in the Plays
# room; the room opens on it and marks every at-bat that has a video (game-shell A5,
# game-rooms A6, ratified by S96).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "a video with a playId shows 'Play · <half> <inning> →' on its own line under its meta line, grid and list; none without; 20 on 823823; choosing it navigates without opening the player (RTL named 'S97 AC 1')"
check 2 "the floating player shows the play link top left when its clip has a playId and no game link holds that slot; choosing it closes the player and opens the play (RTL named 'S97 AC 2')"
check 3 "no play icon on any Videos room thumbnail, grid and list, scores shown and hidden; every still keeps its duration (RTL named 'S97 AC 3')"
check 4 "/game/:gamePk/plays?play=<playId> chooses the play's inning, opens and marks its at-bat with the bar, scrolls it into view; an unknown play opens as usual (RTL named 'S97 AC 4')"
check 5 "'Video: <clip title>' above every at-bat with a video, with or without ?play=; one line per distinct at-bat on 823823 (RTL named 'S97 AC 5')"
check 6 "the 11 design captures from e2e/design/S97.spec.ts under docs/v3/design-checks/S97/ at their pairing widths"
check 7 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
VT="src/components/videos/VideoPlayLinks.test.tsx"

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

for n in 1 2 3 4 5; do run_vitest "$n" web "$VT" -t "S97 AC $n"; done
# AC 3 also by source: the still draws no play icon.
grep -qE 'IconPlayerPlay\b' web/src/components/videos/VideoCard.tsx && bad 3 "VideoCard.tsx still imports or draws IconPlayerPlay"

# --- Check 6: the 11 captures at their pairing widths --------------------------------------
[ -f e2e/design/S97.spec.ts ] || bad 6 "e2e/design/S97.spec.ts missing"
for frame in game-videos-grid-playlink-mobile game-videos-grid-playlink-medium game-videos-grid-playlink-desktop \
	game-videos-list-playlink-mobile game-videos-list-playlink-medium game-videos-list-playlink-desktop \
	video-player-dialog-playlink-mobile video-player-dialog-playlink-medium \
	plays-opened-mobile plays-opened-medium plays-opened-desktop; do
	case "$frame" in *-mobile) want=390 ;; *-medium) want=768 ;; *-desktop) want=1200 ;; esac
	f="docs/v3/design-checks/S97/$frame.png"
	if [ ! -f "$f" ]; then
		bad 6 "$f missing"
	else
		w=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$f")
		[ "$w" = "$want" ] || bad 6 "$f is ${w}px wide, not $want"
	fi
done

# --- Check 7: backlog Status is done --------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S97\].*\| `done` \|' docs/v3/BACKLOG.md ||
	bad 7 "S97 row in the Story status table is not \`done\`"
awk '/^### S97 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md |
	grep -qE '^\*\*Status:\*\* `done`$' || bad 7 "S97 story heading Status is not \`done\`"

report "verify-S97"
exit $?
