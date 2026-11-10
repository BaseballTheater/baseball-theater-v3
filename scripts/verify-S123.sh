#!/usr/bin/env bash
# Grader for BACKLOG story S123 — design amendment: the scoreboard's calendar date picker
# (closed and open, typed date and its invalid state, month grid with weekday row and each
# day's game count, dimmed no-game days, year and decade views, a month still loading its
# counts, an off-season month, and the 1901-04-18 bound), with the Mantine / custom split
# S125 builds from (rule 18).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).
#
# Updated before shipping (2026-11-09, S123 pre-PR review G1–G9): S123's own changes are
# its first-parent commits, so a merge of stage can't be mistaken for them; its frames are
# the PNGs it added; sealed frames may not go missing; frames must be real PNGs at their
# pairing's width; the ratification record is read from its own section with the draft
# markers and pending wording gone; the AC-1 terms must be in ## Frames; every frame
# ## Frames lists must exist as one of its own; and every open question the draft asked has
# its answer in ## Decisions. Each change only tightens a check: check 5 still fails on any
# change S123 makes to another amendment.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "shell-scoreboard has its next free amendments/A<N>.md (new in S123) headed '(S123)', naming what it adds/overrides/repeals, with ## Frames, ## Decisions (owner's words quoted, one answer per open question the draft asked), ## Open questions = None., and a SHA-256 manifest of exactly its own frames"
check 2 "frames at mobile, medium and desktop (PNGs at the ratified scoreboard frame's width): calendar closed and open, an invalid typed date and one before 1901-04-18, the year and decade views, a month loading its counts and one whose counts failed, an off-season month, and the earliest bound (April 1901 and the 1900s decade) — named <screen>[-<state>]-<pairing>.png and listed in ## Frames (every frame listed there exists as one of its own), which also covers the date field, weekday row, per-day game count, dimmed-but-pickable no-game days, future dates pickable and nothing before 1901-04-18"
check 3 "the amendment's ## Components section says which parts are @mantine/dates (DatePicker month/year/decade levels, DateInput, renderDay for the count) and which are custom"
check 4 "the amendment's ## Ratification names who ratified, the date, and quotes the owner's in-session go-ahead, and no draft marker or pending wording is left"
check 5 "no sealed file in shell-scoreboard changed (RATIFIED.md manifest still verifies; RATIFIED.md, ratified frames and every other amendment untouched by S123; every amendment's sealed frames present and unchanged)"
check 6 "backlog Status is done (story heading and Story status table)"

V="docs/v3/visual"
S="shell-scoreboard"
DIR="$V/$S/amendments"

# The commit S123 started from (HEAD when its grader was written). Bring a newer stage into
# this branch by merging it, not rebasing: a merge leaves BASE an ancestor and its changes off
# S123's first-parent chain; after a rebase BASE must move to the new fork point (a grader may
# be updated before its story ships).
BASE=28a56a0

# Lines of section "## <name>" in a file.
section() {
	awk -v h="## $2" '$0==h{f=1;next} /^## /{f=0} f' "$1"
}

# The story's shipping commit, or nothing while it is unshipped (lib/checks.sh).
TIP=$(story_tip S123)

# Files S123 itself changed under $V: its own first-parent, non-merge commits after BASE,
# plus uncommitted and untracked changes while unshipped. A merge that brings stage into
# this branch (S107's A7 ratification, say) is not S123's change, so merges are skipped.
# --no-renames lists a moved file under both names, so a rename can't hide a deletion.
s123_changed() {
	{
		git log --first-parent --no-merges --no-renames --format= --name-only "$BASE..${TIP:-HEAD}" -- "$V"
		if [ -z "$TIP" ]; then
			git diff --no-renames --name-only HEAD -- "$V"
			git ls-files --others --exclude-standard -- "$V"
		fi
	} | sed '/^$/d' | sort -u
}
changed=$(s123_changed)

# Was <path> present at BASE?
at_base() {
	git cat-file -e "$BASE:$1" 2>/dev/null
}

# The S123 amendment: the A<N>.md whose heading ends "(S123)".
A=$(grep -lE '^# A[0-9]+ .*\(S123\)$' "$DIR"/A[0-9]*.md 2>/dev/null | head -1)

# Frames named in another amendment's ## Manifest.
claimed_elsewhere() {
	local a
	for a in "$DIR"/A[0-9]*.md; do
		[ "$a" = "$A" ] && continue
		section "$a" Manifest | grep -qE "^[0-9a-f]{64}  $1\$" && return 0
	done
	return 1
}

# The amendment's own frames: PNGs in amendments/ that S123 added (absent at BASE, present
# now) and no other amendment's manifest claims. The claim check only drops PNGs that
# another amendment's ## Manifest already lists. Run this grader at S123's own branch tip or
# shipping commit: at a HEAD where another story's commits sit on top of an unshipped S123,
# check 5 counts that story's amendment as S123's change and fails.
own_frames() {
	local f
	printf '%s\n' "$changed" | grep -E "^$DIR/[^/]+\.png\$" | while IFS= read -r f; do
		at_base "$f" && continue
		[ -f "$f" ] || continue
		claimed_elsewhere "$(basename "$f")" && continue
		basename "$f"
	done
}

