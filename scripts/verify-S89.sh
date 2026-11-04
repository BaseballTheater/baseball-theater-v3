#!/usr/bin/env bash
# Grader for BACKLOG story S89 — faster CI: parallel jobs, the flows on several workers, the
# design captures out of `pnpm e2e` (but still run in CI), Lighthouse alone on its runner.
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "ci.yml runs pnpm verify (with the API spec checks), the flows and Lighthouse as separate jobs that start together; the Lighthouse job runs nothing else"
check 2 "pnpm e2e runs only e2e/flows/ and the harness; pnpm design:capture still takes captures; a CI job of its own runs every e2e/design/ spec without BT_DESIGN_CAPTURE"
check 3 "the flows run on more than one worker, and CI runs them with --repeat-each=2; no flow is serial or shares module state"
check 4 "Lighthouse waits on the server's ready line (startServerReadyPattern), not a timeout"
check 5 "law P11: the vault test reading ci.yml finds a step running pnpm verify (scripts/backlog-vault/ci-law.test.ts passes)"
check 6 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The jobs of ci.yml as JSON: name -> { needs, runs: [run lines], env }.
node -e '
const fs = require("fs"); const { parse } = require("yaml");
const ci = parse(fs.readFileSync(".github/workflows/ci.yml", "utf8"));
const out = {};
for (const [name, job] of Object.entries(ci.jobs ?? {})) {
	const steps = job.steps ?? [];
	out[name] = {
		needs: [].concat(job.needs ?? []),
		runs: steps.filter((s) => s.run).map((s) => String(s.run).trim()),
		env: JSON.stringify([job.env ?? {}, ...steps.map((s) => s.env ?? {})]),
	};
}
fs.writeFileSync(process.argv[1], JSON.stringify(out));
' "$TMP/jobs.json" 2> "$TMP/yaml.log" || {
	bad 1 "ci.yml does not parse:"
	sed 's/^/        /' "$TMP/yaml.log"
}
job_with() { node -e 'const j=require(process.argv[1]);const re=new RegExp(process.argv[2]);for(const [n,v] of Object.entries(j))if(v.runs.some(r=>re.test(r))){console.log(n);}' "$TMP/jobs.json" "$1" 2> /dev/null; }

# --- Check 1: separate jobs that start together -------------------------------------------------
VERIFY=$(job_with '^pnpm verify$' | head -1)
FLOWS=$(job_with '^pnpm e2e( |$)' | head -1)
LH=$(job_with '^pnpm lighthouse$' | head -1)
DESIGN=$(job_with '^pnpm e2e:design( |$)' | head -1)
[ -n "$VERIFY" ] || bad 1 "no job runs pnpm verify"
[ -n "$FLOWS" ] || bad 1 "no job runs pnpm e2e"
[ -n "$LH" ] || bad 1 "no job runs pnpm lighthouse"
if [ -n "$VERIFY" ] && [ -n "$FLOWS" ] && [ -n "$LH" ]; then
	[ "$(printf '%s\n' "$VERIFY" "$FLOWS" "$LH" | sort -u | wc -l)" = 3 ] || bad 1 "verify, flows and Lighthouse share a job"
	for j in "$VERIFY" "$FLOWS" "$LH" $DESIGN; do
		node -e 'const j=require(process.argv[1])[process.argv[2]];process.exit(j.needs.length?1:0)' "$TMP/jobs.json" "$j" ||
			bad 1 "job $j waits on another job (needs:), so it doesn't start with the others"
	done
	for c in 'pnpm api:spec --check' 'pnpm api:breaking'; do
		node -e 'const j=require(process.argv[1])[process.argv[2]];process.exit(j.runs.includes(process.argv[3])?0:1)' "$TMP/jobs.json" "$VERIFY" "$c" ||
			bad 1 "the verify job does not run '$c'"
	done
	# Lighthouse alone: besides setup, its job runs only the install, the web build it serves and lighthouse.
	node -e '
	const j = require(process.argv[1])[process.argv[2]];
	const other = j.runs.filter((r) => !/^pnpm (install|lighthouse$|build$|--filter @bt\/web run build$)/.test(r));
	if (other.length) { console.log(other.join(" | ")); process.exit(1); }' "$TMP/jobs.json" "$LH" > "$TMP/lh.log" ||
		bad 1 "the Lighthouse job also runs: $(cat "$TMP/lh.log")"
