#!/usr/bin/env bash
# Grader for BACKLOG story S120 — sign-in hardening after GitHub Copilot's review of S116's Logto
# sign-in (owner, 2026-11-07: "Fix all the things you think should be fixed that you control").
# A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network: the story's named Vitest tests sign tokens with a locally made key and stub fetch.
# Runs one Vitest process per package (functions, web) filtered to "S120 AC", then checks that
# each AC's named tests passed in each file it names. No writes outside /tmp.

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "recent sign-in comes from the provider's auth_time: Logto adapter reads auth_time, dev provider stamps now, signIn carries it into the BT session, deleteAccount checks it (not issuedAt), AuthClient asks max_age=0; re-exchanging a token with an old or missing auth_time can't delete (tests 'S120 AC 1')"
check 2 "settings follow the signed-in account: a uid change resets and re-hydrates, and responses for the previous account are discarded (tests 'S120 AC 2' in web/src/settings/)"
check 3 "JWKS refetch for an unknown key id at most once per cooldown, refused without a fetch during it, concurrent sign-ins share one fetch (test 'S120 AC 3')"
check 4 "POST /api/v1/sign-in answers 401 only for a refused credential and 503 sign_in_failed for any other failure; the spec lists the 503 (test 'S120 AC 4'; spec)"
check 5 "Logto's keys and bt.signInReturnTo live in per-tab sessionStorage through web/src/storage/, labeled personal, cleared by clearPersonalData; bt/no-browser-storage not disabled (tests 'S120 AC 5'; grep)"
check 6 "a session load for a replaced token neither sets state nor clears the newer token (test 'S120 AC 6')"
check 7 "backlog Status is done (story heading and Story status table)"
check 8 "the story changed nothing outside its fence (functions/, web/, packages/domain/src/, packages/domain/vitest.config.ts, packages/ports/src/, openapi/bt-api.v1.json, docs/v3/BACKLOG.md, docs/v3/backlog/, docs/v3/AUDIT.md, docs/v3/audit.jsonl, docs/v3/INDEX.md, CHANGELOG.md, scripts/verify-S120.sh)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BASE="394d003"  # the commit that added S120's note; the story's work starts after it

