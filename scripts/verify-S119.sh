#!/usr/bin/env bash
# Grader for BACKLOG story S119 — production deploys to next.baseball.theater, not baseball.theater,
# until the owner cuts DNS over from Elastic Beanstalk by hand (owner, 2026-11-07: "Do the
# temporary address"). A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. Never deploys. Parses wrangler.jsonc at the working tree and at the commit that added
# S119's note, so "staging and previews unchanged" is a parse-and-compare. No writes outside /tmp.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "wrangler.jsonc env.production is routed to the custom domain next.baseball.theater with BT_APP_ORIGIN https://next.baseball.theater; nothing in wrangler.jsonc or .github/workflows/ claims baseball.theater or www.baseball.theater; staging and previews unchanged"
check 2 "no https://baseball.theater left in functions/, web/, wrangler.jsonc or .github/workflows/; bootstrap.test.ts expects https://next.baseball.theater and passes (test 'S114 AC 8')"
check 3 "README's deploy section: production at next.baseball.theater until the owner's cutover, the cutover as an owner step (wrangler.jsonc custom domain + BT_APP_ORIGIN, replaces the Elastic Beanstalk DNS record), rollback (DNS back / wrangler rollback); launch checklist has DNS cutover from Elastic Beanstalk"
check 4 "backlog Status is done (story heading and Story status table)"
check 5 "the story changed nothing outside its fence (wrangler.jsonc, .github/workflows/deploy.yml, README.md, functions/, web/, docs/v3/BACKLOG.md, docs/v3/backlog/, docs/v3/AUDIT.md, docs/v3/audit.jsonl, docs/v3/INDEX.md, CHANGELOG.md, scripts/verify-S119.sh)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BASE="b2e867d"  # the commit that added S119's note; the story's work starts after it
git show "$BASE:wrangler.jsonc" >"$TMP/wrangler-base.jsonc"

run_vitest() {
  local id="$1" dir="$2" file="$3" config="$4"
  shift 4
  if [ ! -f "$dir/$file" ]; then
    bad "$id" "$dir/$file missing"
  elif ! (cd "$dir" && pnpm exec vitest run $config "$file" "$@" --reporter=json --outputFile="$TMP/r.json" >"$TMP/r.log" 2>&1); then
    bad "$id" "$dir/$file $* failed:"; tail -15 "$TMP/r.log" | sed 's/^/        /'
  elif ! node -e 'process.exit(require(process.argv[1]).numPassedTests > 0 ? 0 : 1)' "$TMP/r.json"; then
    bad "$id" "$dir/$file $* ran no passing test"
  fi
}

# --- Check 1: production's custom domain and origin; no apex claim; staging/previews unchanged ------
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const load = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^\s*\/\/.*$/gm, ""));
  const now = load("wrangler.jsonc");
  const was = load(process.argv[1]);
  const errs = [];
  const p = (now.env ?? {}).production;
  if (!p) errs.push("wrangler.jsonc has no env.production");
  else {
    if (!(p.routes ?? []).some((r) => r.pattern === "next.baseball.theater" && r.custom_domain === true)) errs.push("env.production is not routed to the custom domain next.baseball.theater");
    if ((p.vars ?? {}).BT_APP_ORIGIN !== "https://next.baseball.theater") errs.push("env.production BT_APP_ORIGIN is " + (p.vars ?? {}).BT_APP_ORIGIN + ", not https://next.baseball.theater");
  }
  // Every route anywhere (top level and every env): none may be the apex or www.
  const blocks = [["top level", now]].concat(Object.entries(now.env ?? {}));
  for (const [name, b] of blocks) {
    for (const r of [].concat(b.routes ?? [], b.route ? [b.route] : [])) {
      const pattern = typeof r === "string" ? r : String(r.pattern ?? "");
      const host = pattern.replace(/^https?:\/\//, "").split("/")[0].replace(/^\*\.?/, "");
      if (host === "baseball.theater" || host === "www.baseball.theater" || pattern.startsWith("*baseball.theater")) errs.push(name + " claims " + pattern + " as a route");
    }
  }
  for (const e of ["staging", "preview"]) {
    if (JSON.stringify((now.env ?? {})[e]) !== JSON.stringify((was.env ?? {})[e])) errs.push("env." + e + " changed from S118");
  }
  for (const e of errs) console.log(e);
' "$TMP/wrangler-base.jsonc" >"$TMP/c1.txt" 2>&1
[ -s "$TMP/c1.txt" ] && while IFS= read -r line; do bad 1 "$line"; done <"$TMP/c1.txt"
# Workflows: no non-comment line names the apex or www (stage. and next. are fine).
grep -rnE '(^|[^a-z0-9.-])(www\.)?baseball\.theater' .github/workflows/ 2>/dev/null | grep -vE '^[^:]+:[0-9]+:\s*#' >"$TMP/wf.txt"
[ -s "$TMP/wf.txt" ] && { bad 1 "a workflow still names baseball.theater or www.baseball.theater:"; sed 's/^/        /' "$TMP/wf.txt"; }

# --- Check 2: production's address as a constant follows it -----------------------------------------
grep -rnF 'https://baseball.theater' functions web wrangler.jsonc .github/workflows \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=coverage --exclude-dir=.wrangler 2>/dev/null >"$TMP/c2.txt"
[ -s "$TMP/c2.txt" ] && { bad 2 "https://baseball.theater is still a constant:"; sed 's/^/        /' "$TMP/c2.txt"; }
grep -qF 'BT_APP_ORIGIN).toBe("https://next.baseball.theater")' functions/src/deploy/bootstrap.test.ts ||
  bad 2 "functions/src/deploy/bootstrap.test.ts does not expect production's BT_APP_ORIGIN to be https://next.baseball.theater"
run_vitest 2 functions src/deploy/bootstrap.test.ts "" -t "S114 AC 8"

# --- Check 3: README's deploy section ----------------------------------------------------------------
awk '/^## Deploying/{f=1;print;next} /^## /{f=0} f' README.md >"$TMP/deploy.md"
[ -s "$TMP/deploy.md" ] || bad 3 "README.md has no ## Deploying section"
for phrase in 'next.baseball.theater' 'cutover' 'Elastic Beanstalk' 'custom domain' 'BT_APP_ORIGIN' 'wrangler.jsonc' 'DNS record' 'wrangler rollback' 'DNS cutover from Elastic Beanstalk'; do
  grep -qiF -- "$phrase" "$TMP/deploy.md" || bad 3 "README's deploy section does not mention \"$phrase\""
done
grep -qE '^- \[ \] .*DNS cutover from Elastic Beanstalk' "$TMP/deploy.md" || bad 3 "the launch checklist has no \"DNS cutover from Elastic Beanstalk\" item"
grep -qE 'deploys production, `baseball\.theater`' "$TMP/deploy.md" && bad 3 "README still says a push to main deploys baseball.theater"

# --- Check 4: backlog Status is done -----------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S119\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 4 "S119 row in the Story status table is not \`done\`"
awk '/^### S119 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md >"$TMP/s119.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s119.md" || bad 4 "S119 story heading Status is not \`done\`"

# --- Check 5: the fence ------------------------------------------------------------------------------
story_changed_files S119 "$BASE" . |
  grep -vE '^(wrangler\.jsonc$|\.github/workflows/deploy\.yml$|README\.md$|functions/|web/|docs/v3/BACKLOG\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S119\.sh$|docs/v3/\.obsidian/)' >"$TMP/out.txt"
[ -s "$TMP/out.txt" ] && { bad 5 "files changed outside the fence:"; sed 's/^/        /' "$TMP/out.txt"; }

report "verify-S119"
exit $?
