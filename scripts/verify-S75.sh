#!/usr/bin/env bash
# Grader for BACKLOG story S75 — Hide Scores in the game rooms and the recap video title
# (S57; game-rooms A3–A5, game-shell A2–A3): Live masks the score in its status, an in-play
# pitch that scored reads "IN PLAY", Plays' linescore masks every inning and R·H·E while Box's
# stays, the Runs view masks the score after each play, the Recap heading reads "Recap", and on
# the game page the recap clip is titled "Recap (score hidden)". A commit-time proof of this
# story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "with Hide Scores on, Live's status reads {AWY} – · {HOM} – through HiddenValue; inning, pips, result and batter's line unchanged; no Count: or outs text (RTL)"
check 2 "pitchCallLabel(pitch, scoresHidden) in packages/domain (unit test); the pitch sequence and zone use it, no other in-play label in web/src"
check 3 "the shared Linescore takes a hidden mode: Plays masks every inning cell and R·H·E; Box renders the same with Hide Scores on and off (RTL)"
check 4 "the Runs view masks the score after each scoring play; descriptions unchanged (RTL)"
check 5 "recapHeading(recap, scoresHidden) in packages/domain (unit test); the Recap room renders it with the body and Source: MLB unchanged (RTL)"
check 6 "isGameRecapHighlight and highlightTitle in packages/domain (unit tests), the content mapper's one recap rule; the game page's video card and player title use it; other titles and Search unchanged (RTL)"
check 7 "every hidden decision comes from useScoresHidden(game); nothing reads the setting directly; no Scores hidden / spoiler-free text in web/src"
check 8 "files this story adds or edits reference no team logo and read no viewport outside web/src/layout/"
check 9 "design match: e2e/design/S75.spec.ts names the hidden-scores frames it builds; docs/v3/design-checks/S75/ holds them at their pairing widths"
check 10 "backlog Status is done (story heading and Story status table)"

BASE=8e82a75
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
RT="src/components/game/HideScoresRooms.test.tsx"

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

domain_fn() {
  local id="$1" fn="$2" test="$3"
  grep -rqE "export function $fn\(" packages/domain/src || bad "$id" "packages/domain exports no $fn"
  grep -qE "describe\(\"$fn" "packages/domain/src/$test" 2>/dev/null || bad "$id" "packages/domain/src/$test has no describe(\"${fn}…\")"
  run_vitest "$id" packages/domain "src/$test" -t "$fn"
}

# --- Check 1: Live status ------------------------------------------------------------------------------
grep -qw 'HiddenValue' web/src/components/game/LiveStatus.tsx 2>/dev/null || bad 1 "LiveStatus.tsx does not draw the hidden score through HiddenValue"
run_vitest 1 web "$RT" -t "S75 live status"

# --- Check 2: the pitch call -----------------------------------------------------------------------------
domain_fn 2 pitchCallLabel pitch-outcome.test.ts
for f in web/src/components/pitch/PitchSequence.tsx web/src/components/pitch/StrikeZoneChart.tsx; do
  grep -qw 'pitchCallLabel' "$f" 2>/dev/null || bad 2 "$f does not label calls with pitchCallLabel"
done
grep -rnE 'callDescription|"In play' web/src --include='*.ts' --include='*.tsx' | grep -vE '\.test\.|/api/generated/' >"$TMP/calls.txt" &&
  { bad 2 "web/src labels a pitch call itself:"; sed 's/^/        /' "$TMP/calls.txt"; }
run_vitest 2 web "$RT" -t "S75 pitch call"

# --- Check 3: the linescore -------------------------------------------------------------------------------
grep -qE '\bhidden\b' web/src/components/game/Linescore.tsx 2>/dev/null || bad 3 "Linescore.tsx has no hidden mode"
grep -nE '<Linescore[^>]*hidden' web/src/components/game/BoxRoom.tsx >/dev/null && bad 3 "BoxRoom passes a hidden mode to Linescore"
run_vitest 3 web "$RT" -t "S75 linescore"

# --- Check 4: the Runs view -------------------------------------------------------------------------------
run_vitest 4 web "$RT" -t "S75 runs"