# png_ok <file> <pairing> — a real PNG (signature, IHDR first) as wide as the ratified
# scoreboard-<pairing>.png, which every A8 frame is copied from. Prints why not, if not.
png_ok() {
	local f="$1" ref="$V/$S/scoreboard-$2.png" b1 b2 b3 b4 w want
	[ -s "$f" ] || { echo "empty"; return 1; }
	[ "$(head -c 8 "$f" | od -An -tx1 | tr -d ' \n')" = "89504e470d0a1a0a" ] || { echo "not a PNG"; return 1; }
	[ "$(od -An -tx1 -j12 -N4 "$f" | tr -d ' \n')" = "49484452" ] || { echo "no IHDR chunk first"; return 1; }
	read -r b1 b2 b3 b4 <<< "$(od -An -tu1 -j16 -N4 "$f")"
	w=$((b1 * 16777216 + b2 * 65536 + b3 * 256 + b4))
	read -r b1 b2 b3 b4 <<< "$(od -An -tu1 -j16 -N4 "$ref")"
	want=$((b1 * 16777216 + b2 * 65536 + b3 * 256 + b4))
	[ "$w" = "$want" ] || { echo "${w}px wide, not ${want}px"; return 1; }
}

STATES="closed open invalid tooearly year decade loading failed offseason earliest earliest-decade"
PAIRINGS="mobile medium desktop"

if [ -z "$A" ]; then
	bad 1 "$S: no amendments/A<N>.md headed (S123)"
	bad 2 "$S: no amendment, so no frames"
	bad 3 "$S: no amendment, so no ## Components"
	bad 4 "$S: no amendment, so no ratification record"
