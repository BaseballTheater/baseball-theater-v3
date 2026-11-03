#!/usr/bin/env bash
# Grader for BACKLOG story S95 — link each video to the play it shows: the content mapper reads
# MLB's `guid` (not `mediaPlaybackId`), and one domain function, `videoPlayLinks`, links the rest
# through S94's `playIdRef` and, for an ABS challenge clip, the one unclaimed S93 challenge whose
# team and outcome match. On 823823, 20 of 40 videos link. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "the content mapper takes a video's play from guid, not mediaPlaybackId; on 823823 15 videos get a playId, each a pitch playId in the live feed (test)"
check 2 "videoPlayLinks(videos, plays, playRefs, playMetrics) in packages/domain links by guid, then playIdRef, then the one unclaimed matching ABS challenge (unit tests, two challenges that both fit included); applied in one place both adapters share"
check 3 "on 823823, 20 of 40 videos link: the 15 guid clips and all 5 ABS clips (#34, #39, #69, #82, #83); graphics, recap, condensed game and pre-game link to none (test)"
check 4 "the game payload carries playId and playLink: \"mlb\" | \"challenge\" on each video, additively (api:breaking 0)"
check 5 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
LT="src/mappers/video-links.test.ts"

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

# --- Check 1: guid --------------------------------------------------------------------------------
C="functions/src/mappers/content.ts"
grep -qE 'playId:\s*item\.guid' "$C" || bad 1 "$C does not take playId from item.guid"
grep -qE 'playId:\s*item\.mediaPlaybackId' "$C" && bad 1 "$C still takes playId from mediaPlaybackId"
run_vitest 1 functions "$LT" -t "guid"

# --- Check 2: one function, one place -----------------------------------------------------------------
grep -rqE 'export function videoPlayLinks\(' packages/domain/src || bad 2 "packages/domain exports no videoPlayLinks"
grep -qE 'describe\("videoPlayLinks' packages/domain/src/video-play-links.test.ts 2>/dev/null || bad 2 "packages/domain/src/video-play-links.test.ts has no describe(\"videoPlayLinks…\")"
run_vitest 2 packages/domain src/video-play-links.test.ts -t "videoPlayLinks"
run_vitest 2 packages/domain src/video-play-links.test.ts -t "both fit"
callers="$(grep -rlE '\bvideoPlayLinks\(' functions/src | grep -vE '\.test\.' | tr '\n' ' ')"
[ "$(echo "$callers" | wc -w | tr -d ' ')" = "1" ] || bad 2 "videoPlayLinks is called from: ${callers:-nowhere} (want one place both adapters share)"
grep -rqE '\bguid\b' packages/domain/src --include='*.ts' && grep -rnE '\.guid\b' packages/domain/src | grep -v '\.test\.' | grep -q . && bad 2 "packages/domain reads guid itself (the mapper's playId is the first step)"

# --- Check 3: 823823 ------------------------------------------------------------------------------------
run_vitest 3 functions "$LT" -t "823823"
node -e '
  const g = require("./fixtures/game-823823.json");
  const linked = g.highlights.filter((h) => h.playId);
  if (linked.length !== 20) { console.log(`game-823823.json links ${linked.length} of ${g.highlights.length}, want 20`); process.exit(1); }
' >"$TMP/fx.log" 2>&1 || bad 3 "$(cat "$TMP/fx.log")"

# --- Check 4: the payload ------------------------------------------------------------------------------------
grep -qE 'playLink\?:\s*"mlb" \| "challenge"' packages/domain/src/types.ts || bad 4 "MediaHighlight has no optional playLink: \"mlb\" | \"challenge\""
grep -qF '"playLink"' openapi/bt-api.v1.json || bad 4 "the spec has no playLink"
pnpm -s api:breaking >"$TMP/b.log" 2>&1 || { bad 4 "pnpm api:breaking fails:"; tail -8 "$TMP/b.log" | sed 's/^/        /'; }

# --- Check 5: backlog Status is done ---------------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S95\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 5 "S95 row in the Story status table is not \`done\`"
awk '/^### S95 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s95.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s95.md" || bad 5 "S95 story heading Status is not \`done\`"

report "verify-S95"
exit $?
