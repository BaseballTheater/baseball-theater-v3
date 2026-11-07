#!/usr/bin/env bash
# Grader for BACKLOG story S118 — the stage/main branch flow: a push to `stage` deploys staging
# (stage.baseball.theater), a push to `main` deploys production (baseball.theater) on its own with
# no approval wait, CI runs on both branches, and the agent rules commit and push to `stage` and
# never to `main` (the owner's release step). A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. Never deploys. Reads the workflows at HEAD (or the working tree) and S114's shipping
# commit, so "unchanged from S114" is a parse-and-compare, not a guess. No writes outside /tmp.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "deploy.yml: a push to stage deploys staging and a push to main deploys production on its own (no needs on staging); main no longer deploys staging; previews, bootstrap, migrate, reapply-deletions and deploy steps are S114's unchanged"
check 2 "ci.yml runs on pushes to and pull requests into both stage and main; design-capture.yml hardcodes no main"
check 3 "CLAUDE.md, the run-stories skill and LOOP.md say agents commit and push to stage, check gh run list --branch stage first, and never push, merge into or release to main, quoting the owner; no rule text says to push main"
check 4 "README's deploy section: stage deploys staging, main deploys production, releasing is the owner merging stage into main (cherry-picks risk AUDIT.md/CHANGELOG.md conflicts), and the GitHub settings (default branch stage, production with no required reviewers, deployment branches main)"
check 5 "backlog Status is done (story heading and Story status table)"
check 6 "the story changed nothing outside its fence (the three workflows, README.md, CLAUDE.md, the run-stories skill, docs/v3/LOOP.md, docs/v3/BACKLOG.md, docs/v3/backlog/, docs/v3/AUDIT.md, docs/v3/audit.jsonl, docs/v3/INDEX.md, CHANGELOG.md, scripts/verify-S118.sh)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BASE="7a3fa0f"      # the commit that added S118's note; the story's work starts after it
S114_TIP="3a908b6"  # S114's shipping commit: the deploy workflow as S114 left it
git show "$S114_TIP:.github/workflows/deploy.yml" >"$TMP/deploy-s114.yml"

# One parse of each workflow, then a named question. Prints the reasons a check fails, one per
# line; nothing when it holds.
ask() {
  node --input-type=module -e '
    import { readFileSync, existsSync } from "node:fs";
    import { parse } from "yaml";
    const [question, s114Path] = process.argv.slice(1);
    const load = (p) => (existsSync(p) ? parse(readFileSync(p, "utf8")) : null);
    const errs = [];
    const on = (wf) => (wf ? (wf.on ?? wf[true] ?? {}) : {});
    const branches = (trigger) => (trigger === null || trigger === undefined ? null : [].concat(trigger.branches ?? []));
    const runs = (job) => (job.steps ?? []).map((s) => String(s.run ?? ""));
    const deploys = (jobs, env) => jobs.filter(([, j]) => runs(j).some((r) => new RegExp("wrangler deploy(?![^\\n]*--dry-run)[^\\n]*--env " + env + "\\b").test(r)));
    const needs = (job) => [].concat(job.needs ?? []);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    switch (question) {
      case "1": {
        const wf = load(".github/workflows/deploy.yml");
        const old = load(s114Path);
        if (!wf) { errs.push(".github/workflows/deploy.yml missing"); break; }
        const jobs = Object.entries(wf.jobs ?? {});
        const push = branches(on(wf).push) ?? [];
        for (const b of ["stage", "main"]) if (!push.includes(b)) errs.push("deploy.yml does not run on a push to " + b);
        const prBranches = branches(on(wf).pull_request);
        if (!on(wf).pull_request) errs.push("deploy.yml no longer runs on pull_request");
        else if (prBranches && prBranches.length > 0 && !["stage", "main"].every((b) => prBranches.includes(b))) errs.push("deploy.yml previews are limited to pull requests into " + prBranches.join(", "));
        if (!same(on(wf).pull_request, on(old).pull_request)) errs.push("deploy.yml pull_request trigger changed from S114");
        const staging = deploys(jobs, "staging");
        const prod = deploys(jobs, "production");
        if (staging.length !== 1) errs.push("expected one job deploying --env staging, found " + staging.length);
        if (prod.length !== 1) errs.push("expected one job deploying --env production, found " + prod.length);
        for (const [name, j] of staging) {
          const cond = String(j.if ?? "");
          if (!/push/.test(cond) || !/refs\/heads\/stage\b/.test(cond)) errs.push(name + " does not run on a push to stage");
          if (/refs\/heads\/main\b/.test(cond)) errs.push(name + " still runs on a push to main");
        }
        for (const [name, j] of prod) {
          const cond = String(j.if ?? "");
          if (!/push/.test(cond) || !/refs\/heads\/main\b/.test(cond)) errs.push(name + " does not run on a push to main");
          if (/refs\/heads\/stage\b/.test(cond)) errs.push(name + " runs on a push to stage");
          if (staging.some(([s]) => needs(j).includes(s))) errs.push(name + " still waits on the staging job (" + needs(j).join(", ") + ")");
        }
        // Everything but each deploy job trigger and needs is as S114 left it, step for step.
        for (const [name, j] of jobs) {
          const was = (old.jobs ?? {})[name];
          if (!was) { errs.push("job " + name + " is new; S118 changes only triggers and needs"); continue; }
          const strip = (x) => { const { if: _i, needs: _n, ...rest } = x; return rest; };
          const isDeploy = staging.concat(prod).some(([n]) => n === name);
          if (isDeploy ? !same(strip(j), strip(was)) : !same(j, was)) errs.push("job " + name + " changed beyond its trigger and needs");
        }
        for (const name of Object.keys(old.jobs ?? {})) if (!(name in (wf.jobs ?? {}))) errs.push("job " + name + " was removed");
        break;
      }
      case "2": {
        const ci = load(".github/workflows/ci.yml");
        if (!ci) { errs.push(".github/workflows/ci.yml missing"); break; }
        const push = branches(on(ci).push) ?? [];
        for (const b of ["stage", "main"]) if (!push.includes(b)) errs.push("ci.yml does not run on a push to " + b);
        if (!("pull_request" in on(ci))) errs.push("ci.yml does not run on pull requests");
        const pr = branches(on(ci).pull_request);
        if (pr && pr.length > 0 && !["stage", "main"].every((b) => pr.includes(b))) errs.push("ci.yml pull requests are limited to " + pr.join(", "));
        break;
      }
    }
    for (const e of errs) console.log(e);
  ' "$1" "$TMP/deploy-s114.yml"
}