fi

# --- Check 2: e2e runs the flows; the design specs run in their own job -----------------------------
E2E=$(node -p 'require("./package.json").scripts.e2e ?? ""')
CAP=$(node -p 'require("./package.json").scripts["design:capture"] ?? ""')
ED=$(node -p 'require("./package.json").scripts["e2e:design"] ?? ""')
echo "$E2E" | grep -q 'flows' || bad 2 "pnpm e2e does not name e2e/flows/: $E2E"
echo "$E2E" | grep -qE '(^|[ /])design([ /]|$)' && ! echo "$E2E" | grep -qE 'design/harness' && bad 2 "pnpm e2e still runs e2e/design/: $E2E"
echo "$CAP" | grep -q 'BT_DESIGN_CAPTURE=1' || bad 2 "pnpm design:capture no longer sets BT_DESIGN_CAPTURE: $CAP"
[ -n "$ED" ] || bad 2 "no pnpm e2e:design script"
echo "$ED" | grep -q 'BT_DESIGN_CAPTURE' && bad 2 "pnpm e2e:design sets BT_DESIGN_CAPTURE (it would write captures): $ED"
echo "$ED" | grep -q 'design' || bad 2 "pnpm e2e:design does not name e2e/design/: $ED"
[ -n "$DESIGN" ] || bad 2 "no CI job runs pnpm e2e:design"
[ -n "$DESIGN" ] && [ "$DESIGN" = "$FLOWS" ] && bad 2 "the design specs run in the flows job, not one of their own"
[ -n "$DESIGN" ] && grep -q 'BT_DESIGN_CAPTURE' <<< "$(node -p 'require(process.argv[1])[process.argv[2]].env' "$TMP/jobs.json" "$DESIGN")" &&
	bad 2 "the design-spec job sets BT_DESIGN_CAPTURE"

# --- Check 3: workers and independence ------------------------------------------------------------
w=$(echo "$E2E" | grep -oE -- '--workers[= ]+[0-9]+' | grep -oE '[0-9]+$')
[ -n "$w" ] && [ "$w" -gt 1 ] || bad 3 "pnpm e2e does not run the flows on more than one worker: $E2E"
[ -n "$FLOWS" ] && ! node -e 'const j=require(process.argv[1])[process.argv[2]];process.exit(j.runs.some(r=>/^pnpm e2e .*--repeat-each[= ]2/.test(r))?0:1)' "$TMP/jobs.json" "$FLOWS" &&
	bad 3 "CI does not run the flows with --repeat-each=2"
grep -nE 'describe\.(serial|configure)|mode: *"serial"' e2e/flows/*.ts && bad 3 "a flow runs serially"
grep -nE '^(let|var) ' e2e/flows/*.ts && bad 3 "a flow keeps module-level mutable state"

# --- Check 4: Lighthouse waits on the ready line --------------------------------------------------
node -e 'const c=require("./lighthouserc.json").ci.collect;process.exit(c.startServerReadyPattern?0:1)' ||
	bad 4 "lighthouserc.json has no startServerReadyPattern"

# --- Check 5: law P11 -------------------------------------------------------------------------------
pnpm exec vitest run --config scripts/backlog-vault/vitest.config.ts ci-law > "$TMP/p11.log" 2>&1 || {
	bad 5 "scripts/backlog-vault/ci-law.test.ts fails:"
	tail -10 "$TMP/p11.log" | sed 's/^/        /'
}

# --- Check 6: backlog Status is done ------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S89\].*\| `done` \|' docs/v3/BACKLOG.md ||
	bad 6 "S89 row in the Story status table is not \`done\`"
awk '/^### S89 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md |
	grep -qE '^\*\*Status:\*\* `done`$' || bad 6 "S89 story heading Status is not \`done\`"

report "verify-S89"
exit $?
