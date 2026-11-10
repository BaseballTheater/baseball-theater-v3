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

# The commit this story's branch was cut from. The fence (check 7) reads only S131's own commits: the
# first-parent, non-merge commits from BASE to the shipping commit (or HEAD, plus the working tree, while
# unshipped), as verify-S123.sh does. Merging a newer `stage` into this branch when S131 resumes is handled:
# the merge commit is skipped, and the stage commits it brings in are not on the first-parent line. Rebasing
# onto a newer `stage` replays this branch's commits on the first-parent line, so they still count; stage's
# own first-parent line is only `gh pr merge --merge` merges, which --no-merges skips. Only a fresh branch cut
# from `stage` after this checkpoint's pull request merges changes the count: the checkpoint then sits behind
# a merge's second parent and stops counting. That under-counts, so it can't make the fence fail wrongly;
# moving BASE to the new fork point is optional tidying (allowed while the grader is unshipped).
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

# Files S131's own commits changed (see BASE): first-parent, non-merge commits from BASE to the shipping
# commit, plus, while unshipped, the uncommitted and untracked files in the tree.
s131_changed() {
  local tip
  tip="$(story_tip S131)"
  {
    git log --first-parent --no-merges --no-renames --format= --name-only "$BASE..${tip:-HEAD}"
    if [ -z "$tip" ]; then
      git diff --no-renames --name-only HEAD
      git ls-files --others --exclude-standard
    fi
  } | sed '/^$/d' | sort -u
}

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
# Only the production job's block: four jobs have a "Build the web app" step. The block is read as YAML-ish
# structure by indentation, comment lines dropped so a commented-out command never counts:
#   - a step starts at its list item ("- <key>:" at the steps' indentation, whatever its first key);
#   - its run: is joined into one script (block `|`/`>` styles, `\` continuations) and split into commands at
#     newlines, `&&` and `;`; the check is a command that starts with `pnpm`, then any of `run`/`-s`/`--silent`,
#     then `release:check`, whose first argument is the tag itself (${{ github.event.release.tag_name }}) or a
#     $VAR / ${VAR} that an `env:` block (the step's or the job's) sets to it — GitHub's injection-safe form;
#   - a `--` before the argument is allowed (pnpm passes it through); a YAML-quoted inline run: is unquoted;
#   - nothing after the argument may pipe, `||` or background (`&`) its failure away, and no `set +e` may come
#     before it in the same run block;
#   - the step may not carry `continue-on-error` (other than false) or a `shell:` of its own, and its `if:`
#     must be absent, always() or success() (with or without ${{ }}): the check must run unconditionally, so
#     even a condition that is usually true (e.g. `github.event.release.prerelease == false`) is rejected.
# It must come after the Install step and before the first other step that builds, migrates or deploys.
tr -d '\r' <.github/workflows/deploy.yml | awk '/^    production:$/{f=1;next} /^    [a-z-]+:$/{f=0} f' >"$TMP/production.yml"
cat >"$TMP/check4.cjs" <<'JS'
const lines = require("fs").readFileSync(process.argv[2], "utf8").split("\n").filter((l) => l.trim() !== "" && !/^\s*#/.test(l));
const indent = (l) => l.length - l.trimStart().length;
const TAG = /^\$\{\{\s*github\.event\.release\.tag_name\s*\}\}$/;
const unquote = (v) => v.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
// Variables an env: block (its children at `at` indentation, from line i+1) sets to the tag.
const envVars = (from, at) => {
  const vars = new Set();
  for (let i = from; i < lines.length && indent(lines[i]) >= at; i++) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(lines[i]);
    if (indent(lines[i]) === at && m && TAG.test(unquote(m[2]))) vars.add(m[1]);
  }
  return vars;
};
const jobKeys = Math.min(...lines.map(indent));
const jobEnvAt = lines.findIndex((l) => indent(l) === jobKeys && /^\s*env:\s*$/.test(l));
const jobEnv = jobEnvAt >= 0 ? envVars(jobEnvAt + 1, indent(lines[jobEnvAt + 1] ?? "")) : new Set();
const stepsAt = lines.findIndex((l) => indent(l) === jobKeys && /^\s*steps:\s*$/.test(l));
if (stepsAt < 0) process.exit(1);
const stepIndent = indent(lines[stepsAt + 1] ?? "");
const steps = [];
for (let i = stepsAt + 1; i < lines.length && indent(lines[i]) >= stepIndent; i++) {
  if (indent(lines[i]) === stepIndent && /^\s*- [A-Za-z_-]+:/.test(lines[i])) steps.push([]);
  if (steps.length) steps[steps.length - 1].push(i);
}
// One step's keys (at its key indentation), each with its inline value and the line numbers below it.
const keysOf = (idx) => {
  const keyAt = stepIndent + 2;
  const keys = {};
  let cur = null;
  for (const i of idx) {
    const l = i === idx[0] ? lines[i].replace("- ", "  ") : lines[i];
    const m = /^\s*([A-Za-z_-]+):\s*(.*)$/.exec(l);
    if (indent(l) === keyAt && m) {
      cur = m[1];
      keys[cur] = { value: m[2], at: i, body: [] };
    } else if (cur) keys[cur].body.push(i);
  }
  return keys;
};
const script = (run) => {
  if (!run) return "";
  const style = run.value.trim();
  const body = run.body.map((i) => lines[i].trim());
  let text = /^[|>]/.test(style) ? (style.startsWith(">") ? body.join(" ") : body.join("\n")) : unquote(style);
  return text.replace(/\\\n\s*/g, " ");
};
const CMD = /^pnpm\s+(?:(?:run|-s|--silent)\s+)*release:check\s+(?:--\s+)?("[^"]*"|'[^']*'|\$\{\{[^}]*\}\}|\S+)(.*)$/;
const isCheck = (keys) => {
  if (keys.if && !/^(\$\{\{\s*)?(always|success)\(\)(\s*\}\})?$/.test(unquote(keys.if.value))) return false;
  if (keys.shell) return false;
  if (keys["continue-on-error"] && !/^\s*["']?false["']?\s*$/.test(keys["continue-on-error"].value)) return false;
  const vars = new Set(jobEnv);
  // The env: block's children sit at whatever indentation its first child line has.
  if (keys.env && keys.env.body.length) for (const v of envVars(keys.env.body[0], indent(lines[keys.env.body[0]]))) vars.add(v);
  let errexitOff = false;
  return script(keys.run).split(/\n|&&|;/).some((c) => {
    if (/^set\s+\+[a-z]*e/.test(c.trim())) errexitOff = true;
    const m = CMD.exec(c.trim());
    if (!m || errexitOff || /[|&]/.test(m[2].replace(/>&|&>/g, ""))) return false;
    const arg = unquote(m[1]);
    if (TAG.test(arg)) return true;
    const v = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(arg);
    return Boolean(v && vars.has(v[1]));
  });
};
const parsed = steps.map(keysOf);
const name = (k) => (k.name ? unquote(k.name.value) : "");
const isWork = (k) => /\bBuild\b/.test(name(k)) || /\bbuild\b|wrangler deploy|deploy:|db:migrate/.test(script(k.run));
const install = parsed.findIndex((k) => name(k) === "Install");
const check = parsed.findIndex(isCheck);
const work = parsed.findIndex((k, i) => i > install && i !== check && isWork(k));
process.exit(install >= 0 && check > install && work > check ? 0 : 1);
JS
node "$TMP/check4.cjs" "$TMP/production.yml" || bad 4 "the production job does not run pnpm release:check with github.event.release.tag_name after Install and before building"

# --- Check 5: the release rule ----------------------------------------------------------------------------------
# The rule's own bullet, up to the next rule. Each phrase stands for one clause of AC 5, and none of them is in
# CLAUDE.md before S131 (checked at 28c2059), so the check can't pass on the old rule.
awk '/^- \*\*The coordinator manages releases/{f=1} f&&/^- \*\*Copilot/{exit} f' CLAUDE.md >"$TMP/rule.md"
for s in 'releases/<version>.json' \
  'CHANGELOG.md' \
  '`headline`' '`items`' '`fixesAndPolish`' '`approval`' \
  'shows the draft to the owner' \
  'lands it in `stage` through a pull request' \
  '`pnpm release:check <version>` exits 0' \
  'the notes all describe'; do
  grep -qF -- "$s" "$TMP/rule.md" || bad 5 "CLAUDE.md's release rule does not say: $s"
done
# AC 5's own wording is "never writing"; a rule written as "never writes" says the same.
grep -qE "never (writes|writing) an approval the owner didn('|’)t give in the current session" "$TMP/rule.md" ||
  bad 5 "CLAUDE.md's release rule does not say: never writing an approval the owner didn't give in the current session"
# The replaced wording: today's rule kept each release's fan-facing notes in its GitHub Release, "until S131
# rewrites this rule", with the pull request list "(no others) and" then the notes, approved "with the owner's
# in-session approval quoted" there. Those GitHub-Release-specific phrases must be gone; wording reused for
# releases/<version>.json (e.g. "drafted by the coordinator") and AC 6's "until S131" for the copied notes stay
# allowed.
grep -qiF 'until S131 rewrites this rule' "$TMP/rule.md" && bad 5 "CLAUDE.md's release rule still says: until S131 rewrites this rule"
grep -qE 'contains \(no others\) and,[^;]*fan-facing notes' "$TMP/rule.md" &&
  bad 5 "CLAUDE.md's release rule still puts the fan-facing notes in the GitHub Release beside its pull request list"
grep -qF "one line for minor fixes and polish), with the owner's in-session approval quoted" "$TMP/rule.md" &&
  bad 5 "CLAUDE.md's release rule still quotes the owner's approval in the GitHub Release"

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
s131_changed >"$TMP/changed.txt"
grep -vE '^(releases/|packages/domain/|functions/src/|functions/vitest\.config\.ts$|package\.json$|\.github/workflows/deploy\.yml$|CLAUDE\.md$|docs/v3/BACKLOG\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S131\.sh$)' "$TMP/changed.txt" >"$TMP/fence.txt"
[ -s "$TMP/fence.txt" ] && bad 7 "the story changes files outside its scope: $(tr '\n' ' ' <"$TMP/fence.txt")"
grep -E '^test/' "$TMP/changed.txt" >"$TMP/test-dir.txt"
[ -s "$TMP/test-dir.txt" ] && bad 7 "the story changes files under test/: $(tr '\n' ' ' <"$TMP/test-dir.txt")"

report "verify-S131"
exit $?
