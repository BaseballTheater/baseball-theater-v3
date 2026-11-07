#!/usr/bin/env bash
# Grader for BACKLOG story S121 — the release flow: production deploys only when a GitHub Release is
# published (exactly its tag, with S118–S120's production steps unchanged), `main` is fast-forwarded
# to the released commit afterwards so it mirrors production, release notes come from merged pull
# requests (.github/release.yml), every story lands as its own auto-merged pull request into `stage`,
# and README names the GitHub settings the owner sets. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. Never deploys. Reads the workflow at HEAD (or the working tree) and as it was before
# the story (BASE), so "unchanged" is a parse-and-compare, not a guess. No writes outside /tmp.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "deploy.yml: production deploys only on a published release, checking out the release's tag, with the production steps unchanged in order; no push to main deploys; staging on a push to stage and previews unchanged"
check 2 "deploy.yml: after the production job, a job fast-forwards main to the released commit (never forced, failing loudly otherwise) with contents: write on that job only; README names the main ruleset's bypass for GitHub Actions"
check 3 ".github/release.yml configures generated release notes; README's release section: publish a release targeting stage with a v* tag, notes list its pull requests, and how to roll back"
check 4 "CLAUDE.md, the run-stories skill and LOOP.md: each story is a story/S<N> branch and pull request into stage with auto-merge; agents never push directly to stage or main, never merge into main, never publish releases; run-stories pushes once and opens one pull request per story; each quotes the owner; no rule text says to push to stage"
check 5 "README documents the owner's GitHub settings: Allow auto-merge, a stage ruleset requiring a pull request and ci-passed, GitHub Actions bypassing the main ruleset, production's deployment rules allowing v* tags"
check 6 "backlog Status is done (story heading and Story status table)"
check 7 "the story changed nothing outside its fence (.github/workflows/, .github/release.yml, CLAUDE.md, the run-stories skill, docs/v3/LOOP.md, README.md, functions/, docs/v3/BACKLOG.md, docs/v3/backlog/, docs/v3/AUDIT.md, docs/v3/audit.jsonl, docs/v3/INDEX.md, CHANGELOG.md, scripts/verify-S121.sh)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BASE="b3f4d05"  # the commit that added S121's note; the story's work starts after it
git show "$BASE:.github/workflows/deploy.yml" >"$TMP/deploy-before.yml"

