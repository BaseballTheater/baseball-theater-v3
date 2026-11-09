#!/usr/bin/env bash
# Grader for BACKLOG story S129 — design amendment: the spring training label on Standings.
# A ratified amendment to standings-search-settings draws Standings at mobile, medium and
# desktop holding spring training's standings with their label (S128's `phase: "spring"`), and
# says whether the off-season final table (`phase: "final"`) is marked too; if it is, FEATURES
# records the owner's words in the same change set (rule 18; S130 builds it).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).
#
# S129's own changes are its first-parent, non-merge commits after BASE (plus uncommitted
# and untracked files while it is unshipped), so a later merge of stage into this branch, or
# the stories this branch stacks on, never count as S129's.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "standings-search-settings has its next free amendments/A<N>.md (new in S129) headed '(S129)', naming what it adds/overrides/repeals, with ## Frames, ## Decisions (owner's words quoted, one answer per open question the draft asked), ## Open questions = None., and a SHA-256 manifest of exactly its own frames"
check 2 "frames standings-spring-{mobile,medium,desktop}.png (real PNGs at the ratified standings frame's width) listed in ## Frames, which names the spring training label; every frame ## Frames names exists as one of its own; any final-table frames come as all three pairings"
check 3 "the amendment says whether the off-season final table (phase \"final\") is marked: a quoted owner decision in ## Decisions; if it is marked, FEATURES' Standings row (changed by S129) records it"
check 4 "the amendment's ## Ratification names Jake Lauer, the date, and quotes the owner's in-session go-ahead, and no draft marker or pending wording is left"
check 5 "no sealed file in standings-search-settings changed or deleted (RATIFIED.md manifest verifies; RATIFIED.md, ratified frames and every other amendment untouched by S129; every amendment's sealed frames present and unchanged)"
check 6 "S129 changes no file outside its fence (scripts/verify-S129.sh aside)"
check 7 "backlog Status is done (story heading and Story status table)"

V="docs/v3/visual"
S="standings-search-settings"
DIR="$V/$S/amendments"
FEATURES="docs/v3/FEATURES.md"

# The commit S129 started from (HEAD when its grader was written). Bring a newer stage into
# this branch by merging it, not rebasing: a merge leaves BASE an ancestor and its changes off
# S129's first-parent chain; after a rebase BASE must move to the new fork point (a grader may
# be updated before its story ships).
BASE=8d03ba8

# Lines of section "## <name>" in a file.
section() {
	awk -v h="## $2" '$0==h{f=1;next} /^## /{f=0} f' "$1"
}

# The story's shipping commit, or nothing while it is unshipped (lib/checks.sh).
TIP=$(story_tip S129)

# Files S129 itself changed under <paths>: its own first-parent, non-merge commits after BASE,
# plus uncommitted and untracked changes while unshipped. --no-renames lists a moved file
# under both names, so a rename can't hide a deletion.
s129_changed() {
	{
		git log --first-parent --no-merges --no-renames --format= --name-only "$BASE..${TIP:-HEAD}" -- "$@"
		if [ -z "$TIP" ]; then
			git diff --no-renames --name-only HEAD -- "$@"
			git ls-files --others --exclude-standard -- "$@"
		fi
	} | sed '/^$/d' | sort -u
}
changed=$(s129_changed "$V")

# Was <path> present at BASE?
at_base() {
	git cat-file -e "$BASE:$1" 2>/dev/null
}

# The S129 amendment: the A<N>.md whose heading ends "(S129)" and that did not exist at BASE.
A=""
for a in $(grep -lE '^# A[0-9]+ .*\(S129\)$' "$DIR"/A[0-9]*.md 2>/dev/null); do
	at_base "$a" && continue
	A="$a"
	break
done

# Frames named in another amendment's ## Manifest.
claimed_elsewhere() {
	local a
	for a in "$DIR"/A[0-9]*.md; do
		[ "$a" = "$A" ] && continue
		section "$a" Manifest | grep -qE "^[0-9a-f]{64}  $1\$" && return 0
	done
	return 1
}

