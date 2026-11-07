#!/usr/bin/env bash
# Grader for BACKLOG story S116 — sign in with Logto (email one-time code) on the deployed sites:
# a Logto IdentityProvider that verifies ID tokens against the tenant's JWKS, a sign-in route that
# trades one for BT's own session, the web AuthClient hand-off (fresh sign-in every time, Logto's
# browser keys through web/src/storage/), a Logto IdentityAdmin over the Management API wired only
# where production's machine-to-machine secret is set, and production-only Logto config and deploy
# steps (staging on its own tenant, previews with no sign-in). A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network: every Logto call in the tests goes to a fetch stand-in with a locally made key.
# Never deploys. No writes outside /tmp. Does its own checking (story-scoped Vitest files only).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "a Logto IdentityProvider under functions/src/adapters/ checks the ID token against <endpoint>/oidc/jwks, issuer <endpoint>/oidc, audience the app ID and expiry, returns { provider: \"logto\", subject, email, emailVerified }, and refuses a bad signature, issuer, audience, expired token or missing email (tests 'S116 AC 1')"
check 2 "the Worker offers Logto where LOGTO_ENDPOINT and LOGTO_APP_ID are in vars and the dev provider only under BT_LOCAL; a sign-in route in the API route table (and openapi/bt-api.v1.json, up to date with pnpm api:spec) trades a Logto ID token for BT's session token, and a dev: token is refused (workerd test 'S116 AC 2')"
check 3 "web: only the AuthClient imports Logto's browser SDK; deployed signIn() goes to Logto with the email scope and prompt login, a callback hands the ID token to BT once, signOut() ends both sessions, local dev sign-in unchanged; Logto's browser keys go through web/src/storage/ (labeled personal) and are gone after sign-out and deletion; bt/no-browser-storage disabled nowhere (RTL tests 'S116 AC 3'; grep)"
check 4 "a Logto IdentityAdmin lists, suspends (PATCH /api/users/{id}/is-suspended) and deletes (DELETE /api/users/{id}) through the Management API with machine-to-machine credentials; deletion reaches it; the Worker composes it only where the secret is set, and deleting without it still succeeds (tests 'S116 AC 4')"
check 5 "LOGTO_ENDPOINT/LOGTO_APP_ID are per-env vars, production's (https://auth.baseball.theater, b2f2q1wau5axo1psqexdo) only in env.production and the production job; previews and their jobs carry no Logto value; staging reads no machine-to-machine secret; the production job alone pushes LOGTO_S2S_APP_ID/LOGTO_S2S_SECRET and sets the redirect and sign-out URIs from BT_APP_ORIGIN idempotently (test 'S116 AC 5' runs it twice); README documents the manual Logto setup"
check 6 "backlog Status is done (story heading and Story status table)"
check 7 "the story changed nothing outside its fence (.github/workflows/, functions/, web/, packages/domain/src/, packages/domain/vitest.config.ts, wrangler.jsonc, package.json, pnpm-lock.yaml, README.md, openapi/bt-api.v1.json, docs/v3/BACKLOG.md, docs/v3/backlog/, docs/v3/AUDIT.md, CHANGELOG.md, scripts/verify-S116.sh)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BASE="f9da099"  # HEAD when S116 started; the story's work comes after it
WORKFLOW=".github/workflows/deploy.yml"
PROD_ENDPOINT="https://auth.baseball.theater"
PROD_APP_ID="b2f2q1wau5axo1psqexdo"

