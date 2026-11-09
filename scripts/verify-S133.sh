#!/usr/bin/env bash
# Grader for BACKLOG story S133 — design amendment: the changelist page, the update-available
# notice (A6) with its link and big additions, the after-update notification, and the rail's
# release version line, on the shell-scoreboard surface (rule 18; S134 and S135 build them).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).
#
# Modeled on scripts/verify-S129.sh. S133's own changes are its first-parent, non-merge commits
# after BASE (plus uncommitted and untracked files while it is unshipped), so a later merge of
# stage into this branch, or the stories this branch stacks on, never count as S133's.
#
# What AC 1 says the amendment must *say* (the page's address, where else it is reached from,
# how long the after-update notification stays, what A6 shows for a retired version and whether
# its link shows, where the after-update notification sits beside another notice, and the rail's
# version line) is read from one structured line each in ## Decisions, each citing and quoting the
# owner, so the outcome the owner chose is what the grader reads.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "shell-scoreboard has its next free amendments/A<N>.md (new in S133) headed '(S133)', naming what it adds/overrides/repeals, with ## Frames, ## Decisions (owner's words quoted, one answer per open question the draft asked), ## Open questions = None., and a SHA-256 manifest of exactly its own frames"
check 2 "the changelist page (releases, empty, loading, error), A6 with its link (no additions, one, more than fit, retired version) and the after-update notification (no additions, additions, beside A6, beside a marker) drawn at mobile, medium and desktop, and the rail's release version line at desktop: real PNGs at the ratified pairing width, listed in ## Frames, which names the buckets, kinds and states; every frame ## Frames names is one of its own; no earlier frame's name.png anywhere in the amendment"
check 3 "## Decisions says, one cited and quoted line each: the page's Address (a new route), where else it is Reached from, how long the after-update notification stays (Dismisses after: N seconds), the Retired version case (additions none; link shown and where it goes, or hidden), its place With another notice, and the Rail version line (semver)"
check 4 "the amendment's ## Ratification names Jake Lauer, the date, and quotes the owner's in-session go-ahead, and no draft marker or pending wording is left"
check 5 "no sealed file in shell-scoreboard changed or deleted (RATIFIED.md manifest verifies; RATIFIED.md, ratified frames and every other amendment untouched by S133; every amendment's sealed frames present and unchanged)"
check 6 "S133 changes no file outside its fence (scripts/verify-S133.sh aside)"
check 7 "backlog Status is done (story heading and Story status table)"

V="docs/v3/visual"
S="shell-scoreboard"
DIR="$V/$S/amendments"

# The commit S133 started from (HEAD when its grader was written). Bring a newer stage into
# this branch by merging it, not rebasing: a merge leaves BASE an ancestor and its changes off
# S133's first-parent chain; after a rebase BASE must move to the new fork point (a grader may
# be updated before its story ships).
BASE=8386015

# Lines of section "## <name>" in a file.
section() {
	awk -v h="## $2" '$0==h{f=1;next} /^## /{f=0} f' "$1"
}

# The story's shipping commit, or nothing while it is unshipped (lib/checks.sh).
TIP=$(story_tip S133)

# Files S133 itself changed under <paths>: its own first-parent, non-merge commits after BASE,
# plus uncommitted and untracked changes while unshipped. --no-renames lists a moved file
# under both names, so a rename can't hide a deletion.
s133_changed() {
	{
		git log --first-parent --no-merges --no-renames --format= --name-only "$BASE..${TIP:-HEAD}" -- "$@"
		if [ -z "$TIP" ]; then
			git diff --no-renames --name-only HEAD -- "$@"
			git ls-files --others --exclude-standard -- "$@"
		fi
	} | sed '/^$/d' | sort -u
}
changed=$(s133_changed "$V")

# Was <path> present at BASE?
at_base() {
	git cat-file -e "$BASE:$1" 2>/dev/null
}

# The S133 amendment: the A<N>.md whose heading ends "(S133)" and that did not exist at BASE.
A=""
for a in $(grep -lE '^# A[0-9]+ .*\(S133\)$' "$DIR"/A[0-9]*.md 2>/dev/null); do
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

# The amendment's own frames: PNGs in amendments/ that S133 added (absent at BASE, present
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

# PNG width (IHDR), in pixels.
png_width() {
	local b1 b2 b3 b4
	read -r b1 b2 b3 b4 <<< "$(od -An -tu1 -j16 -N4 "$1")"
	echo $((b1 * 16777216 + b2 * 65536 + b3 * 256 + b4))
}