# --- Check 5: the recap heading ------------------------------------------------------------------------------
domain_fn 5 recapHeading recap.test.ts
grep -qw 'recapHeading' web/src/components/game/RecapRoom.tsx 2>/dev/null || bad 5 "RecapRoom.tsx does not head the recap with recapHeading"
run_vitest 5 web "$RT" -t "S75 recap"

# --- Check 6: the recap clip's title ---------------------------------------------------------------------------
domain_fn 6 isGameRecapHighlight highlights.test.ts
domain_fn 6 highlightTitle highlights.test.ts
grep -qw 'isGameRecapHighlight' functions/src/mappers/content.ts || bad 6 "the content mapper does not decide the recap with isGameRecapHighlight"
grep -qE '"mlb_recap"|"game-recap"' functions/src/mappers/content.ts && bad 6 "the content mapper keeps its own recap keyword list"
run_vitest 6 functions src/mappers/content.test.ts
for f in web/src/components/videos/VideoCard.tsx web/src/components/videos/PlayerDialog.tsx; do
  grep -qw 'highlightTitle' "$f" 2>/dev/null || bad 6 "$f does not title the clip with highlightTitle"
done
run_vitest 6 web "$RT" -t "S75 videos"

# --- Check 7: one hook, no notice ---------------------------------------------------------------------------------
for f in web/src/components/game/LiveStatus.tsx web/src/components/pitch/PlaysPanel.tsx web/src/components/game/LiveRoom.tsx web/src/components/game/RecapRoom.tsx web/src/components/videos/VideosRoom.tsx; do
  grep -qE 'useScoresHidden\(game\b' "$f" 2>/dev/null || bad 7 "$f does not ask useScoresHidden(game)"
done
readers="$(grep -rlE '\bhideScores\b' web/src --include='*.ts' --include='*.tsx' | grep -vE '\.test\.|/api/generated/|^web/src/settings/store\.ts$|^web/src/pages/SettingsPage\.tsx$' | tr '\n' ' ')"
[ -z "$readers" ] || bad 7 "reads the Hide Scores setting directly: $readers"
# The on-screen text, case as written; tests that assert it is absent may name it.
grep -rnE 'Scores hidden|spoiler-free' web/src | grep -vE '\.test\.' >"$TMP/notice.txt" && { bad 7 "web/src says scores are hidden:"; sed 's/^/        /' "$TMP/notice.txt"; }

# --- Check 8: no logos, no viewport ----------------------------------------------------------------------------------
for f in $(story_changed_files S75 "$BASE" web/src); do
  [ -f "$f" ] || continue
  grep -nE '<img[^>]*logo|/logos/' "$f" >/dev/null && bad 8 "$f references a team logo"
  case "$f" in
    web/src/layout/*) ;;
    *) grep -nwE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" >/dev/null && bad 8 "$f reads the viewport" ;;
  esac
done

# --- Check 9: design match captures ------------------------------------------------------------------------------------
S="e2e/design/S75.spec.ts"
for fw in live-hidden-status-mobile:390 live-hidden-status-medium:768 plays-hidden-nonotice-mobile:390 plays-scoring-hidden-nonotice-mobile:390 \
  recap-hidden-nonotice-mobile:390 box-hidden-nonotice-mobile:390 game-videos-hidden-nonotice-mobile:390; do
  name="${fw%%:*}"; w="${fw##*:}"; png="docs/v3/design-checks/S75/$name.png"
  grep -qF "\"$name\"" "$S" 2>/dev/null || bad 9 "$S does not name $name"
  if [ -f "$png" ]; then
    [ "$(png_width "$png")" = "$w" ] || bad 9 "$png is $(png_width "$png")px wide, want $w"
  else
    bad 9 "$png missing"
  fi
done

# --- Check 10: backlog Status is done ------------------------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S75\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 10 "S75 row in the Story status table is not \`done\`"
awk '/^### S75 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s75.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s75.md" || bad 10 "S75 story heading Status is not \`done\`"

report "verify-S75"
exit $?