# run_tagged <check> <package dir> <vitest config args> <tag> — runs every test file under the package's
# src/ that names <tag>, filtered to the tests carrying it; fails when none exists or none passes.
run_tagged() {
  local id="$1" dir="$2" config="$3" tag="$4" files
  if [ -n "$config" ]; then
    files="$(cd "$dir" && grep -rlF --include='*.workerd.test.ts' -- "$tag" src 2>/dev/null)"
  else
    files="$(cd "$dir" && grep -rlF --include='*.test.ts' --include='*.test.tsx' -- "$tag" src 2>/dev/null | grep -v '\.workerd\.test\.ts$')"
  fi
  if [ -z "$files" ]; then
    bad "$id" "no test in $dir/src names '$tag'"
    return
  fi
  # shellcheck disable=SC2086
  if ! (cd "$dir" && pnpm exec vitest run $config $files -t "$tag" --reporter=json --outputFile="$TMP/r.json" >"$TMP/r.log" 2>&1); then
    bad "$id" "$dir '$tag' failed:"; tail -15 "$TMP/r.log" | sed 's/^/        /'
  elif ! node -e 'const r = require(process.argv[1]); process.exit(r.numPassedTests > 0 && r.numFailedTests === 0 ? 0 : 1)' "$TMP/r.json"; then
    bad "$id" "$dir '$tag' ran no passing test"
  fi
}

# --- Check 1: the Logto IdentityProvider ---------------------------------------------------------------
ADAPTERS="$(grep -rlE 'implements IdentityProvider' functions/src/adapters 2>/dev/null | grep -i logto)"
if [ -z "$ADAPTERS" ]; then
  bad 1 "no Logto IdentityProvider under functions/src/adapters/"
else
  grep -qF '/oidc/jwks' $ADAPTERS || bad 1 "the Logto provider does not read <endpoint>/oidc/jwks"
  grep -qF '"logto"' $ADAPTERS || bad 1 "the Logto provider does not name its provider \"logto\""
  grep -qE 'email_verified' $ADAPTERS || bad 1 "the Logto provider does not read email_verified"
fi
run_tagged 1 functions "" "S116 AC 1"

# --- Check 2: the Worker's providers and the sign-in route ------------------------------------------------
grep -qE 'LOGTO_ENDPOINT' functions/src/worker-app.ts && grep -qE 'LOGTO_APP_ID' functions/src/worker-app.ts ||
  bad 2 "functions/src/worker-app.ts does not compose the Logto provider from LOGTO_ENDPOINT and LOGTO_APP_ID"
grep -qE 'BT_LOCAL === "1"' functions/src/worker-app.ts || bad 2 "the dev provider is no longer gated on BT_LOCAL"
node -e '
  const spec = require("./openapi/bt-api.v1.json");
  const hit = Object.entries(spec.paths ?? {}).some(([p, ops]) => /sign-?in|session/i.test(p) && ops.post);
  process.exit(hit ? 0 : 1);
' || bad 2 "openapi/bt-api.v1.json lists no POST sign-in route"
if ! (cd functions && pnpm exec tsx src/scripts/generate-openapi.ts --check >"$TMP/spec.log" 2>&1); then
  bad 2 "openapi/bt-api.v1.json is stale (pnpm api:spec):"; tail -5 "$TMP/spec.log" | sed 's/^/        /'
fi
run_tagged 2 functions "--config vitest.workers.config.ts" "S116 AC 2"

# --- Check 3: the web hand-off ------------------------------------------------------------------------------
grep -rlE "from \"@logto/|from '@logto/|import\(\"@logto/" web/src --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v '\.test\.tsx\?$' >"$TMP/sdk.txt"
if [ ! -s "$TMP/sdk.txt" ]; then
  bad 3 "nothing in web/src imports Logto's browser SDK"
elif [ "$(wc -l <"$TMP/sdk.txt")" -ne 1 ] || ! grep -qE '/AuthClient\.tsx?$' "$TMP/sdk.txt"; then
  bad 3 "Logto's SDK is imported outside the AuthClient:"; sed 's/^/        /' "$TMP/sdk.txt"
else
  grep -qE 'prompt[^\n]*login|Prompt\.Login' "$(cat "$TMP/sdk.txt")" || bad 3 "the AuthClient does not ask Logto for prompt=login"