# png_ok <file> <pairing> — a real PNG (signature, IHDR first, ends in IEND with its CRC) as wide
# as the ratified scoreboard-<pairing>.png (390, 768 and 1008: every frame of this surface at a
# pairing shares its width). Prints why not, if not.
png_ok() {
	local f="$1" ref="$V/$S/scoreboard-$2.png" w want
	[ -s "$f" ] || { echo "empty"; return 1; }
	[ "$(head -c 8 "$f" | od -An -tx1 | tr -d ' \n')" = "89504e470d0a1a0a" ] || { echo "not a PNG"; return 1; }
	[ "$(od -An -tx1 -j12 -N4 "$f" | tr -d ' \n')" = "49484452" ] || { echo "no IHDR chunk first"; return 1; }
	[ "$(tail -c 8 "$f" | od -An -tx1 | tr -d ' \n')" = "49454e44ae426082" ] || { echo "does not end in an IEND chunk (truncated?)"; return 1; }
	w=$(png_width "$f")
	want=$(png_width "$ref")
	[ "$w" = "$want" ] || { echo "${w}px wide, not ${want}px"; return 1; }
}

# The last quotation on each input line, straight ("…") or curly (“…”), or nothing. Perl with
# -CSD reads UTF-8 whatever the locale, so a curly quote is one character.
last_quote() {
	perl -CSD -ne 'while (/"([^"]+)"|\x{201C}([^\x{201D}]+)\x{201D}/g) { $q = defined $1 ? $1 : $2 } END { print $q if defined $q }'
}
# The owner's answer on a cited line: the quotation right after the citation's closing paren or,
# only if there is none, a quotation inside the citation that runs to that paren (`…: "…")`), so a
# code literal in the question text or later on the line is never taken for it.
# Accepted forms (the quotation may be italic, *"…"* or _"…"_):
#   (owner, YYYY-MM-DD, …): "…"     (owner, YYYY-MM-DD, …) : "…"     (owner, YYYY-MM-DD, asked …: "…")
ANSWER_FORMS='(owner, YYYY-MM-DD, …): "…", or (owner, YYYY-MM-DD, …: "…"); italic *"…"* allowed; curly “…” when the words contain straight quotes'
answer_quote() {
	perl -CSD -ne 'my $q = qr/[*_]?(?:"([^"]+)"|\x{201C}([^\x{201D}]+)\x{201D})/;
		if (/\(owner, \d{4}-\d{2}-\d{2}(?:[^()]|\([^()]*\))*\)\s*:?\s*$q/ || /\(owner, \d{4}-\d{2}-\d{2}(?:[^()]|\([^()]*\))*?:\s*$q[*_]?\s*\)/) { print((grep { defined } $1, $2)[0]); exit }'
}
# Does <text> quote anything?
quotes() {
	[ -n "$(printf '%s\n' "$1" | last_quote)" ]
}

PAIRINGS="mobile medium desktop"
# Every state AC 1 names, drawn at every pairing.
STATES="changelist changelist-empty changelist-loading changelist-error update-notice-link update-notice-headline update-notice-headline-more update-notice-retired updated-notice updated-notice-headline updated-notice-with-update updated-notice-with-marker"
# The rail's version line is drawn where the rail is, on desktop.
RAIL_FRAME="rail-version-release-desktop.png"
NAME_RE='^[a-z]+(-[a-z]+)*-(mobile|medium|desktop)\.png$'

required_frames() {
	local s p
	for s in $STATES; do
		for p in $PAIRINGS; do echo "$s-$p.png"; done
	done
	echo "$RAIL_FRAME"
}

# Every frame name sealed before S133 (the ratified manifest's PNGs and every other amendment's
# manifest), plus the frames a written amendment (A6) governs by name, shell-notice-<p> and A1's
# shell-update-<p>. design-reference.ts counts an amendment whose text contains "<frame>.png" as
# drawing that frame, so naming one here (even inside a longer name) would take it from A6/A1.
earlier_frames() {
	local a p
	section "$V/$S/RATIFIED.md" Manifest | grep -oE '  [^ ]+\.png$' | sed 's/^  //'
	for a in "$DIR"/A[0-9]*.md; do
		[ "$a" = "$A" ] && continue
		section "$a" Manifest | grep -oE '  [^ ]+\.png$' | sed 's/^  //'
	done
	for p in $PAIRINGS; do
		echo "shell-notice-$p.png"
		echo "shell-update-$p.png"
	done
}

