#!/usr/bin/env bash
# Grader for BACKLOG story S115 — design captures on request in GitHub Actions.
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "a workflow on workflow_dispatch with a required 'story' input installs, installs Playwright's Chromium, runs pnpm design:capture on exactly e2e/design/<story>.spec.ts (the app started as pnpm dev does) and uploads docs/v3/design-checks/<story>/ as an artifact"
check 2 "an optional boolean 'commit' input, default false, gates the only step that commits (only the story's captures) and pushes; only the job that may commit has contents: write"
check 3 "the run fails when the story's spec is missing (checked before capturing) or saves no capture (checked after, and the upload errors on no files)"
check 4 "law P8 holds (pnpm verify takes no captures and runs no browser) and the workflow runs no pnpm verify, wrangler deploy or other deploy"
check 5 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The workflow that runs design:capture on workflow_dispatch.
WF=""
for f in .github/workflows/*.yml; do
	grep -q 'design:capture' "$f" && grep -q 'workflow_dispatch' "$f" && WF="$f"
done
if [ -z "$WF" ]; then
	bad 1 "no workflow under .github/workflows/ runs design:capture on workflow_dispatch"
	bad 2 "no workflow, so no commit input"
	bad 3 "no workflow, so no failure checks"
else
	node -e '
	const fs = require("fs"); const { parse } = require("yaml");
	const wf = parse(fs.readFileSync(process.argv[1], "utf8"));
	const on = wf.on ?? wf[true];
	const inputs = on?.workflow_dispatch?.inputs ?? {};
	const jobs = Object.entries(wf.jobs ?? {}).map(([name, j]) => ({ name, perms: j.permissions ?? wf.permissions ?? null,
		steps: (j.steps ?? []).map((s) => ({ name: s.name ?? "", uses: s.uses ?? "", run: String(s.run ?? ""), if: String(s.if ?? ""), with: s.with ?? {} })) }));
	fs.writeFileSync(process.argv[2], JSON.stringify({ inputs, jobs, top: wf.permissions ?? null }));
	' "$WF" "$TMP/wf.json" 2> "$TMP/yaml.log" || {
		bad 1 "$WF does not parse:"
		sed 's/^/        /' "$TMP/yaml.log"
	}
	q() { node -e "const w=require('$TMP/wf.json');const steps=w.jobs.flatMap(j=>j.steps);$1" 2> /dev/null; }

	# --- Check 1 ----------------------------------------------------------------------------------
	q 'process.exit(w.inputs.story?.required===true?0:1)' || bad 1 "the 'story' input is missing or not required"
	q 'process.exit(steps.some(s=>/pnpm install --frozen-lockfile/.test(s.run))?0:1)' || bad 1 "no install step"
	q 'process.exit(steps.some(s=>/playwright install --with-deps chromium/.test(s.run))?0:1)' || bad 1 "no Playwright Chromium install"
	q 'process.exit(steps.some(s=>/pnpm design:capture[^\n]*e2e\/design\/[^\n]*\.spec\.ts/.test(s.run))?0:1)' ||
		bad 1 "no step runs pnpm design:capture on e2e/design/<story>.spec.ts (a bare ID also matches other specs)"
	q 'process.exit(steps.some(s=>/actions\/upload-artifact/.test(s.uses)&&/docs\/v3\/design-checks\//.test(String(s.with.path??"")))?0:1)' ||
		bad 1 "no upload-artifact step for docs/v3/design-checks/<story>/"
	grep -q 'webServer' e2e/playwright.config.ts && grep -qE 'command: "pnpm dev"' e2e/playwright.config.ts ||
		bad 1 "the Playwright config no longer starts the app with pnpm dev"
	q 'process.exit(steps.some(s=>/\^S\[0-9\]\+\$/.test(s.run))?0:1)' || bad 1 "the story input is not checked to be S<N> before use"

	# --- Check 2 ----------------------------------------------------------------------------------
	q 'const c=w.inputs.commit;process.exit(c&&c.type==="boolean"&&c.default===false&&!c.required?0:1)' ||
		bad 2 "no optional boolean 'commit' input defaulting to false"
	q 'const p=steps.filter(s=>/git (commit|push)/.test(s.run));process.exit(p.length&&p.every(s=>/inputs\.commit/.test(s.if))?0:1)' ||
		bad 2 "a step commits or pushes without being gated on inputs.commit"
	q 'const p=steps.filter(s=>/git add/.test(s.run));process.exit(p.length&&p.every(s=>/git add[^\n]*docs\/v3\/design-checks\//.test(s.run)&&!/git add (-A|\.|--all)/.test(s.run))?0:1)' ||
		bad 2 "the commit step adds more than the story's captures"
	q 'process.exit(String(w.top?.contents??"read")!=="write"&&w.jobs.filter(j=>j.perms?.contents==="write").every(j=>j.steps.some(s=>/git push/.test(s.run)))?0:1)' ||
		bad 2 "contents: write is granted beyond the one job that may commit"

	# --- Check 3 ----------------------------------------------------------------------------------
	q 'const i=steps.findIndex(s=>/design:capture/.test(s.run));const t=steps.findIndex(s=>/test -f[^\n]*e2e\/design\//.test(s.run));process.exit(t>=0&&t<i?0:1)' ||
		bad 3 "no check that e2e/design/<story>.spec.ts exists, before capturing"
	q 'const i=steps.findIndex(s=>/design:capture/.test(s.run));const t=steps.findIndex((s,k)=>k>i&&/\.png/.test(s.run)&&/exit 1|test /.test(s.run));process.exit(i>=0&&t>i?0:1)' ||
		bad 3 "no check after capturing that the spec saved a capture"
	q 'process.exit(steps.some(s=>/upload-artifact/.test(s.uses)&&s.with["if-no-files-found"]==="error")?0:1)' ||
		bad 3 "the upload does not fail on no files"

	# --- Check 4 (workflow side) --------------------------------------------------------------------
	q 'process.exit(steps.some(s=>/pnpm verify|wrangler deploy|deploy/.test(s.run))?1:0)' || bad 4 "the workflow runs pnpm verify or a deploy"
fi

# --- Check 4: law P8 ------------------------------------------------------------------------------------
V=$(node -p 'require("./package.json").scripts.verify')
echo "$V" | grep -qE 'playwright|design:capture|e2e' && bad 4 "pnpm verify runs a browser or captures: $V"

# --- Check 5 ---------------------------------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S115\].*\| `done` \|' docs/v3/BACKLOG.md ||
	bad 5 "S115 row in the Story status table is not \`done\`"
awk '/^### S115 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md |
	grep -qE '^\*\*Status:\*\* `done`$' || bad 5 "S115 story heading Status is not \`done\`"

report "verify-S115"
exit $?
