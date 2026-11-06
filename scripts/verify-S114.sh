#!/usr/bin/env bash
# Grader for BACKLOG story S114 — the Cloudflare deploy through GitHub Actions: a preview Worker
# per pull request and a staging Worker on every push to `main`, both on the `bt-staging`
# Hyperdrive config over the schema-only Neon `staging` branch, and production at
# baseball.theater behind the owner's approval. Every deploy migrates and re-applies deletions
# first, and every bootstrapping step (Neon branch, Hyperdrive config, Worker secrets) is found
# or created idempotently. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No Docker. Never deploys and never touches Cloudflare or Neon: the bootstrap is
# tested against fetch stand-ins and PGlite. No writes outside /tmp. Does its own checking.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "the deploy workflow runs pnpm verify and a wrangler --dry-run, then deploys a preview Worker per pull request on the bt-staging Hyperdrive config (never production) and posts its address (workflow; test 'S114 AC 1')"
check 2 "every push to main deploys the staging Worker to stage.baseball.theater on the Neon staging branch, after pnpm db:migrate (workflow, wrangler.jsonc env.staging)"
check 3 "production deploys only from main, to baseball.theater, in the GitHub environment 'production', after staging (workflow, wrangler.jsonc env.production)"
check 4 "the Cloudflare token and Neon key come from GitHub secrets; no credential is committed (grep)"
check 5 "every deploy runs pnpm db:migrate then pnpm db:reapply-deletions before wrangler deploy; Hyperdrive configs are found by name (bt-production, bt-staging) or created, with no real id in wrangler.jsonc; a second bootstrap creates nothing (test 'S114 AC 5')"
check 6 "README documents previews, staging, releasing, rolling back (wrangler rollback) and the launch checklist (legal check, support@baseball.theater, R2 ExportStore, Cloudflare Email Mailer)"
check 7 "the Worker wires the dev sign-in only when BT_LOCAL is \"1\" (workerd test 'S114 AC 7')"
check 8 "each deployed env has BT_USE_LIVE_MLB \"1\" and its own BT_APP_ORIGIN in vars, no BT_SESSION_KEY in vars; every deploy pushes every Worker secret from GitHub secrets (test 'S114 AC 8')"
check 9 "the staging branch is created schema-only from production, never a plain branch, and no deploy copies data (test 'S114 AC 9'; workflow grep)"
check 10 "backlog Status is done (story heading and Story status table)"
check 11 "the story changed nothing outside its fence (.github/workflows/, wrangler.jsonc, package.json, pnpm-lock.yaml, README.md, functions/, docs/v3/, CHANGELOG.md, scripts/verify-S114.sh)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BASE="051415f"
WORKFLOW=".github/workflows/deploy.yml"
BOOTSTRAP_TEST="src/deploy/bootstrap.test.ts"

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