# One Vitest run per package, filtered to this story's tests; the JSON report is read per AC below.
run_pkg() {
  local pkg="$1"
  shift
  local files=()
  for f in "$@"; do [ -e "$pkg/$f" ] && files+=("$f"); done
  if [ ${#files[@]} -eq 0 ]; then
    echo '{"testResults":[]}' >"$TMP/$pkg.json"
    return
  fi
  (cd "$pkg" && pnpm exec vitest run "${files[@]}" -t "S120 AC" --reporter=json --outputFile="$TMP/$pkg.json" >"$TMP/$pkg.log" 2>&1) || true
  [ -s "$TMP/$pkg.json" ] || echo '{"testResults":[]}' >"$TMP/$pkg.json"
}
run_pkg functions src/adapters/logto/identity.test.ts src/services/account-deletion.test.ts src/worker-app.test.ts
run_pkg web src/session/AuthClient.test.ts src/session/SessionProvider.test.tsx src/storage/storage.test.ts src/settings

# expect_tests <check> <pkg> <AC n> <file-or-dir>… — every named file has a passing test titled "S120 AC n", and none failed.
expect_tests() {
  local id="$1" pkg="$2" ac="$3"
  shift 3
  node -e '
    const [report, pkg, ac, ...paths] = process.argv.slice(1);
    const r = require(report);
    const tag = "S120 AC " + ac + ":";
    const errs = [];
    for (const p of paths) {
      const results = r.testResults.filter((t) => t.name.includes("/" + pkg + "/" + p));
      const tests = results.flatMap((t) => t.assertionResults).filter((a) => a.fullName.includes(tag));
      if (!tests.some((a) => a.status === "passed")) errs.push(pkg + "/" + p + ": no passing test titled \"" + tag + "\"");
      for (const a of tests.filter((a) => a.status === "failed")) errs.push(pkg + "/" + p + ": failed: " + a.fullName);
    }
    for (const e of errs) console.log(e);
  ' "$TMP/$pkg.json" "$pkg" "$ac" "$@" >"$TMP/t.txt" 2>&1
  if [ -s "$TMP/t.txt" ]; then
    while IFS= read -r line; do bad "$id" "$line"; done <"$TMP/t.txt"
  fi
}

# --- Check 1: recent sign-in from the provider's auth_time --------------------------------------------
expect_tests 1 functions 1 src/adapters/logto/identity.test.ts src/services/account-deletion.test.ts src/worker-app.test.ts
expect_tests 1 web 1 src/session/AuthClient.test.ts
grep -q 'issuedAt' functions/src/services/account-deletion.ts && bad 1 "functions/src/services/account-deletion.ts still reads issuedAt"
grep -q 'auth_time' functions/src/adapters/logto/identity.ts || bad 1 "the Logto adapter doesn't read auth_time"
grep -qE 'authTime\??:' packages/ports/src/auth.ts || bad 1 "IdentityClaims has no authTime"
awk '/^export type BtSession = \{/{f=1} f&&/^\};/{f=0} f' packages/domain/src/types.ts | grep -qE 'authTime\??:' || bad 1 "BtSession has no authTime"
grep -qE 'max_age' web/src/session/AuthClient.ts || bad 1 "the AuthClient doesn't ask Logto for max_age"

# --- Check 2: settings follow the signed-in account ---------------------------------------------------
expect_tests 2 web 2 src/settings/

# --- Check 3: JWKS cooldown and one in-flight fetch ---------------------------------------------------
expect_tests 3 functions 3 src/adapters/logto/identity.test.ts

# --- Check 4: 401 only for a refused credential, 503 otherwise; the spec lists the 503 ---------------
expect_tests 4 functions 4 src/worker-app.test.ts
node -e '
  const spec = require(process.argv[1]);
  const r = spec.paths?.["/api/v1/sign-in"]?.post?.responses ?? {};
  if (!r["503"]) console.log("openapi/bt-api.v1.json lists no 503 for POST /api/v1/sign-in");
  else if (!String(r["503"].description).includes("sign_in_failed")) console.log("the 503 for POST /api/v1/sign-in does not name sign_in_failed");
' "$PWD/openapi/bt-api.v1.json" >"$TMP/c4.txt" 2>&1
[ -s "$TMP/c4.txt" ] && while IFS= read -r line; do bad 4 "$line"; done <"$TMP/c4.txt"
grep -q 'sign_in_failed' functions/src/handlers/api.ts || bad 4 "functions/src/handlers/api.ts never answers sign_in_failed"

# --- Check 5: per-tab sign-in state -------------------------------------------------------------------
expect_tests 5 web 5 src/storage/storage.test.ts src/session/SessionProvider.test.tsx
grep -rnE 'eslint-disable[^\n]*no-browser-storage' web/src functions/src packages 2>/dev/null >"$TMP/c5.txt"
[ -s "$TMP/c5.txt" ] && { bad 5 "bt/no-browser-storage is disabled:"; sed 's/^/        /' "$TMP/c5.txt"; }
grep -qE '"bt/no-browser-storage": "error"' eslint.config.js || bad 5 "eslint.config.js no longer makes bt/no-browser-storage an error"
grep -q 'sessionStorage' web/src/storage/storage.ts || bad 5 "web/src/storage/storage.ts never uses sessionStorage"

# --- Check 6: no stale session loads ------------------------------------------------------------------
expect_tests 6 web 6 src/session/SessionProvider.test.tsx

# --- Check 7: backlog Status is done ------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S120\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 7 "S120 row in the Story status table is not \`done\`"
awk '/^### S120 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md >"$TMP/s120.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s120.md" || bad 7 "S120 story heading Status is not \`done\`"

# --- Check 8: the fence -------------------------------------------------------------------------------
story_changed_files S120 "$BASE" . |
  grep -vE '^(functions/|web/|packages/domain/src/|packages/domain/vitest\.config\.ts$|packages/ports/src/|openapi/bt-api\.v1\.json$|docs/v3/BACKLOG\.md$|docs/v3/backlog/|docs/v3/AUDIT\.md$|docs/v3/audit\.jsonl$|docs/v3/INDEX\.md$|CHANGELOG\.md$|scripts/verify-S120\.sh$|docs/v3/\.obsidian/)' >"$TMP/out.txt"
[ -s "$TMP/out.txt" ] && { bad 8 "files changed outside the fence:"; sed 's/^/        /' "$TMP/out.txt"; }

report "verify-S120"
exit $?
