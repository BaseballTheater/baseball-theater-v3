#!/usr/bin/env bash
# Grader for BACKLOG story S123 — design amendment: the scoreboard's calendar date picker
# (closed and open, typed date and its invalid state, month grid with weekday row and each
# day's game count, dimmed no-game days, year and decade views, a month still loading its
# counts, an off-season month), with the Mantine / custom split S125 builds from (rule 18).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "shell-scoreboard has its next free amendments/A<N>.md headed '(S123)', naming what it adds/overrides/repeals, with ## Frames, ## Decisions (owner's words quoted), ## Open questions = None., and a SHA-256 manifest of exactly its own frames"
check 2 "frames at mobile, medium and desktop: calendar closed and open, an invalid typed date, the year and decade views, a month loading its counts, an off-season month — named <screen>[-<state>]-<pairing>.png and listed in ## Frames, which also covers the date field, weekday row, per-day game count, dimmed-but-pickable no-game days, future dates pickable and nothing before 1901-04-18"
check 3 "the amendment's ## Components section says which parts are @mantine/dates (DatePicker month/year/decade levels, DateInput, renderDay) and which are custom"
check 4 "the amendment's ratification record names who ratified, the date, and quotes the owner's in-session go-ahead"
check 5 "no sealed file in shell-scoreboard changed (RATIFIED.md manifest still verifies; RATIFIED.md, ratified frames and earlier amendments untouched by S123)"
check 6 "backlog Status is done (story heading and Story status table)"

V="docs/v3/visual"
S="shell-scoreboard"
DIR="$V/$S/amendments"

# Lines of section "## <name>" in a file.
section() {
	awk -v h="## $2" '$0==h{f=1;next} /^## /{f=0} f' "$1"
}

# The S123 amendment: the A<N>.md whose heading ends "(S123)".
A=$(grep -lE '^# A[0-9]+ .*\(S123\)$' "$DIR"/A[0-9]*.md 2>/dev/null | head -1)

# Frames in amendments/ not claimed by another amendment's manifest.
own_frames() {
	local f a other
	for f in $(cd "$DIR" && ls *.png 2>/dev/null); do
		other=0
		for a in "$DIR"/A[0-9]*.md; do
			[ "$a" = "$A" ] && continue
			section "$a" Manifest | grep -qE "^[0-9a-f]{64}  $f\$" && other=1
		done
		[ "$other" = 0 ] && echo "$f"
	done
}

STATES="closed open invalid year decade loading offseason"
PAIRINGS="mobile medium desktop"

if [ -z "$A" ]; then
	bad 1 "$S: no amendments/A<N>.md headed (S123)"
	bad 2 "$S: no amendment, so no frames"
	bad 3 "$S: no amendment, so no ## Components"
	bad 4 "$S: no amendment, so no ratification record"
