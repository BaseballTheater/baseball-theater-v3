#!/usr/bin/env bash
# Grader for BACKLOG story S131 — Each release's fan-facing notes, approved by the owner before it
# publishes. packages/domain owns the notes' type and their one parser (ReleaseNotes,
# parseReleaseNotes), the one version check and comparison (parseReleaseVersion,
# compareReleaseVersions) and "which release is this build" (currentRelease); `pnpm release:check
# <version>` refuses notes that are missing, drafts or misnamed; production's deploy job runs it
# before building; CLAUDE.md's release rule drafts, approves and lands the notes; releases/ holds
# the notes of every release published before S131. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "packages/domain defines ReleaseNotes and parseReleaseNotes (version with no leading zero, calendar date, headline, kinded items, fixesAndPolish, quoted approval, no entry in both buckets, every problem by field), tested on each edge the AC names"
check 2 "packages/domain exports parseReleaseVersion (used by parseReleaseNotes), compareReleaseVersions (numeric per part) and currentRelease (newest approved notes, drafts ignored), tested on each edge the AC names"
check 3 "pnpm release:check <version> exits 0 only for releases/<version>.json that exists, parses, is approved and names its own version; otherwise nonzero with each problem (tested over temporary directories)"
check 4 "deploy.yml's production job runs pnpm release:check with github.event.release.tag_name after Install and before any build step"
check 5 "CLAUDE.md's release rule drafts releases/<version>.json from CHANGELOG entries in FEATURES' buckets, quotes the owner's in-session approval, lands it through a pull request, publishes only where release:check exits 0, and no longer keeps the notes in the GitHub Release until S131"
check 6 "releases/v3.1.0.json exists and pnpm release:check exits 0 for every file in releases/"
check 7 "backlog Status is done (story heading and Story status table), and the story stays inside its scope files"

BASE=28c2059
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
NOTES="packages/domain/src/release-notes.ts"
NOTES_TEST="src/release-notes.test.ts"
CHECK_TEST="src/scripts/release-check.test.ts"

# Runs one test file once, as JSON, so each AC can then require its own tagged tests.
run_json() {
  local dir="$1" file="$2" out="$3"
  [ -f "$dir/$file" ] && (cd "$dir" && pnpm exec vitest run "$file" --reporter=json --outputFile="$out" >"$out.log" 2>&1)
}
DOMAIN_OK=0
run_json packages/domain "$NOTES_TEST" "$TMP/domain.json" && DOMAIN_OK=1
CHECK_OK=0
run_json functions "$CHECK_TEST" "$TMP/check.json" && CHECK_OK=1

# Each AC needs at least one passing test whose full name carries its tag ("S131 AC <n> …").
tagged() {
  local id="$1" ok="$2" json="$3" where="$4" tag="$5"
  if [ "$ok" != 1 ]; then
    bad "$id" "$where missing or failing:"; tail -15 "$json.log" 2>/dev/null | sed 's/^/        /'
    return
  fi
  node -e '
    const r = require(process.argv[1]);
    const tag = process.argv[2];
    const hits = r.testResults.flatMap((f) => f.assertionResults).filter((t) => t.fullName.includes(tag));
    process.exit(hits.length > 0 && hits.every((t) => t.status === "passed") ? 0 : 1);
  ' "$json" "$tag" || bad "$id" "no passing test in $where named \"$tag\""
}
domain() { tagged "$1" "$DOMAIN_OK" "$TMP/domain.json" "packages/domain/$NOTES_TEST" "$2"; }
cli() { tagged "$1" "$CHECK_OK" "$TMP/check.json" "functions/$CHECK_TEST" "$2"; }

# --- Check 1: the notes and their parser -------------------------------------------------------------------
grep -qE '^export (interface|type) ReleaseNotes\b' "$NOTES" 2>/dev/null || bad 1 "$NOTES has no exported ReleaseNotes"
grep -qE '^export function parseReleaseNotes\(' "$NOTES" 2>/dev/null || bad 1 "$NOTES has no exported parseReleaseNotes"
grep -qE 'isCalendarDate' "$NOTES" 2>/dev/null || bad 1 "parseReleaseNotes does not check dates with isCalendarDate (one implementation)"
grep -qE 'release-notes' packages/domain/src/index.ts || bad 1 "packages/domain/src/index.ts does not export the release notes"
for t in "valid file" "bad version" "leading zero" "impossible date" "unknown kind" "empty title" "empty sentence" \
  "approval with no quote" "headline and items" "nothing in any bucket" "only fixesAndPolish" "v3.0.0"; do
  domain 1 "S131 AC 1 $t"
done

