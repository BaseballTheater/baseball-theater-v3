#!/usr/bin/env bash
# Grader for BACKLOG story S96 — design amendment: a video's play link and the
# Plays room opened on that play (rule 18; S97 builds it).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "game-shell and game-rooms each have their next free amendments/A<N>.md headed '(S96)', naming what it adds/overrides/repeals, with ## Frames, ## Decisions (owner's words quoted), ## Open questions = None., and a SHA-256 manifest of exactly its own frames"
check 2 "frames at mobile, medium and desktop: the play link on a video card in grid and in list (game-shell), and the Plays room opened on that play with its inning chosen and its at-bat open and marked (game-rooms) — named <screen>[-<state>]-<pairing>.png and listed in ## Frames"
check 3 "each amendment's ratification record names who ratified, the date, and quotes the owner's in-session go-ahead"
check 4 "no sealed file in those surfaces changed (each RATIFIED.md manifest still verifies, RATIFIED.md and earlier amendments untouched by S96)"
check 5 "backlog Status is done (story heading and Story status table)"

V="docs/v3/visual"
SURFACES="game-shell game-rooms"

# Lines of section "## <name>" in a file.
section() {
	awk -v h="## $2" '$0==h{f=1;next} /^## /{f=0} f' "$1"
}

# The S96 amendment of a surface: the A<N>.md whose heading ends "(S96)".
amendment() {
	local dir="$V/$1/amendments"
	[ -d "$dir" ] || return 0
	grep -lE '^# A[0-9]+ .*\(S96\)$' "$dir"/A[0-9]*.md 2>/dev/null | head -1
}

# Frames in amendments/ not claimed by another amendment's manifest.
own_frames() {
	local dir="$1" mine="$2" f a other
	for f in $(cd "$dir" && ls *.png 2>/dev/null); do
		other=0
		for a in "$dir"/A[0-9]*.md; do
			[ "$a" = "$mine" ] && continue
			section "$a" Manifest | grep -qE "^[0-9a-f]{64}  $f\$" && other=1
		done
		[ "$other" = 0 ] && echo "$f"
	done
}

# Frames each surface must carry (check 2, AC 1).
frames_for() {
	case "$1" in
		game-shell)
			echo "game-videos-grid-playlink-mobile.png game-videos-grid-playlink-medium.png game-videos-grid-playlink-desktop.png" \
				"game-videos-list-playlink-mobile.png game-videos-list-playlink-medium.png game-videos-list-playlink-desktop.png"
			;;
		game-rooms) echo "plays-opened-mobile.png plays-opened-medium.png plays-opened-desktop.png" ;;
	esac
}