else
	# --- Check 1: the amendment file and its sections ---------------------------
	n=$(basename "$A" .md | tr -d 'A')
	for ((i = 1; i < n; i++)); do [ -f "$DIR/A$i.md" ] || bad 1 "$A is not the next free number (A$i.md missing)"; done
	grep -qiE '^\*\*(Adds|Overrides|Repeals)' "$A" ||
		bad 1 "$A does not name what it adds, overrides or repeals (**Adds** / **Overrides** / **Repeals** lines)"
	for h in Frames Components Decisions "Open questions" Manifest; do
		grep -qx "## $h" "$A" || bad 1 "$A has no ## $h"
	done
	section "$A" Decisions | grep -q '"' || bad 1 "## Decisions quotes no owner words"
	oq=$(section "$A" "Open questions" | sed '/^[[:space:]]*$/d')
	[ "$oq" = "None." ] || bad 1 "## Open questions body is not exactly 'None.'"
	manifest=$(section "$A" Manifest | grep -E '^[0-9a-f]{64}  ')
	want=$(own_frames | sort)
	got=$(printf '%s\n' "$manifest" | sed -E 's/^[0-9a-f]{64}  //' | sed '/^$/d' | sort)
	[ -n "$want" ] && [ "$want" = "$got" ] || bad 1 "## Manifest does not list every frame of this amendment exactly once"
	while IFS= read -r line; do
		[ -z "$line" ] && continue
		sum=${line%%  *}
		f=${line#*  }
		[ -f "$DIR/$f" ] || {
			bad 1 "manifest names missing $f"
			continue
		}
		[ "$(shasum -a 256 "$DIR/$f" | cut -d' ' -f1)" = "$sum" ] || bad 1 "SHA-256 mismatch: $f"
	done <<< "$manifest"

	# --- Check 2: required frames, naming, Frames table ---------------------------
	frames_table=$(section "$A" Frames)
	for st in $STATES; do
		for p in $PAIRINGS; do
			f="scoreboard-calendar-$st-$p.png"
			[ -f "$DIR/$f" ] || bad 2 "frame $f missing"
			echo "$frames_table" | grep -qF "\`$f\`" || bad 2 "$f not in ## Frames"
		done
	done
	for f in $(own_frames); do
		echo "$f" | grep -qE '^[a-z]+(-[a-z]+)*-(mobile|medium|desktop)\.png$' || bad 2 "$f breaks <screen>[-<state>]-<pairing>.png"
		echo "$frames_table" | grep -qF "\`$f\`" || bad 2 "$f not in ## Frames"
	done
	for term in "date field" "weekday" "game count" "dimmed" "pickable" "future" "1901-04-18"; do
		grep -qiF "$term" "$A" || bad 2 "the amendment never mentions '$term'"
	done

	# --- Check 3: Mantine vs custom -----------------------------------------------
	comps=$(section "$A" Components)
	for term in "@mantine/dates" "DatePicker" "DateInput" "renderDay" "month" "year" "decade" "custom"; do
		echo "$comps" | grep -qiF "$term" || bad 3 "## Components never names '$term'"
	done

	# --- Check 4: ratification record ---------------------------------------------
	grep -qE '^Ratified by:[[:space:]]*[^[:space:]]' "$A" || bad 4 "no 'Ratified by:' line"
	grep -qE '^Date:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]*$' "$A" || bad 4 "no 'Date: YYYY-MM-DD' line"
	grep -qE '^Go-ahead:[[:space:]]*".+"' "$A" || bad 4 "no quoted 'Go-ahead: \"…\"' line"
fi

# --- Check 5: sealed files untouched -------------------------------------------------
# The commit S123 started from (HEAD when its grader was written).
BASE=28a56a0
changed=$(story_changed_files S123 "$BASE" "$V")
RAT="$V/$S/RATIFIED.md"
if [ -f "$RAT" ]; then
	while IFS= read -r line; do
		[ -z "$line" ] && continue
		sum=${line%%  *}
		f=${line#*  }
		[ -f "$V/$S/$f" ] || {
			bad 5 "sealed $f missing"
			continue
		}
		[ "$(shasum -a 256 "$V/$S/$f" | cut -d' ' -f1)" = "$sum" ] || bad 5 "sealed $f changed"
	done <<< "$(section "$RAT" Manifest | grep -E '^[0-9a-f]{64}  ')"
else
	bad 5 "$RAT missing"
fi
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in
		"$V/$S/RATIFIED.md") bad 5 "S123 changed RATIFIED.md" ;;
		"$DIR/"A[0-9]*.md) [ "$f" = "$A" ] || bad 5 "S123 changed an earlier amendment, $f" ;;
		# Frames in amendments/ are S123's own or sealed by another amendment's manifest
		# (checked by hash below); in a case pattern `*` also matches `/`, so this comes first.
		"$DIR/"*) ;;
		"$V/$S/"*) bad 5 "S123 changed a sealed file, $f" ;;
	esac
done <<< "$(printf '%s\n' "$changed" | grep "^$V/$S/")"
for a in "$DIR"/A[0-9]*.md; do
	[ "$a" = "$A" ] && continue
	while IFS= read -r line; do
		[ -z "$line" ] && continue
		sum=${line%%  *}
		f=${line#*  }
		[ -f "$DIR/$f" ] && [ "$(shasum -a 256 "$DIR/$f" | cut -d' ' -f1)" != "$sum" ] &&
			bad 5 "$f sealed by $(basename "$a") changed"
	done <<< "$(section "$a" Manifest | grep -E '^[0-9a-f]{64}  ')"
done

# --- Check 6: backlog Status is done -------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S123\].*\| `done` \|' docs/v3/BACKLOG.md ||
	bad 6 "S123 row in the Story status table is not \`done\`"
awk '/^### S123 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md |
	grep -qE '^\*\*Status:\*\* `done`$' ||
	bad 6 "S123 story heading Status is not \`done\`"

report "verify-S123"
exit $?