# One parse of the workflow, then a named question. Prints the reasons a check fails, one per line;
# nothing when it holds.
ask() {
  node --input-type=module -e '
    import { readFileSync, existsSync } from "node:fs";
    import { parse } from "yaml";
    const [question, beforePath] = process.argv.slice(1);
    const load = (p) => (existsSync(p) ? parse(readFileSync(p, "utf8")) : null);
    const errs = [];
    const on = (wf) => (wf ? (wf.on ?? wf[true] ?? {}) : {});
    const runs = (job) => (job.steps ?? []).map((s) => String(s.run ?? ""));
    const deploys = (jobs, env) => jobs.filter(([, j]) => runs(j).some((r) => new RegExp("wrangler deploy(?![^\\n]*--dry-run)[^\\n]*--env " + env + "\\b").test(r)));
    const needs = (job) => [].concat(job.needs ?? []);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const isCheckout = (s) => /^actions\/checkout@/.test(String(s.uses ?? ""));
    const wf = load(".github/workflows/deploy.yml");
    const old = load(beforePath);
    if (!wf) { console.log(".github/workflows/deploy.yml missing"); process.exit(0); }
    const jobs = Object.entries(wf.jobs ?? {});
    const prod = deploys(jobs, "production");
    switch (question) {
      case "1": {
        const release = on(wf).release;
        if (!release || !same([].concat(release.types ?? []), ["published"])) errs.push("deploy.yml does not run on release: types: [published]");
        const pushBranches = [].concat(on(wf).push?.branches ?? []);
        if (!same(pushBranches, ["stage"])) errs.push("deploy.yml push branches are [" + pushBranches.join(", ") + "], expected [stage] only");
        if (on(wf).push?.tags) errs.push("deploy.yml also runs on pushed tags; production deploys on a published release only");
        if (!same(on(wf).pull_request, on(old).pull_request)) errs.push("deploy.yml pull_request trigger changed");
        if (prod.length !== 1) errs.push("expected one job deploying --env production, found " + prod.length);
        for (const [name, j] of prod) {
          const cond = String(j.if ?? "");
          if (!/github\.event_name\s*==\s*.release./.test(cond)) errs.push(name + " does not run only on a release event (if: " + cond + ")");
          if (!/published/.test(cond)) errs.push(name + " does not require the release to be published (if: " + cond + ")");
          if (/refs\/heads\/main|refs\/heads\/stage|event_name\s*==\s*.push./.test(cond)) errs.push(name + " still runs on a branch push");
          const steps = j.steps ?? [];
          const co = steps.find(isCheckout);
          if (!co || !/github\.event\.release\.tag_name/.test(String(co.with?.ref ?? ""))) errs.push(name + " does not check out the release tag (actions/checkout with ref: ${{ github.event.release.tag_name }})");
          const was = (old.jobs ?? {}).production;
          if (!was) { errs.push("no production job before the story"); break; }
          const body = (ss) => ss.filter((s) => !isCheckout(s));
          if (!same(body(steps), body(was.steps ?? []))) errs.push(name + " steps changed from before the story (bootstrap, migrate, reapply-deletions, wrangler deploy, deploy:logto must stay as they were, in order)");
          for (const k of ["env", "environment", "needs", "concurrency", "runs-on", "timeout-minutes"]) if (!same(j[k], was[k])) errs.push(name + " " + k + " changed from before the story");
          const order = ["deploy:bootstrap production", "db:migrate", "db:reapply-deletions", "--env production", "deploy:logto production"];
          const idx = order.map((o) => runs(j).findIndex((r) => r.includes(o)));
          if (idx.some((i) => i < 0) || idx.some((i, k) => k > 0 && i <= idx[k - 1])) errs.push(name + " does not run bootstrap → migrate → reapply-deletions → wrangler deploy → deploy:logto in that order");
        }
        for (const n of ["verify", "preview", "preview-teardown", "staging"]) {
          if (!same((wf.jobs ?? {})[n], (old.jobs ?? {})[n])) errs.push("job " + n + " changed from before the story");
        }
        if (/!=\s*.closed./.test(String(wf.jobs?.verify?.if ?? "")) === false) errs.push("verify job no longer runs on every non-closing event (a release must run it)");
        break;
      }
      case "2": {
        const prodName = prod[0]?.[0];
        const mirrors = jobs.filter(([, j]) => runs(j).some((r) => /git push/.test(r)));
        if (mirrors.length !== 1) { errs.push("expected one job that pushes main, found " + mirrors.length); break; }
        const [name, j] = mirrors[0];
        if (!prodName || !needs(j).includes(prodName)) errs.push(name + " does not need the production job (" + needs(j).join(", ") + ")");
        if (String(j.permissions?.contents ?? "") !== "write") errs.push(name + " does not ask for contents: write");
        if (String(wf.permissions?.contents ?? "") === "write") errs.push("the workflow grants contents: write to every job; only the mirror job may");
        for (const [n, other] of jobs) if (n !== name && String(other.permissions?.contents ?? "") === "write") errs.push(n + " also has contents: write");
        if (!/release/.test(String(j.if ?? "")) && !(prodName && needs(j).includes(prodName))) errs.push(name + " is not tied to the release");
        const all = runs(j).join("\n");
        if (!/merge-base --is-ancestor/.test(all)) errs.push(name + " does not check that main is an ancestor of the released commit (git merge-base --is-ancestor)");
        if (!/git push[^\n]*refs\/heads\/main/.test(all)) errs.push(name + " does not push the released commit to refs/heads/main");
        if (!/exit 1/.test(all) || !/::error/.test(all)) errs.push(name + " does not fail loudly (::error and exit 1) when main cannot fast-forward");
        const co = (j.steps ?? []).find(isCheckout);
        if (!co || !/github\.event\.release\.tag_name/.test(String(co.with?.ref ?? ""))) errs.push(name + " does not check out the release tag");
        if (!co || String(co.with?.["fetch-depth"] ?? "") !== "0") errs.push(name + " does not fetch full history (fetch-depth: 0) for the ancestry check");
        for (const [n, jj] of jobs) for (const r of runs(jj)) {
          if (/git push[^\n]*(--force|\s-f\b|\s\+[^\s]*:)/.test(r)) errs.push(n + " force-pushes: " + r.split("\n").find((l) => /git push/.test(l)));
        }
        break;
      }
    }
    for (const e of errs) console.log(e);
  ' "$1" "$TMP/deploy-before.yml"
}

flag() { # flag <check> <question>
  ask "$2" >"$TMP/ask.txt" 2>&1
  if [ -s "$TMP/ask.txt" ]; then
    while IFS= read -r line; do bad "$1" "$line"; done <"$TMP/ask.txt"
  fi
}

awk '/^## Deploying/{f=1;print;next} /^## /{f=0} f' README.md >"$TMP/deploy.md"
[ -s "$TMP/deploy.md" ] || bad 1 "README.md has no ## Deploying section"

# --- Check 1: production on a published release only -------------------------------------------------
flag 1 1
grep -qiE 'Every push to main deploys production|push to `?main`? deploys production' .github/workflows/deploy.yml &&
  bad 1 "deploy.yml's comments still say a push to main deploys production"

# --- Check 2: main mirrors production by fast-forward -------------------------------------------------
flag 2 2
grep -qiE 'bypass' "$TMP/deploy.md" && grep -qF 'GitHub Actions' "$TMP/deploy.md" ||
  bad 2 "README's deploy section does not name GitHub Actions in the main ruleset's bypass list"