for s in $SURFACES; do
	A=$(amendment "$s")
	dir="$V/$s/amendments"

	# --- Check 1: the amendment file and its sections ---------------------------
	if [ -z "$A" ]; then
		bad 1 "$s: no amendments/A<N>.md headed (S96)"
		bad 2 "$s: no amendment, so no frames"
		bad 3 "$s: no amendment, so no ratification record"
		continue
	fi
	n=$(basename "$A" .md | tr -d 'A')
	for ((i = 1; i < n; i++)); do [ -f "$dir/A$i.md" ] || bad 1 "$s: $A is not the next free number (A$i.md missing)"; done
	grep -qiE '^\*\*(Adds|Overrides|Repeals)' "$A" ||
		bad 1 "$s: $A does not name what it adds, overrides or repeals (**Adds** / **Overrides** / **Repeals** lines)"
	for h in Frames Decisions "Open questions" Manifest; do
		grep -qx "## $h" "$A" || bad 1 "$s: $A has no ## $h"
	done
	[ -n "$(section "$A" Decisions | sed '/^[[:space:]]*$/d')" ] || bad 1 "$s: ## Decisions is empty"
	section "$A" Decisions | grep -q '"' || bad 1 "$s: ## Decisions quotes no owner words"
	oq=$(section "$A" "Open questions" | sed '/^[[:space:]]*$/d')
	[ "$oq" = "None." ] || bad 1 "$s: ## Open questions body is not exactly 'None.'"
	manifest=$(section "$A" Manifest | grep -E '^[0-9a-f]{64}  ')
	want=$(own_frames "$dir" "$A" | sort)
	got=$(printf '%s\n' "$manifest" | sed -E 's/^[0-9a-f]{64}  //' | sed '/^$/d' | sort)
	[ -n "$want" ] && [ "$want" = "$got" ] || bad 1 "$s: ## Manifest does not list every frame of this amendment exactly once"
	while IFS= read -r line; do
		[ -z "$line" ] && continue
		sum=${line%%  *}
		f=${line#*  }
		[ -f "$dir/$f" ] || {
			bad 1 "$s: manifest names missing $f"
			continue
		}
		[ "$(shasum -a 256 "$dir/$f" | cut -d' ' -f1)" = "$sum" ] || bad 1 "$s: SHA-256 mismatch: $f"
	done <<< "$manifest"

	# --- Check 2: required frames, naming, Frames table ---------------------------
	frames_table=$(section "$A" Frames)
	for f in $(frames_for "$s"); do
		[ -f "$dir/$f" ] || bad 2 "$s: frame $f missing"
		echo "$frames_table" | grep -qF "\`$f\`" || bad 2 "$s: $f not in ## Frames"
	done
	for f in $(own_frames "$dir" "$A"); do
		echo "$f" | grep -qE '^[a-z]+(-[a-z]+)*-(mobile|medium|desktop)\.png$' || bad 2 "$s: $f breaks <screen>[-<state>]-<pairing>.png"
		echo "$frames_table" | grep -qF "\`$f\`" || bad 2 "$s: $f not in ## Frames"
	done
	if [ "$s" = game-rooms ]; then
		echo "$frames_table" | grep -qiE 'inning' || bad 2 "$s: ## Frames does not say the play's inning is chosen"
		echo "$frames_table" | grep -qiE 'open' || bad 2 "$s: ## Frames does not say the play's at-bat is open"
		echo "$frames_table" | grep -qiE 'mark' || bad 2 "$s: ## Frames does not say the play's at-bat is marked"
	fi

	# --- Check 3: ratification record ---------------------------------------------
	grep -qE '^Ratified by:[[:space:]]*[^[:space:]]' "$A" || bad 3 "$s: no 'Ratified by:' line"
	grep -qE '^Date:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]*$' "$A" || bad 3 "$s: no 'Date: YYYY-MM-DD' line"
	grep -qE '^Go-ahead:[[:space:]]*".+"' "$A" || bad 3 "$s: no quoted 'Go-ahead: \"…\"' line"
done

# --- Check 4: sealed files untouched -------------------------------------------------
# The commit S96 started from (HEAD when its grader was written).
BASE=2facf23
changed=$(story_changed_files S96 "$BASE" "$V")
for s in $SURFACES; do
	RAT="$V/$s/RATIFIED.md"
	[ -f "$RAT" ] || {
		bad 4 "$RAT missing"
		continue
	}
	while IFS= read -r line; do
		[ -z "$line" ] && continue
		sum=${line%%  *}
		f=${line#*  }
		[ -f "$V/$s/$f" ] || {
			bad 4 "$s: sealed $f missing"
			continue
		}
		[ "$(shasum -a 256 "$V/$s/$f" | cut -d' ' -f1)" = "$sum" ] || bad 4 "$s: sealed $f changed"
	done <<< "$(section "$RAT" Manifest | grep -E '^[0-9a-f]{64}  ')"
	mine=$(amendment "$s")
	while IFS= read -r f; do
		[ -z "$f" ] && continue
		case "$f" in
			"$V/$s/RATIFIED.md") bad 4 "$s: S96 changed RATIFIED.md" ;;
			"$V/$s/amendments/"A[0-9]*.md) [ "$f" = "$mine" ] || bad 4 "$s: S96 changed an earlier amendment, $f" ;;
			# Frames in amendments/ are S96's own or sealed by another amendment's manifest
			# (checked by hash below); in a case pattern `*` also matches `/`, so this comes first.
			"$V/$s/amendments/"*) ;;
			"$V/$s/"*.png) bad 4 "$s: S96 changed a sealed frame, $f" ;;
		esac
	done <<< "$(printf '%s\n' "$changed" | grep "^$V/$s/")"
	# A frame another amendment's manifest seals must still verify.
	for a in "$V/$s"/amendments/A[0-9]*.md; do
		[ "$a" = "$mine" ] && continue
		while IFS= read -r line; do
			[ -z "$line" ] && continue
			sum=${line%%  *}
			f=${line#*  }
			[ -f "$V/$s/amendments/$f" ] && [ "$(shasum -a 256 "$V/$s/amendments/$f" | cut -d' ' -f1)" != "$sum" ] &&
				bad 4 "$s: $f sealed by $(basename "$a") changed"
		done <<< "$(section "$a" Manifest | grep -E '^[0-9a-f]{64}  ')"
	done
done

# --- Check 5: backlog Status is done -------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S96\].*\| `done` \|' docs/v3/BACKLOG.md ||
	bad 5 "S96 row in the Story status table is not \`done\`"
awk '/^### S96 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md |
	grep -qE '^\*\*Status:\*\* `done`$' ||
	bad 5 "S96 story heading Status is not \`done\`"

report "verify-S96"
exit $?