fi
grep -qiE '"?logto[^"]*"?:' web/src/storage/storage.ts || bad 3 "STORAGE_KEYS lists no Logto key in web/src/storage/storage.ts"
grep -rnE 'eslint-disable[^\n]*no-browser-storage' web/src functions/src eslint.config.js 2>/dev/null >"$TMP/disable.txt"
[ -s "$TMP/disable.txt" ] && { bad 3 "bt/no-browser-storage is disabled:"; sed 's/^/        /' "$TMP/disable.txt"; }
run_tagged 3 web "" "S116 AC 3"

# --- Check 4: the Logto IdentityAdmin -----------------------------------------------------------------------
ADMINS="$(grep -rlE 'implements IdentityAdmin' functions/src/adapters 2>/dev/null | grep -i logto)"
if [ -z "$ADMINS" ]; then
  bad 4 "no Logto IdentityAdmin under functions/src/adapters/"
else
  grep -qF 'is-suspended' $ADMINS || bad 4 "the Logto admin does not suspend through /api/users/{id}/is-suspended"
  grep -qF '/api/users' $ADMINS || bad 4 "the Logto admin does not call /api/users"
  grep -qE 'client_credentials' $ADMINS || bad 4 "the Logto admin does not get a token with the client-credentials grant"
fi
grep -qE 'LOGTO_S2S_SECRET' functions/src/worker-app.ts || bad 4 "functions/src/worker-app.ts does not compose the Logto admin from LOGTO_S2S_SECRET"
run_tagged 4 functions "" "S116 AC 4"