else
	# --- Check 1: the amendment file and its sections ---------------------------
	at_base "$A" && bad 1 "$A existed before S123 (another story's amendment)"
	n=$(basename "$A" .md | tr -d 'A')
	for ((i = 1; i < n; i++)); do [ -f "$DIR/A$i.md" ] || bad 1 "$A is not the next free number (A$i.md missing)"; done
	grep -qiE '^\*\*(Adds|Overrides|Repeals)' "$A" ||
		bad 1 "$A does not name what it adds, overrides or repeals (**Adds** / **Overrides** / **Repeals** lines)"
	for h in Frames Components Decisions "Open questions" Manifest; do
		grep -qx "## $h" "$A" || bad 1 "$A has no ## $h"
	done
	decisions=$(section "$A" Decisions)
	echo "$decisions" | grep -q '"' || bad 1 "## Decisions quotes no owner words"
	oq=$(section "$A" "Open questions" | sed '/^[[:space:]]*$/d')
	[ "$oq" = "None." ] || bad 1 "## Open questions body is not exactly 'None.'"
	# Every open question the draft ever asked (labelled **Q<n>.**) is answered in ## Decisions
	# by a line naming Q<n> and quoting the owner, so "None." can't stand in for the answers.
	labels=$({
		git log --first-parent --no-merges --no-renames -p --format= "$BASE..${TIP:-HEAD}" -- "$A"
		[ -z "$TIP" ] && git diff --no-renames HEAD -- "$A"
		cat "$A"
	} | grep -oE '\*\*Q[0-9]+\.\*\*' | grep -oE '[0-9]+' | sort -un)
	for q in $labels; do
		echo "$decisions" | grep -E "Q${q}([^0-9]|\$)" | grep -q '"' ||
			bad 1 "open question Q$q has no quoted owner answer in ## Decisions"
	done
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
			if [ -f "$DIR/$f" ]; then
				why=$(png_ok "$DIR/$f" "$p") || bad 2 "frame $f: $why"
			else
				bad 2 "frame $f missing"
			fi
			echo "$frames_table" | grep -qF "\`$f\`" || bad 2 "$f not in ## Frames"
		done
	done
	own=$(own_frames)
	# Every frame ## Frames names (backticked or not, any case or spelling) is drawn, exported as
	# one of this amendment's own frames and named by the rule, so a row can't promise a state
	# the ratified set leaves out or name one the naming check never sees.
	for f in $(echo "$frames_table" | grep -oiE '[^[:space:]`|]+\.png' | sort -u); do
		echo "$f" | grep -qE '^[a-z]+(-[a-z]+)*-(mobile|medium|desktop)\.png$' ||
			bad 2 "$f (named in ## Frames) breaks <screen>[-<state>]-<pairing>.png"
		[ -f "$DIR/$f" ] || {
			bad 2 "$f is listed in ## Frames but missing"
			continue
		}
		echo "$own" | grep -qxF "$f" || bad 2 "$f is listed in ## Frames but is not a frame this amendment added"
	done
	for f in $own; do
		echo "$f" | grep -qE '^[a-z]+(-[a-z]+)*-(mobile|medium|desktop)\.png$' || {
			bad 2 "$f breaks <screen>[-<state>]-<pairing>.png"
			continue
		}
		p=$(echo "$f" | sed -E 's/.*-(mobile|medium|desktop)\.png$/\1/')
		why=$(png_ok "$DIR/$f" "$p") || bad 2 "frame $f: $why"
		echo "$frames_table" | grep -qF "\`$f\`" || bad 2 "$f not in ## Frames"
	done
	# AC 1's parts are drawn, so ## Frames (what each export shows) names them, not prose elsewhere.
	for term in "date field" "weekday" "game count" "dimmed" "pickable" "future" "1901-04-18"; do
		echo "$frames_table" | grep -qiF "$term" || bad 2 "## Frames never mentions '$term'"
	done

	# --- Check 3: Mantine vs custom -----------------------------------------------
	comps=$(section "$A" Components)
	echo "$comps" | grep -qF "@mantine/dates" || bad 3 "## Components never names '@mantine/dates'"
	echo "$comps" | grep -E 'DatePicker([^I]|$)' | grep -i month | grep -i year | grep -qi decade ||
		bad 3 "## Components has no DatePicker line naming its month, year and decade levels"
	echo "$comps" | grep -qF "DateInput" || bad 3 "## Components never names 'DateInput'"
	echo "$comps" | grep -F "renderDay" | grep -qi "count" || bad 3 "## Components has no renderDay line for the game count"
	echo "$comps" | grep -qE '^- \*\*Custom:\*\*' || bad 3 "## Components has no '- **Custom:**' line"

	# --- Check 4: ratification record ---------------------------------------------
	rat=$(section "$A" Ratification)
	# The owner ratifies; every earlier amendment records him as "Jake Lauer (product owner)".
	echo "$rat" | grep -qE '^Ratified by:[[:space:]]*Jake Lauer([^[:alnum:]]|$)' || bad 4 "## Ratification has no 'Ratified by: Jake Lauer' line"
	echo "$rat" | grep -qE '^Date:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]*$' || bad 4 "## Ratification has no 'Date: YYYY-MM-DD' line"
	echo "$rat" | grep -qE '^Go-ahead:[[:space:]]*".+"' || bad 4 "## Ratification has no quoted 'Go-ahead: \"…\"' line"
	# Any draft marker, however worded (no ratified amendment A1–A6 contains either phrase).
	grep -qiE '\*\*Draft|not (yet )?ratified' "$A" && bad 4 "the amendment still says it is a draft or not ratified"
	section "$A" Manifest | grep -qi 'pending' && bad 4 "## Manifest is still pending"
	# The draft's wording that ratification must resolve: text marked "pending Q<n>" (settled by
	# the owner's answer), the Figma section still "awaiting ratification", and the future-tense
	# "will be a 1× PNG" (ratified amendments say "is", once the PNGs are exported).
	grep -qE 'pending Q[0-9]+' "$A" && bad 4 "the amendment still has text pending an open question"
	grep -qi 'awaiting ratification' "$A" && bad 4 "the amendment still says awaiting ratification"
	grep -qF 'will be a 1×' "$A" && bad 4 "## Frames still says the exports will be made"
fi

# --- Check 5: sealed files untouched -------------------------------------------------
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
		# S123 writes only its own amendment; any change it makes to another one fails, draft
		# or ratified. Another story's change to one (S107 ratifying A7) reaches this branch by
		# merging stage, and merges are outside $changed, so it isn't counted as S123's.
		"$DIR/"A[0-9]*.md) [ "$f" = "$A" ] || bad 5 "S123 changed another amendment, $f" ;;
		# A PNG in amendments/ that existed at BASE is another amendment's; S123 only adds its own.
		# (In a case pattern `*` also matches `/`, so these come before the surface-wide one.)
		"$DIR/"*.png) at_base "$f" && bad 5 "S123 changed or deleted $f, which existed before it" ;;
		"$DIR/"*) ;;
		"$V/$S/"*) bad 5 "S123 changed a sealed file, $f" ;;
	esac
done <<< "$(printf '%s\n' "$changed" | grep "^$V/$S/")"
# A frame another amendment's manifest seals must still be there and still verify.
for a in "$DIR"/A[0-9]*.md; do
	[ "$a" = "$A" ] && continue
	while IFS= read -r line; do
		[ -z "$line" ] && continue
		sum=${line%%  *}
		f=${line#*  }
		[ -f "$DIR/$f" ] || {
			bad 5 "$f sealed by $(basename "$a") missing"
			continue
		}
		[ "$(shasum -a 256 "$DIR/$f" | cut -d' ' -f1)" = "$sum" ] || bad 5 "$f sealed by $(basename "$a") changed"
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