if [ -z "$A" ]; then
	bad 1 "$S: no new amendments/A<N>.md headed (S133)"
	bad 2 "$S: no amendment, so no frames"
	bad 3 "$S: no amendment, so nothing said about the address, entry points, timing, retired case, placement or version line"
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
	quotes "$decisions" || bad 1 "## Decisions quotes no owner words"
	oq=$(section "$A" "Open questions" | sed '/^[[:space:]]*$/d')
	[ "$oq" = "None." ] || bad 1 "## Open questions body is not exactly 'None.'"
	# Every open question the draft ever asked (labelled **Q<n>.**) is answered in ## Decisions by
	# a line naming Q<n> (word boundary: Q1 is not Q10) whose owner citation is followed by the
	# owner's quoted words (answer_quote).
	labels=$({
		git log --first-parent --no-merges --no-renames -p --format= "$BASE..${TIP:-HEAD}" -- "$A"
		[ -z "$TIP" ] && git diff --no-renames HEAD -- "$A"
		cat "$A"
	} | grep -oE '\*\*Q[0-9]+\.\*\*' | grep -oE '[0-9]+' | sort -un)
	for q in $labels; do
		qline=$(echo "$decisions" | grep -E "(^|[^[:alnum:]])Q${q}([^0-9]|\$)")
		[ -n "$(printf '%s\n' "$qline" | answer_quote)" ] ||
			bad 1 "open question Q$q has no cited owner answer in ## Decisions (forms: $ANSWER_FORMS)"
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
	for f in $(required_frames); do
		if [ -f "$DIR/$f" ]; then
			echo "$own" | grep -qxF "$f" || bad 2 "$f is not a frame this amendment added"
		else
			bad 2 "frame $f missing"
		fi
		echo "$frames_table" | grep -qF "\`$f\`" || bad 2 "$f not in ## Frames"
	done
	# Every frame ## Frames names (backticked or not, any case) exists as one of this amendment's
	# own frames, so a row can't promise a state the set leaves out.
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
	# Each frame is its own drawing: never a byte-for-byte copy of a ratified frame it starts from,
	# nor of another of its own frames.
	for f in $own; do
		p=$(echo "$f" | sed -E 's/.*-(mobile|medium|desktop)\.png$/\1/')
		h=$(shasum -a 256 < "$DIR/$f")
		for src in "$V/$S/scoreboard-$p.png" "$V/$S/shell-notice-$p.png" "$DIR/shell-update-$p.png" "$DIR/shell-version-$p.png" "$DIR/scoreboard-header-version-$p.png"; do
			[ -f "$src" ] && [ "$h" = "$(shasum -a 256 < "$src")" ] && bad 2 "$f is identical to $src"
		done
	done
	dupes=$(for f in $own; do shasum -a 256 < "$DIR/$f"; done | sort | uniq -d)
	[ -z "$dupes" ] || bad 2 "two or more of this amendment's frames are byte-for-byte identical"
	# No earlier frame's "<name>.png" anywhere in the amendment (design-reference.ts:78).
	while IFS= read -r e; do
		[ -z "$e" ] && continue
		grep -qF -- "$e" "$A" && bad 2 "$A contains '$e', which would make it the reference for that earlier frame (design-reference.ts)"
	done <<< "$(earlier_frames | sort -u)"
	# AC 1's buckets, kinds and states are drawn, so ## Frames (what each export shows) names them.
	for term in "fixes and polish" "feature" "setting" "fix" "design" "empty" "loading" "error" "link" "retired" "dismiss" "more" "marker" "version"; do
		echo "$frames_table" | grep -qiF "$term" || bad 2 "## Frames never mentions '$term'"
	done

	# --- Check 3: what AC 1 says the amendment says -----------------------------------
	# decision_line <label> — sets DL to the one "- <label>: …" line of ## Decisions and returns 0;
	# bad 3 (and returns 1) unless exactly one exists and it cites and quotes the owner. Called
	# directly, never in $(…), so its bad reaches this shell.
	DL=""
	decision_line() {
		DL=$(echo "$decisions" | grep -E "^- $1:")
		if [ "$(printf '%s' "$DL" | grep -c .)" != 1 ]; then
			bad 3 "## Decisions needs exactly one '- $1: …' line"
			return 1
		fi
		[ -n "$(printf '%s\n' "$DL" | answer_quote)" ] || {
			bad 3 "the '- $1:' line has no cited owner answer (forms: $ANSWER_FORMS)"
			return 1
		}
	}
	if decision_line "Address"; then
		addr=$(echo "$DL" | grep -oE '^- Address: `/[a-z0-9-]+`' | grep -oE '/[a-z0-9-]+')
		if [ -z "$addr" ]; then
			bad 3 "the '- Address:' line does not start with a backticked path like \`/whats-new\`"
		elif grep -qE "path=\"$addr(/|\")" web/src/routes.tsx; then
			bad 3 "the address $addr is already another page's route in web/src/routes.tsx"
		fi
	fi
	decision_line "Reached from"
	if decision_line "Dismisses after"; then
		secs=$(echo "$DL" | grep -oE '^- Dismisses after: [0-9]+ seconds' | grep -oE '[0-9]+')
		[ -n "$secs" ] && [ "$secs" -ge 1 ] && [ "$secs" -le 120 ] ||
			bad 3 "the '- Dismisses after:' line does not start with '<N> seconds' (1 to 120)"
	fi
	if decision_line "Retired version"; then
		l=$DL
		echo "$l" | grep -qiE 'no additions' || bad 3 "the '- Retired version:' line does not say A6 shows no additions"
		if echo "$l" | grep -qiE 'link shown'; then
			echo "$l" | grep -qiE 'goes to' || bad 3 "the retired version's link is shown, but the line does not say where it goes"
		elif ! echo "$l" | grep -qiE 'link hidden'; then
			bad 3 "the '- Retired version:' line says neither 'link shown' nor 'link hidden'"
		fi
	fi
	decision_line "With another notice"
	if decision_line "Rail version"; then
		echo "$DL" | grep -qE '`v[0-9]+\.[0-9]+\.[0-9]+' || bad 3 "the '- Rail version:' line shows no semver version line (\`vMAJOR.MINOR.PATCH …\`)"
	fi

	# --- Check 4: ratification record ---------------------------------------------
	rat=$(section "$A" Ratification)
	echo "$rat" | grep -qE '^Ratified by:[[:space:]]*Jake Lauer([^[:alnum:]]|$)' || bad 4 "## Ratification has no 'Ratified by: Jake Lauer' line"
	echo "$rat" | grep -qE '^Date:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]*$' || bad 4 "## Ratification has no 'Date: YYYY-MM-DD' line"
	quotes "$(echo "$rat" | grep -E '^Go-ahead:')" || bad 4 "## Ratification has no quoted 'Go-ahead: … \"…\"' line"
	grep -qiE '\*\*Draft|not (yet )?ratified' "$A" && bad 4 "the amendment still says it is a draft or not ratified"
	section "$A" Manifest | grep -qi 'pending' && bad 4 "## Manifest is still pending"
	grep -qiE 'pending Q[0-9]+' "$A" && bad 4 "the amendment still has text pending an open question"
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
		"$V/$S/RATIFIED.md") bad 5 "S133 changed RATIFIED.md" ;;
		# S133 writes only its own amendment; any change it makes to another one fails.
		"$DIR/"A[0-9]*.md) [ "$f" = "$A" ] || bad 5 "S133 changed another amendment, $f" ;;
		# A PNG in amendments/ that existed at BASE is another amendment's; S133 only adds its own.
		# (In a case pattern `*` also matches `/`, so these come before the surface-wide one.)
		"$DIR/"*.png) at_base "$f" && bad 5 "S133 changed or deleted $f, which existed before it" ;;
		"$DIR/"*) ;;
		"$V/$S/"*) bad 5 "S133 changed a sealed file, $f" ;;
		*) bad 5 "S133 changed $f, outside its surface" ;;
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
		"$DIR/"* | docs/v3/VISUAL-DESIGN.md | docs/v3/FEATURES.md | docs/v3/BACKLOG.md | docs/v3/backlog/* | \
			docs/v3/AUDIT.md | docs/v3/audit.jsonl | docs/v3/INDEX.md | CHANGELOG.md | scripts/verify-S133.sh) ;;
		# Obsidian editor state: never committed (CLAUDE.md), so only ever an uncommitted change.
		docs/v3/.obsidian/workspace.json) [ -z "$TIP" ] || bad 6 "S133 committed $f" ;;
		*) bad 6 "S133 changed $f, outside its fence" ;;
	esac
done <<< "$(s133_changed .)"

# --- Check 7: backlog Status is done -------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S133\].*\| `done` \|' docs/v3/BACKLOG.md ||
	bad 7 "S133 row in the Story status table is not \`done\`"
awk '/^### S133 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md |
	grep -qE '^\*\*Status:\*\* `done`$' ||
	bad 7 "S133 story heading Status is not \`done\`"

report "verify-S133"
exit $?