# --- Check 5: per-env config, production-only deploy steps, README ----------------------------------------
node --input-type=module -e '
  import { readFileSync, existsSync } from "node:fs";
  import { parse } from "yaml";
  const [workflowPath, prodEndpoint, prodAppId] = process.argv.slice(1);
  const errs = [];
  const wrangler = JSON.parse(readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, ""));
  const env = (n) => (wrangler.env ?? {})[n] ?? {};
  const logtoVars = (v) => Object.keys(v ?? {}).filter((k) => /^LOGTO/i.test(k));
  const prod = env("production").vars ?? {};
  if (prod.LOGTO_ENDPOINT !== prodEndpoint) errs.push("env.production LOGTO_ENDPOINT is " + prod.LOGTO_ENDPOINT + ", not " + prodEndpoint);
  if (prod.LOGTO_APP_ID !== prodAppId) errs.push("env.production LOGTO_APP_ID is " + prod.LOGTO_APP_ID + ", not " + prodAppId);
  if (logtoVars(wrangler.vars).length) errs.push("top-level vars name Logto: " + logtoVars(wrangler.vars).join(", "));
  if (logtoVars(env("preview").vars).length) errs.push("env.preview names Logto vars: " + logtoVars(env("preview").vars).join(", "));
  const staging = env("staging").vars ?? {};
  if (staging.LOGTO_ENDPOINT === prodEndpoint || staging.LOGTO_APP_ID === prodAppId) errs.push("env.staging uses production'"'"'s Logto tenant or app");
  for (const k of Object.keys(prod).filter((k) => /S2S|SECRET/i.test(k))) errs.push("env.production puts " + k + " in vars");
  for (const [name, block] of Object.entries(wrangler.env ?? {})) {
    if (name === "production") continue;
    const text = JSON.stringify(block);
    if (text.includes(prodEndpoint) || text.includes(prodAppId)) errs.push("env." + name + " carries production'"'"'s Logto values");
  }
  if (!existsSync(workflowPath)) { errs.push(workflowPath + " missing"); }
  else {
    const wf = parse(readFileSync(workflowPath, "utf8"));
    const jobs = wf.jobs ?? {};
    const text = (j) => JSON.stringify(j ?? {});
    for (const name of ["preview", "preview-teardown"]) {
      if (/logto/i.test(text(jobs[name]))) errs.push("the " + name + " job reads a Logto value");
    }
    if (/LOGTO_S2S|logto[^"]*secret/i.test(text(jobs.staging))) errs.push("the staging job reads a machine-to-machine secret");
    for (const [name, j] of Object.entries(jobs)) {
      if (name === "production") continue;
      if (text(j).includes(prodEndpoint) || text(j).includes(prodAppId)) errs.push("the " + name + " job carries production'"'"'s Logto values");
      if (/secrets\.LOGTO_S2S/.test(text(j))) errs.push("the " + name + " job reads secrets.LOGTO_S2S_*");
      if ((j.steps ?? []).some((s) => /logto/i.test(String(s.run ?? "")))) errs.push("the " + name + " job runs a Logto step");
    }
    const p = jobs.production;
    if (!p) errs.push("no production job");
    else {
      for (const s of ["LOGTO_S2S_APP_ID", "LOGTO_S2S_SECRET"]) if (!text(p).includes("secrets." + s)) errs.push("the production job does not read secrets." + s);
      const steps = (p.steps ?? []).map((s) => String(s.run ?? ""));
      if (!steps.some((r) => /logto/i.test(r))) errs.push("the production job runs no Logto step (redirect and sign-out URIs)");
    }
  }
  for (const e of errs) console.log(e);
' "$WORKFLOW" "$PROD_ENDPOINT" "$PROD_APP_ID" >"$TMP/ask.txt" 2>&1
[ -s "$TMP/ask.txt" ] && while IFS= read -r line; do bad 5 "$line"; done <"$TMP/ask.txt"
grep -qE 'LOGTO_S2S_SECRET' functions/src/deploy/bootstrap.ts 2>/dev/null || bad 5 "functions/src/deploy/bootstrap.ts does not push LOGTO_S2S_SECRET as a Worker secret"
# Production's values live only in env.production (and README, which documents them).
git ls-files -co --exclude-standard -- functions web .github package.json |
  xargs grep -lIF -e "$PROD_APP_ID" 2>/dev/null | grep -vE '\.test\.tsx?$' >"$TMP/appid.txt"
[ -s "$TMP/appid.txt" ] && { bad 5 "production's Logto app ID is copied outside wrangler.jsonc:"; sed 's/^/        /' "$TMP/appid.txt"; }
git ls-files -co --exclude-standard -- ':!docs/**' ':!pnpm-lock.yaml' ':!scripts/verify-S116.sh' |
  xargs grep -nIE "LOGTO_S2S_SECRET[\"']?[:=] *[\"']?[A-Za-z0-9_-]{16,}" 2>/dev/null >"$TMP/creds.txt"
[ -s "$TMP/creds.txt" ] && { bad 5 "a Logto secret looks committed:"; sed 's/^/        /' "$TMP/creds.txt"; }
for phrase in "auth.baseball.theater" "LOGTO_S2S_APP_ID" "LOGTO_S2S_SECRET" "machine-to-machine" "Management API" "one-time code" "staging tenant" "redirect" "sign-out" "single-page"; do
  grep -qiF -- "$phrase" README.md || bad 5 "README.md does not mention \"$phrase\""
done
run_tagged 5 functions "" "S116 AC 5"

# --- Check 6: backlog Status is done ------------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S116\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 6 "S116 row in the Story status table is not \`done\`"
awk '/^### S116 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md >"$TMP/s116.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s116.md" || bad 6 "S116 story heading Status is not \`done\`"

# --- Check 7: the fence -------------------------------------------------------------------------------------
story_changed_files S116 "$BASE" . |
  grep -vE '^(\.github/workflows/|functions/|web/|packages/domain/src/|packages/domain/vitest\.config\.ts$|wrangler\.jsonc$|package\.json$|pnpm-lock\.yaml$|README\.md$|openapi/bt-api\.v1\.json$|docs/v3/BACKLOG\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S116\.sh$|docs/v3/\.obsidian/)' >"$TMP/out.txt"
[ -s "$TMP/out.txt" ] && { bad 7 "files changed outside the fence:"; sed 's/^/        /' "$TMP/out.txt"; }

report "verify-S116"
exit $?
