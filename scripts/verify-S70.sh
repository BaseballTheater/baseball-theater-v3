#!/usr/bin/env bash
# Grader for BACKLOG story S70 — the video player: one VideoPlayer (the MLBAM disclaimer
# once) inside PlayerDialog (default) or PlayerStage, chosen by Settings → Game Detail →
# Video Player; Esc / ✕ close the dialog, Space plays and pauses; the dialog links to the
# clip's game unless it plays from that game. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "one VideoPlayer holds the MLBAM disclaimer once (one file in web/src) and renders inside PlayerDialog (default) or PlayerStage"
check 2 "the dialog closes on ✕ and Esc; Space toggles play (test)"
check 3 "Settings → Game Detail → Video Player (Dialog / Stage) saves to the account and switches the host without reload; signed out uses Dialog (tests)"
check 4 "PlayerDialog shows the game link when the clip carries its game and is not played from that game's page, absent in the game's Videos room (tests); one PlayerDialog, imported by the Videos room"
check 5 "files this story adds or edits have no team logo and no useMediaQuery / hiddenFrom / visibleFrom outside web/src/layout/"
check 6 "design match: e2e/design/S70.spec.ts names video-player-dialog-mobile / -medium and video-player-stage-mobile / -medium; docs/v3/design-checks/S70/ holds them at 390/768/390/768"
check 7 "backlog Status is done (story heading and Story status table)"

BASE=cc78bb0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DIR="web/src/components/videos"
PT="src/components/videos/VideoPlayer.test.tsx"

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

# --- Check 1: one player, the disclaimer once ---------------------------------------------------
files="$(grep -rlF 'has no affiliation with or connection to Baseball Theater' web/src --include='*.tsx' --include='*.ts' | grep -v '\.test\.' || true)"
[ "$(printf '%s' "$files" | grep -c .)" = "1" ] || bad 1 "the disclaimer appears in: ${files:-no file} (want exactly one)"
[ "$files" = "$DIR/VideoPlayer.tsx" ] || bad 1 "the disclaimer is not in $DIR/VideoPlayer.tsx"
grep -qE 'export function VideoPlayer\(' "$DIR/VideoPlayer.tsx" 2>/dev/null || bad 1 "$DIR/VideoPlayer.tsx exports no VideoPlayer"
for host in PlayerDialog PlayerStage; do
  grep -qE "export function $host\(" "$DIR/$host.tsx" 2>/dev/null || bad 1 "$DIR/$host.tsx exports no $host"
  grep -qw 'VideoPlayer' "$DIR/$host.tsx" 2>/dev/null || bad 1 "$host does not render VideoPlayer"
done
run_vitest 1 web "$PT" -t "disclaimer"

# --- Check 2: close and play keys ---------------------------------------------------------------
run_vitest 2 web "$PT" -t "closes"
run_vitest 2 web "$PT" -t "Space"

# --- Check 3: the Video Player setting ----------------------------------------------------------
grep -qE 'videoPlayer' packages/domain/src/settings.ts || bad 3 "AccountSettings has no videoPlayer"
grep -qE 'export function setVideoPlayer\(' web/src/settings/store.ts || bad 3 "web/src/settings/store.ts has no setVideoPlayer"
run_vitest 3 packages/domain src/settings.test.ts -t "video player"
run_vitest 3 web src/pages/SettingsPage.test.tsx -t "Video Player"
run_vitest 3 web src/components/videos/PlayerHost.test.tsx -t "host"
run_vitest 3 web src/components/videos/PlayerHost.test.tsx -t "signed out"
pnpm -s api:breaking >"$TMP/breaking.log" 2>&1 || { bad 3 "pnpm api:breaking fails:"; tail -8 "$TMP/breaking.log" | sed 's/^/        /'; }

# --- Check 4: the game link; one dialog ---------------------------------------------------------
n="$(grep -rlE 'export function PlayerDialog\(' web/src | wc -l | tr -d ' ')"
[ "$n" = "1" ] || bad 4 "$n files define PlayerDialog (want one)"
grep -rqw 'PlayerDialog' web/src/components/videos/PlayerHost.tsx 2>/dev/null || bad 4 "PlayerHost does not use PlayerDialog"
grep -qw 'PlayerHost' web/src/components/videos/VideosRoom.tsx 2>/dev/null || bad 4 "the Videos room does not host the player"
run_vitest 4 web "$PT" -t "game link"

# --- Check 5: no logos, no viewport -------------------------------------------------------------
for f in $(story_changed_files S70 "$BASE" web/src); do
  [ -f "$f" ] || continue
  grep -nE '<img[^>]*logo|/logos/' "$f" >/dev/null && bad 5 "$f references a team logo"
  case "$f" in
    web/src/layout/*) ;;
    *) grep -nwE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" >/dev/null && bad 5 "$f reads the viewport" ;;
  esac
done

# --- Check 6: design match captures -------------------------------------------------------------
S="e2e/design/S70.spec.ts"
for fw in video-player-dialog-mobile:390 video-player-dialog-medium:768 video-player-stage-mobile:390 video-player-stage-medium:768; do
  name="${fw%%:*}"; w="${fw##*:}"; png="docs/v3/design-checks/S70/$name.png"
  grep -qF "\"$name\"" "$S" 2>/dev/null || bad 6 "$S does not name $name"
  if [ -f "$png" ]; then
    [ "$(png_width "$png")" = "$w" ] || bad 6 "$png is $(png_width "$png")px wide, want $w"
  else
    bad 6 "$png missing"
  fi
done

# --- Check 7: backlog Status is done ------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S70\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 7 "S70 row in the Story status table is not \`done\`"
awk '/^### S70 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md \
  | grep -qE '^\*\*Status:\*\* `done`$' ||
  bad 7 "S70 story heading Status is not \`done\`"

report "verify-S70"
exit $?