flag() { # flag <check> <question>
  ask "$2" >"$TMP/ask.txt" 2>&1
  if [ -s "$TMP/ask.txt" ]; then
    while IFS= read -r line; do bad "$1" "$line"; done <"$TMP/ask.txt"
  fi
}

# --- Check 1: deploy.yml, stage deploys staging, main deploys production on its own ------------------
flag 1 1
# The workflow's own comment must not still promise an approval wait or staging on main.
grep -qiE "push to main deploys staging|Every push to main deploys staging|after staging" .github/workflows/deploy.yml &&
  bad 1 "deploy.yml's comments still say main deploys staging or production runs after staging"

# --- Check 2: CI on both branches; design-capture has no main ---------------------------------------
flag 2 2
grep -nwE "main" .github/workflows/design-capture.yml >"$TMP/dc.txt" 2>/dev/null
[ -s "$TMP/dc.txt" ] && { bad 2 "design-capture.yml mentions main:"; sed 's/^/        /' "$TMP/dc.txt"; }

# --- Check 3: rule text, agents work on stage and never push main ------------------------------------
OWNER_QUOTE="Instead of committing directly to main, we commit to stage"
for f in CLAUDE.md .claude/skills/run-stories/SKILL.md docs/v3/LOOP.md; do
  [ -f "$f" ] || { bad 3 "$f missing"; continue; }
  grep -qF "$OWNER_QUOTE" "$f" || bad 3 "$f does not quote the owner (\"$OWNER_QUOTE\")"
  grep -qE 'push(es)? `stage`|to `stage`' "$f" || bad 3 "$f does not say agents push to \`stage\`"
  grep -qE 'never (push|merge)[^.]*`main`' "$f" || bad 3 "$f does not say agents never push or merge into \`main\`"
done
grep -qF 'gh run list --branch stage --limit 1' CLAUDE.md || bad 3 "CLAUDE.md does not check GitHub Actions on stage (gh run list --branch stage --limit 1)"
grep -qiE 'release step' CLAUDE.md || bad 3 "CLAUDE.md does not say merging stage into main is the owner's release step"
grep -qiE 'deploys production' CLAUDE.md || bad 3 "CLAUDE.md does not say a push to main deploys production"
# No rule text anywhere tells an agent to push main or check Actions on main.
grep -rnE 'push `main` once|\), push `main`|--branch main|onto `main`|red `main`' CLAUDE.md .claude/ docs/v3/LOOP.md scripts/*.sh scripts/lib/ 2>/dev/null | grep -vE '^scripts/verify-S[0-9]+\.sh:' >"$TMP/main.txt"
[ -s "$TMP/main.txt" ] && { bad 3 "rule text still tells agents to work on main:"; sed 's/^/        /' "$TMP/main.txt"; }

# --- Check 4: README's deploy section ----------------------------------------------------------------
awk '/^## Deploying/{f=1;print;next} /^## /{f=0} f' README.md >"$TMP/deploy.md"
[ -s "$TMP/deploy.md" ] || bad 4 "README.md has no ## Deploying section"
for phrase in 'push to `stage`' 'push to `main`' 'merg' 'cherry-pick' 'AUDIT.md' 'CHANGELOG.md' 'default branch' 'required reviewers' 'deployment branches' 'stage.baseball.theater' 'baseball.theater'; do
  grep -qiF -- "$phrase" "$TMP/deploy.md" || bad 4 "README's deploy section does not mention \"$phrase\""
done
grep -qiE 'once the\s+owner approves|without that\s+approval|waits on the GitHub environment' "$TMP/deploy.md" &&
  bad 4 "README's deploy section still says production waits on an approval"
grep -qE 'Every push to `main` deploys `stage' "$TMP/deploy.md" && bad 4 "README still says a push to main deploys staging"

# --- Check 5: backlog Status is done -----------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S118\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 5 "S118 row in the Story status table is not \`done\`"
awk '/^### S118 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md >"$TMP/s118.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s118.md" || bad 5 "S118 story heading Status is not \`done\`"

# --- Check 6: the fence ------------------------------------------------------------------------------
story_changed_files S118 "$BASE" . |
  grep -vE '^(\.github/workflows/(deploy|ci|design-capture)\.yml$|README\.md$|CLAUDE\.md$|\.claude/skills/run-stories/SKILL\.md$|docs/v3/LOOP\.md$|docs/v3/BACKLOG\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S118\.sh$|docs/v3/\.obsidian/)' >"$TMP/out.txt"
[ -s "$TMP/out.txt" ] && { bad 6 "files changed outside the fence:"; sed 's/^/        /' "$TMP/out.txt"; }

report "verify-S118"
exit $?