# The amendment's own frames: PNGs in amendments/ that S129 added (absent at BASE, present
# now) and that no other amendment's manifest claims.
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
# standings-<pairing>.png, which every S129 frame is copied from. Prints why not, if not.
png_ok() {
	local f="$1" ref="$V/$S/standings-$2.png" b1 b2 b3 b4 w want
	[ -s "$f" ] || { echo "empty"; return 1; }
	[ "$(head -c 8 "$f" | od -An -tx1 | tr -d ' \n')" = "89504e470d0a1a0a" ] || { echo "not a PNG"; return 1; }
	[ "$(od -An -tx1 -j12 -N4 "$f" | tr -d ' \n')" = "49484452" ] || { echo "no IHDR chunk first"; return 1; }
	read -r b1 b2 b3 b4 <<< "$(od -An -tu1 -j16 -N4 "$f")"
	w=$((b1 * 16777216 + b2 * 65536 + b3 * 256 + b4))
	read -r b1 b2 b3 b4 <<< "$(od -An -tu1 -j16 -N4 "$ref")"
	want=$((b1 * 16777216 + b2 * 65536 + b3 * 256 + b4))
	[ "$w" = "$want" ] || { echo "${w}px wide, not ${want}px"; return 1; }
}

PAIRINGS="mobile medium desktop"
NAME_RE='^[a-z]+(-[a-z]+)*-(mobile|medium|desktop)\.png$'

if [ -z "$A" ]; then
	bad 1 "$S: no new amendments/A<N>.md headed (S129)"
	bad 2 "$S: no amendment, so no frames"
	bad 3 "$S: no amendment, so no decision on the final table"
	bad 4 "$S: no amendment, so no ratification record"