# --- Check 2: version, comparison, current release ------------------------------------------------------------
grep -qE '^export function parseReleaseVersion\(' "$NOTES" 2>/dev/null || bad 2 "$NOTES has no exported parseReleaseVersion"
grep -qE '^export function compareReleaseVersions\(' "$NOTES" 2>/dev/null || bad 2 "$NOTES has no exported compareReleaseVersions"
grep -qE '^export function currentRelease\(' "$NOTES" 2>/dev/null || bad 2 "$NOTES has no exported currentRelease"
# parseReleaseNotes uses parseReleaseVersion: its body (to the next top-level function) names it.
awk '/^export function parseReleaseNotes\(/{f=1} f&&/^}/{print; exit} f' "$NOTES" 2>/dev/null | grep -qF 'parseReleaseVersion(' ||
  bad 2 "parseReleaseNotes does not check its version with parseReleaseVersion"
for t in "v3.01.0" "3.1.0" "empty string" "v3.10.0 newer than v3.9.0" "newer draft ignored" "no approved notes"; do
  domain 2 "S131 AC 2 $t"
done

# --- Check 3: pnpm release:check --------------------------------------------------------------------------------
node -e 'const s = require("./package.json").scripts || {}; process.exit(/release-check/.test(s["release:check"] || "") ? 0 : 1)' ||
  bad 3 "package.json has no release:check script running the release check"
[ -f functions/src/scripts/release-check.ts ] || bad 3 "functions/src/scripts/release-check.ts missing"
for t in "missing file" "draft" "mismatched version" "valid"; do
  cli 3 "S131 AC 3 $t"
done
# End to end, through the real script, on a version no release will ever use.
if node -e 'process.exit(require("./package.json").scripts?.["release:check"] ? 0 : 1)'; then
  pnpm -s release:check v0.0.0 >"$TMP/missing.log" 2>&1 && bad 3 "pnpm release:check v0.0.0 (no notes file) exits 0"
fi

# --- Check 4: the production deploy runs it --------------------------------------------------------------------
# Only the production job's block: four jobs have a "Build the web app" step.
awk '/^    production:$/{f=1;next} /^    [a-z-]+:$/{f=0} f' .github/workflows/deploy.yml >"$TMP/production.yml"
node -e '
  const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\n");
  const at = (re) => lines.findIndex((l) => re.test(l));
  const install = at(/name: Install\b/);
  const check = at(/pnpm (-s )?release:check .*github\.event\.release\.tag_name/);
  const build = at(/(name: Build|pnpm (-s )?(--filter [^ ]+ )?build|vite build|wrangler deploy)/);
  process.exit(install >= 0 && check > install && build > check ? 0 : 1);
' "$TMP/production.yml" || bad 4 "the production job does not run pnpm release:check with github.event.release.tag_name after Install and before building"

# --- Check 5: the release rule ----------------------------------------------------------------------------------
awk '/^- \*\*The coordinator manages releases/{f=1} f&&/^- \*\*Copilot/{exit} f' CLAUDE.md >"$TMP/rule.md"
for s in 'releases/<version>.json' 'pnpm release:check <version>' 'CHANGELOG.md' 'headline' 'items' 'fixesAndPolish' 'approval' 'pull request'; do
  grep -qF "$s" "$TMP/rule.md" || bad 5 "CLAUDE.md's release rule does not mention $s"
done
grep -qF 'until S131 rewrites this rule' CLAUDE.md && bad 5 "CLAUDE.md still keeps each release's fan-facing notes in its GitHub Release until S131"

# --- Check 6: the notes of releases published before S131 ------------------------------------------------------
[ -f releases/v3.1.0.json ] || bad 6 "releases/v3.1.0.json missing"
for f in releases/*.json; do
  [ -f "$f" ] || continue
  v="$(basename "$f" .json)"
  pnpm -s release:check "$v" >"$TMP/rc.log" 2>&1 || { bad 6 "pnpm release:check $v fails:"; tail -10 "$TMP/rc.log" | sed 's/^/        /'; }
done

# --- Check 7: Status done, inside the fence ---------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S131\].*\| `done` \|$' docs/v3/BACKLOG.md || bad 7 "S131 row in the Story status table is not \`done\`"
awk '/^### S131 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md >"$TMP/s131.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s131.md" || bad 7 "S131 story heading Status is not \`done\`"
story_changed_files S131 "$BASE" . | grep -vE '^(releases/|packages/domain/|functions/src/|functions/vitest\.config\.ts$|package\.json$|\.github/workflows/deploy\.yml$|CLAUDE\.md$|docs/v3/BACKLOG\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S131\.sh$)' >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 7 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
story_changed_files S131 "$BASE" . | grep -E '^test/' >"$TMP/test-dir.txt"
[ -s "$TMP/test-dir.txt" ] && bad 7 "the story changes files under test/: $(tr '\n' ' ' <"$TMP/test-dir.txt")"

report "verify-S131"
exit $?