# --- Check 3: release notes from pull requests, release section ---------------------------------------
if [ -f .github/release.yml ]; then
  node --input-type=module -e '
    import { readFileSync } from "node:fs"; import { parse } from "yaml";
    const c = parse(readFileSync(".github/release.yml", "utf8"));
    if (!c || typeof c.changelog !== "object" || c.changelog === null) console.log("no changelog: key");
  ' >"$TMP/rel.txt" 2>&1
  [ -s "$TMP/rel.txt" ] && bad 3 ".github/release.yml: $(cat "$TMP/rel.txt")"
else
  bad 3 ".github/release.yml missing"
fi
for phrase in 'Generate release notes' 'pull request' 'v*' 'target' 'Re-run' 'roll'; do
  grep -qiF -- "$phrase" "$TMP/deploy.md" || bad 3 "README's deploy section does not mention \"$phrase\""
done
grep -qiE 'publish(es|ing)? a (GitHub )?release' "$TMP/deploy.md" || bad 3 "README's deploy section does not say releasing is publishing a GitHub Release"
grep -qiE 'merg(e|es|ing) `stage` into `main`' "$TMP/deploy.md" && ! grep -qiE 'no longer|not by merging|instead of merging' "$TMP/deploy.md" &&
  bad 3 "README's deploy section still says releasing is merging stage into main"

# --- Check 4: story flow rule text ---------------------------------------------------------------------
OWNER_QUOTE="I want a release to be a set of PRs basically"
for f in CLAUDE.md .claude/skills/run-stories/SKILL.md docs/v3/LOOP.md; do
  [ -f "$f" ] || { bad 4 "$f missing"; continue; }
  grep -qF "$OWNER_QUOTE" "$f" || bad 4 "$f does not quote the owner (\"$OWNER_QUOTE\")"
  grep -qF 'story/S<N>' "$f" || bad 4 "$f does not name the story/S<N> branch"
  grep -qE 'auto-merge' "$f" || bad 4 "$f does not say the pull request merges by auto-merge"
  grep -qE 'never push(es)? directly to `stage` or `main`' "$f" || bad 4 "$f does not say agents never push directly to \`stage\` or \`main\`"
  grep -qE 'never merge[^.]*`main`' "$f" || bad 4 "$f does not say agents never merge into \`main\`"
  grep -qiE 'never publish(es)? (a )?releases?' "$f" || bad 4 "$f does not say agents never publish releases"
done
grep -qF 'gh pr merge --auto' CLAUDE.md || bad 4 "CLAUDE.md does not give the auto-merge command (gh pr merge --auto)"
grep -qF '1. You automatically 2. Mirror' CLAUDE.md || bad 4 "CLAUDE.md does not quote the owner's answer (\"1. You automatically 2. Mirror\")"
grep -qiE 'one pull request (per|for each) story|a pull request (per|for each) story' .claude/skills/run-stories/SKILL.md ||
  bad 4 "the run-stories skill does not say a run opens one pull request per story"
grep -qiE 'once, (at the end|for the whole run)' .claude/skills/run-stories/SKILL.md || bad 4 "the run-stories skill no longer pushes once at the end of a run"
grep -rnE 'push(es)? to `stage`|push `stage`|and push to `?stage' CLAUDE.md .claude/ docs/v3/LOOP.md 2>/dev/null | grep -vE 'never push(es)? directly to `stage`' >"$TMP/stage.txt"
[ -s "$TMP/stage.txt" ] && { bad 4 "rule text still tells agents to push to stage:"; sed 's/^/        /' "$TMP/stage.txt"; }

# --- Check 5: the owner's GitHub settings ---------------------------------------------------------------
for phrase in 'Allow auto-merge' 'ruleset' 'ci-passed' 'require' 'bypass' 'GitHub Actions' 'v*' 'deployment' 'tag'; do
  grep -qiF -- "$phrase" "$TMP/deploy.md" || bad 5 "README's deploy section does not mention \"$phrase\""
done
grep -qiE 'limited to `main`|branches limited to main' README.md && bad 5 "README still limits production's deployments to main (a release run's ref is its tag)"
grep -qiE 'A push to `main` deploys production' README.md && bad 5 "README still says a push to main deploys production"

# --- Check 6: backlog Status is done -------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S121\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 6 "S121 row in the Story status table is not \`done\`"
awk '/^### S121 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md >"$TMP/s121.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s121.md" || bad 6 "S121 story heading Status is not \`done\`"

# --- Check 7: the fence --------------------------------------------------------------------------------
story_changed_files S121 "$BASE" . |
  grep -vE '^(\.github/workflows/|\.github/release\.yml$|CLAUDE\.md$|\.claude/skills/run-stories/SKILL\.md$|docs/v3/LOOP\.md$|README\.md$|functions/|docs/v3/BACKLOG\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S121\.sh$|docs/v3/\.obsidian/)' >"$TMP/out.txt"
[ -s "$TMP/out.txt" ] && { bad 7 "files changed outside the fence:"; sed 's/^/        /' "$TMP/out.txt"; }

report "verify-S121"
exit $?