else
	# --- Check 1: the amendment file and its sections ---------------------------
	n=$(basename "$A" .md | tr -d 'A')
	for ((i = 1; i < n; i++)); do [ -f "$DIR/A$i.md" ] || bad 1 "$A is not the next free number (A$i.md missing)"; done
	for h in Adds Overrides Repeals; do
		grep -qE "^\*\*$h:\*\*" "$A" || bad 1 "$A has no **$h:** line"
	done
	for h in Frames Decisions "Open questions" Ratification Manifest; do
		grep -qx "## $h" "$A" || bad 1 "$A has no ## $h"
	done
	decisions=$(section "$A" Decisions)
	echo "$decisions" | grep -q '"' || bad 1 "## Decisions quotes no owner words"
	oq=$(section "$A" "Open questions" | sed '/^[[:space:]]*$/d')
	[ "$oq" = "None." ] || bad 1 "## Open questions body is not exactly 'None.'"
	# Every open question the draft ever asked (labelled **Q<n>.**) is answered in ## Decisions by
	# a line naming Q<n> (word boundary: Q1 is not Q10) and quoting the owner.
	labels=$({
		git log --first-parent --no-merges --no-renames -p --format= "$BASE..${TIP:-HEAD}" -- "$A"
		[ -z "$TIP" ] && git diff --no-renames HEAD -- "$A"
		cat "$A"
	} | grep -oE '\*\*Q[0-9]+\.\*\*' | grep -oE '[0-9]+' | sort -un)
	for q in $labels; do
		echo "$decisions" | grep -E "(^|[^[:alnum:]])Q${q}([^0-9]|\$)" | grep -q '"' ||
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
	own=$(own_frames)
	for p in $PAIRINGS; do
		f="standings-spring-$p.png"
		if [ -f "$DIR/$f" ]; then
			why=$(png_ok "$DIR/$f" "$p") || bad 2 "frame $f: $why"
			echo "$own" | grep -qxF "$f" || bad 2 "$f is not a frame this amendment added"
		else
			bad 2 "frame $f missing"
		fi
		echo "$frames_table" | grep -qF "\`$f\`" || bad 2 "$f not in ## Frames"
	done
	# Every frame ## Frames names (backticked or not, any case) exists as one of this amendment's
	# own frames and follows the naming rule, so a row can't promise a state the set leaves out.
	for f in $(echo "$frames_table" | grep -oiE '[^[:space:]`|(]+\.png' | sort -u); do
		echo "$f" | grep -qE "$NAME_RE" || bad 2 "$f (named in ## Frames) breaks <screen>[-<state>]-<pairing>.png"
		[ -f "$DIR/$f" ] || {
			bad 2 "$f is listed in ## Frames but missing"
			continue
		}
		echo "$own" | grep -qxF "$f" || bad 2 "$f is listed in ## Frames but is not a frame this amendment added"
	done
	for f in $own; do
		echo "$f" | grep -qE "$NAME_RE" || {
			bad 2 "$f breaks <screen>[-<state>]-<pairing>.png"
			continue
		}
		p=$(echo "$f" | sed -E 's/.*-(mobile|medium|desktop)\.png$/\1/')
		why=$(png_ok "$DIR/$f" "$p") || bad 2 "frame $f: $why"
		echo "$frames_table" | grep -qF "\`$f\`" || bad 2 "$f not in ## Frames"
	done
	# A final-table state, if drawn, is drawn at every pairing.
	if echo "$own" | grep -q '^standings-final-'; then
		for p in $PAIRINGS; do
			echo "$own" | grep -qxF "standings-final-$p.png" || bad 2 "final-table frames drawn, but standings-final-$p.png missing"
		done
	fi
	# AC 1's label is drawn, so ## Frames (what each export shows) names it.
	for term in "spring training" "label"; do
		echo "$frames_table" | grep -qiF "$term" || bad 2 "## Frames never mentions '$term'"
	done

	# --- Check 3: the off-season final table ---------------------------------------
	# One line of ## Decisions settles it: it names the final table and its label (or no label)
	# and quotes the owner.
	echo "$decisions" | grep -i 'final' | grep -iE 'label' | grep -q '"' ||
		bad 3 "## Decisions has no quoted owner decision on whether the off-season final table is labeled"
	if echo "$own" | grep -q '^standings-final-'; then
		s129_changed "$FEATURES" | grep -qxF "$FEATURES" ||
			bad 3 "final-table frames drawn, but S129 did not record the owner's words in $FEATURES"
		grep -E '^\| Standings \|' "$FEATURES" | grep -i 'final' | grep -qi 'label' ||
			bad 3 "$FEATURES' Standings row does not say the final table is labeled"
	fi

	# --- Check 4: ratification record ---------------------------------------------
	rat=$(section "$A" Ratification)
	echo "$rat" | grep -qE '^Ratified by:[[:space:]]*Jake Lauer([^[:alnum:]]|$)' || bad 4 "## Ratification has no 'Ratified by: Jake Lauer' line"
	echo "$rat" | grep -qE '^Date:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]*$' || bad 4 "## Ratification has no 'Date: YYYY-MM-DD' line"
	echo "$rat" | grep -qE '^Go-ahead:.*".+"' || bad 4 "## Ratification has no quoted 'Go-ahead: … \"…\"' line"
	grep -qiE '\*\*Draft|not (yet )?ratified' "$A" && bad 4 "the amendment still says it is a draft or not ratified"
	section "$A" Manifest | grep -qi 'pending' && bad 4 "## Manifest is still pending"
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
		"$V/$S/RATIFIED.md") bad 5 "S129 changed RATIFIED.md" ;;
		# S129 writes only its own amendment; any change it makes to another one fails.
		"$DIR/"A[0-9]*.md) [ "$f" = "$A" ] || bad 5 "S129 changed another amendment, $f" ;;
		# A PNG in amendments/ that existed at BASE is another amendment's; S129 only adds its own.
		# (In a case pattern `*` also matches `/`, so these come before the surface-wide one.)
		"$DIR/"*.png) at_base "$f" && bad 5 "S129 changed or deleted $f, which existed before it" ;;
		"$DIR/"*) ;;
		"$V/$S/"*) bad 5 "S129 changed a sealed file, $f" ;;
		*) bad 5 "S129 changed $f, outside its surface" ;;
	esac
done <<< "$changed"
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

# --- Check 6: the fence ----------------------------------------------------------------
while IFS= read -r f; do
	[ -z "$f" ] && continue
	case "$f" in
		"$DIR/"* | docs/v3/VISUAL-DESIGN.md | "$FEATURES" | docs/v3/BACKLOG.md | docs/v3/backlog/* | \
			docs/v3/AUDIT.md | docs/v3/audit.jsonl | docs/v3/INDEX.md | CHANGELOG.md | scripts/verify-S129.sh) ;;
		# Obsidian editor state: never committed (CLAUDE.md), so only ever an uncommitted change.
		docs/v3/.obsidian/workspace.json) [ -z "$TIP" ] || bad 6 "S129 committed $f" ;;
		*) bad 6 "S129 changed $f, outside its fence" ;;
	esac
done <<< "$(s129_changed .)"

# --- Check 7: backlog Status is done -------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S129\].*\| `done` \|' docs/v3/BACKLOG.md ||
	bad 7 "S129 row in the Story status table is not \`done\`"
awk '/^### S129 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md |
	grep -qE '^\*\*Status:\*\* `done`$' ||
	bad 7 "S129 story heading Status is not \`done\`"

report "verify-S129"
exit $?