# One parse of the workflow and wrangler.jsonc, then a named question per check. Prints the
# reasons a check fails, one per line; nothing when it holds.
ask() {
  node --input-type=module -e '
    import { readFileSync, existsSync } from "node:fs";
    import { parse } from "yaml";
    const [question, workflowPath] = process.argv.slice(1);
    const errs = [];
    const wf = existsSync(workflowPath) ? parse(readFileSync(workflowPath, "utf8")) : null;
    const wrangler = JSON.parse(readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, ""));
    const jobs = wf ? Object.entries(wf.jobs ?? {}) : [];
    const runs = (job) => (job.steps ?? []).map((s) => String(s.run ?? "") + " " + JSON.stringify(s.with ?? {}));
    const text = (job) => JSON.stringify(job);
    const deployIndex = (job) => runs(job).findIndex((r) => /wrangler deploy(?![^\n]*--dry-run)/.test(r));
    const deploys = (env) => jobs.filter(([, j]) => runs(j).some((r) => new RegExp("wrangler deploy(?![^\\n]*--dry-run)[^\\n]*--env " + env + "\\b").test(r)));
    const needs = (job) => [].concat(job.needs ?? []);
    const on = wf ? (wf.on ?? wf[true] ?? {}) : {};
    const env = (name) => (wrangler.env ?? {})[name];
    if (!wf) { console.log(workflowPath + " missing"); process.exit(0); }
    const verifyJob = jobs.find(([, j]) => runs(j).some((r) => /\bpnpm verify\b/.test(r)));
    switch (question) {
      case "1": {
        if (!on.pull_request) errs.push("the workflow does not run on pull_request");
        if (!verifyJob) errs.push("no job runs pnpm verify");
        if (!jobs.some(([, j]) => runs(j).some((r) => /wrangler deploy[^\n]*--dry-run/.test(r)))) errs.push("no job runs wrangler deploy --dry-run");
        const previews = deploys("preview");
        if (previews.length !== 1) errs.push("expected one job deploying --env preview, found " + previews.length);
        for (const [name, j] of previews) {
          if (verifyJob && !needs(j).includes(verifyJob[0])) errs.push(name + " does not need " + verifyJob[0]);
          if (!/pull_request/.test(String(j.if ?? ""))) errs.push(name + " is not limited to pull requests");
          if (/production/.test(text(j))) errs.push(name + " mentions production");
          if (!/gh pr comment|createComment|issues\/[^ ]*\/comments/.test(text(j))) errs.push(name + " does not post its address on the pull request");
        }
        const p = env("preview");
        if (!p) errs.push("wrangler.jsonc has no env.preview");
        else {
          if (!(p.triggers && Array.isArray(p.triggers.crons) && p.triggers.crons.length === 0)) errs.push("env.preview does not turn the cron off");
          if (p.workers_dev !== true) errs.push("env.preview is not on workers.dev");
        }
        break;
      }
      case "2": {
        const staging = deploys("staging");
        if (staging.length !== 1) errs.push("expected one job deploying --env staging, found " + staging.length);
        for (const [name, j] of staging) {
          if (!/refs\/heads\/main/.test(String(j.if ?? "")) || !/push/.test(String(j.if ?? ""))) errs.push(name + " does not run only on a push to main");
          const migrate = runs(j).findIndex((r) => /\bpnpm db:migrate\b/.test(r));
          if (migrate < 0 || migrate > deployIndex(j)) errs.push(name + " does not run pnpm db:migrate before wrangler deploy");
          if (!/bootstrap[^"]* staging|deploy:bootstrap staging/.test(text(j))) errs.push(name + " does not bootstrap the staging branch");
        }
        if (!on.push || ![].concat(on.push.branches ?? []).includes("main")) errs.push("the workflow does not run on push to main");
        const s = env("staging");
        if (!s) errs.push("wrangler.jsonc has no env.staging");
        else if (!(s.routes ?? []).some((r) => r.pattern === "stage.baseball.theater" && r.custom_domain === true)) errs.push("env.staging is not routed to the custom domain stage.baseball.theater");
        break;
      }
      case "3": {
        const prod = deploys("production");
        if (prod.length !== 1) errs.push("expected one job deploying --env production, found " + prod.length);
        for (const [name, j] of prod) {
          const environment = typeof j.environment === "string" ? j.environment : (j.environment ?? {}).name;
          if (environment !== "production") errs.push(name + " is not in the GitHub environment production");
          if (!/refs\/heads\/main/.test(String(j.if ?? "")) || !/push/.test(String(j.if ?? ""))) errs.push(name + " does not run only on a push to main");
          if (!needs(j).some((n) => deploys("staging").some(([s]) => s === n))) errs.push(name + " does not wait for the staging deploy");
        }
        for (const [name, j] of jobs) {
          if (/--env production/.test(text(j)) && !/--dry-run/.test(text(j)) && (typeof j.environment === "string" ? j.environment : (j.environment ?? {}).name) !== "production") errs.push(name + " touches production outside the production environment");
        }
        const p = env("production");
        if (!p) errs.push("wrangler.jsonc has no env.production");
        else if (!(p.routes ?? []).some((r) => r.pattern === "baseball.theater" && r.custom_domain === true)) errs.push("env.production is not routed to the custom domain baseball.theater");
        break;
      }
      case "4": {
        const all = JSON.stringify(wf);
        for (const s of ["CLOUDFLARE_API_TOKEN", "NEON_API_KEY"]) if (!all.includes("secrets." + s)) errs.push("the workflow does not read " + s + " from GitHub secrets");
        break;
      }
      case "5": {
        for (const e of ["preview", "staging", "production"]) {
          for (const [name, j] of deploys(e)) {
            const r = runs(j);
            const m = r.findIndex((x) => /\bpnpm db:migrate\b/.test(x));
            const d = r.findIndex((x) => /\bpnpm db:reapply-deletions\b/.test(x));
            const w = deployIndex(j);
            if (m < 0 || d < 0 || !(m < d && d < w)) errs.push(name + " does not run pnpm db:migrate, then pnpm db:reapply-deletions, then wrangler deploy");
            if (!/deploy:bootstrap|deploy-bootstrap/.test(text(j))) errs.push(name + " does not run the bootstrap (find or create the branch and Hyperdrive config)");
          }
        }
        for (const e of ["preview", "staging", "production"]) {
          const hd = ((env(e) ?? {}).hyperdrive ?? []).find((h) => h.binding === "HYPERDRIVE");
          if (!hd) errs.push("env." + e + " has no HYPERDRIVE binding");
          else if (!/^0+$/.test(hd.id)) errs.push("env." + e + " pastes a Hyperdrive id (" + hd.id + ") instead of resolving it at deploy time");
        }
        break;
      }
      case "8": {
        const origins = { preview: null, staging: "https://stage.baseball.theater", production: "https://baseball.theater" };
        for (const [e, origin] of Object.entries(origins)) {
          const v = (env(e) ?? {}).vars ?? {};
          if (v.BT_USE_LIVE_MLB !== "1") errs.push("env." + e + " vars do not set BT_USE_LIVE_MLB to \"1\"");
          if (origin && v.BT_APP_ORIGIN !== origin) errs.push("env." + e + " BT_APP_ORIGIN is " + v.BT_APP_ORIGIN + ", not " + origin);
          if ("BT_SESSION_KEY" in v) errs.push("env." + e + " puts BT_SESSION_KEY in vars");
          if ("BT_LOCAL" in v) errs.push("env." + e + " sets BT_LOCAL");
          const durable = (((env(e) ?? {}).durable_objects ?? {}).bindings ?? []).map((b) => b.name).sort().join(",");
          if (durable !== "GAME_HUB,GAME_INGEST") errs.push("env." + e + " does not restate the Durable Object bindings");
        }
        if ("BT_SESSION_KEY" in (wrangler.vars ?? {})) errs.push("top-level vars carry BT_SESSION_KEY");
        for (const e of ["preview", "staging", "production"]) {
          for (const [name, j] of deploys(e)) {
            const r = runs(j)[deployIndex(j)] ?? "";
            if (!/--secrets-file/.test(r)) errs.push(name + " does not push the Worker secrets with its deploy (--secrets-file)");
            if (!/secrets\.BT_SESSION_KEY_[A-Z]+/.test(text(j))) errs.push(name + " does not take BT_SESSION_KEY from a GitHub secret");
          }
        }
        break;
      }
      case "9": {
        if (/pg_dump|pg_restore|db:copy|init_source[^a-z]*parent-data/.test(JSON.stringify(wf))) errs.push("the deploy workflow copies data");
        break;
      }
    }
    for (const e of errs) console.log(e);
  ' "$1" "$WORKFLOW"
}

flag() { # flag <check> <question>
  ask "$2" >"$TMP/ask.txt" 2>&1
  if [ -s "$TMP/ask.txt" ]; then
    while IFS= read -r line; do bad "$1" "$line"; done <"$TMP/ask.txt"
  fi
}

# --- Check 1: preview per pull request ---------------------------------------------------------------
flag 1 1
run_vitest 1 functions "$BOOTSTRAP_TEST" "" -t "S114 AC 1"

# --- Check 2: staging on every push to main -----------------------------------------------------------
flag 2 2

# --- Check 3: production behind approval --------------------------------------------------------------
flag 3 3

# --- Check 4: secrets from GitHub, none committed -----------------------------------------------------
flag 4 4
git ls-files -co --exclude-standard -- ':!docs/**' ':!fixtures/**' ':!pnpm-lock.yaml' ':!scripts/verify-S114.sh' |
  xargs grep -nIE "(CLOUDFLARE_API_TOKEN|NEON_API_KEY|BT_SESSION_KEY[A-Z_]*)[\"']?[:=] *[\"']?[A-Za-z0-9_-]{20,}|napi_[a-z0-9]{40,}" 2>/dev/null >"$TMP/creds.txt"
[ -s "$TMP/creds.txt" ] && { bad 4 "a credential looks committed:"; sed 's/^/        /' "$TMP/creds.txt"; }

# --- Check 5: migrate, re-apply deletions, Hyperdrive by name, idempotent ---------------------------------
flag 5 5
grep -qF '"bt-production"' functions/src/deploy/bootstrap.ts 2>/dev/null || bad 5 "functions/src/deploy/bootstrap.ts does not name the bt-production config"
grep -qF '"bt-staging"' functions/src/deploy/bootstrap.ts 2>/dev/null || bad 5 "functions/src/deploy/bootstrap.ts does not name the bt-staging config"
grep -qF 'db27b03ce9734c3f928241ce8ee855f6' wrangler.jsonc && bad 5 "wrangler.jsonc still pastes bt-production's id"
node -e 'process.exit(/deploy-bootstrap\.ts/.test(require("./package.json").scripts["deploy:bootstrap"] ?? "") ? 0 : 1)' ||
  bad 5 "package.json has no deploy:bootstrap script running functions/src/scripts/deploy-bootstrap.ts"
run_vitest 5 functions "$BOOTSTRAP_TEST" "" -t "S114 AC 5"

# --- Check 6: README -----------------------------------------------------------------------------------
for phrase in "pull request" "stage.baseball.theater" "wrangler rollback" "production" "approv" "support@baseball.theater" "ExportStore" "Mailer" "R2" "Cloudflare Email" "legal" "bt-staging" "BT_SESSION_KEY_STAGING" "BT_SESSION_KEY_PRODUCTION"; do
  grep -qF -- "$phrase" README.md || bad 6 "README.md does not mention \"$phrase\""
done
grep -qiE 'launch checklist' README.md || bad 6 "README.md has no launch checklist"
grep -qF 'Put the id it prints in `wrangler.jsonc`' README.md && bad 6 "README.md still says to paste the Hyperdrive id into wrangler.jsonc"

# --- Check 7: dev sign-in only locally --------------------------------------------------------------------
grep -qE 'BT_LOCAL === "1"' functions/src/worker-app.ts || bad 7 "functions/src/worker-app.ts does not gate the dev provider on BT_LOCAL"
run_vitest 7 functions src/worker.workerd.test.ts "--config vitest.workers.config.ts" -t "S114 AC 7"

# --- Check 8: vars and Worker secrets ---------------------------------------------------------------------
flag 8 8
run_vitest 8 functions "$BOOTSTRAP_TEST" "" -t "S114 AC 8"

# --- Check 9: staging never holds a fan's data ------------------------------------------------------------
flag 9 9
grep -qF 'schema-only' functions/src/deploy/bootstrap.ts 2>/dev/null || bad 9 "functions/src/deploy/bootstrap.ts does not create the staging branch schema-only"
run_vitest 9 functions "$BOOTSTRAP_TEST" "" -t "S114 AC 9"

# --- Check 10: backlog Status is done ---------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S114\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 10 "S114 row in the Story status table is not \`done\`"
awk '/^### S114 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s114.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s114.md" || bad 10 "S114 story heading Status is not \`done\`"

# --- Check 11: the fence ----------------------------------------------------------------------------------
story_changed_files S114 "$BASE" . |
  grep -vE '^(\.github/workflows/|wrangler\.jsonc$|package\.json$|pnpm-lock\.yaml$|README\.md$|functions/|docs/v3/BACKLOG\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S114\.sh$|docs/v3/\.obsidian/)' >"$TMP/out.txt"
[ -s "$TMP/out.txt" ] && { bad 11 "files changed outside the fence:"; sed 's/^/        /' "$TMP/out.txt"; }

report "verify-S114"
exit $?
