#!/usr/bin/env bash
# Grader for BACKLOG story S4 — Standings: the committed 2026-09-05 recording, served by
# GET /api/v1/standings?date= (route table, spec), and the Standings page as the ratified
# frames draw it — division tables (team swatch + name, abbreviation, W, L, PCT, GB with "—"
# for the leader) under divisionName headings, one column at every pairing, and the generic
# loading / empty / error states. A commit-time proof of this story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp. Does its own checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "fixtures/standings-2026-09-05.json exists and is valid JSON; fixtures/standings-2024-07-04.json does not exist"
check 2 "the fixture has >=2 divisions, each with a name or id and a teams list; each team has a name string and numeric wins and losses"
check 3 "GET /api/v1/standings?date=2026-09-05 returns 200 with >=2 divisions of such records (functions test); the route is in the route table with its response type"
check 4 "a web test renders StandingsPage and finds a team name from the fixture"
check 5 "that web test file exits 0 run alone through pnpm --filter @bt/web exec vitest run"
check 6 "the standings UI files have no <img, mlbstatic or /logos/"
check 7 "the standings UI files call no useMediaQuery / hiddenFrom / visibleFrom"
check 8 "each division table shows TeamSwatch, name, abbreviation, W, L, PCT and GB with — for the leader; headings from divisionName (RTL: AL East)"
check 9 "loading, empty and error use ViewState (a test per state)"
check 10 "design match: e2e/design/S4.spec.ts names standings-mobile/-medium/-desktop; docs/v3/design-checks/S4/ holds them at 390 / 768 / 1200"
check 11 "backlog Status is done (story heading and Story status table)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FX="fixtures/standings-2026-09-05.json"
WT="src/pages/StandingsPage.test.tsx"
UI_FILES="web/src/pages/StandingsPage.tsx $(ls web/src/components/standings/*.tsx 2>/dev/null | grep -v '\.test\.' | tr '\n' ' ')"

run_vitest() {
  local id="$1" dir="$2" file="$3"
  shift 3
  if [ ! -f "$dir/$file" ]; then
    bad "$id" "$dir/$file missing"
  elif ! (cd "$dir" && pnpm exec vitest run "$file" "$@" --reporter=json --outputFile="$TMP/r.json" >"$TMP/r.log" 2>&1); then
    bad "$id" "$dir/$file $* failed:"; tail -15 "$TMP/r.log" | sed 's/^/        /'
  elif ! node -e 'process.exit(require(process.argv[1]).numPassedTests > 0 ? 0 : 1)' "$TMP/r.json"; then
    bad "$id" "$dir/$file $* ran no passing test"
  fi
}

png_width() {
  node -e 'const b=require("fs").readFileSync(process.argv[1]);process.stdout.write(String(b.readUInt32BE(16)))' "$1"
}

# --- Check 1: the recording -----------------------------------------------------------------------
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$FX" 2>/dev/null || bad 1 "$FX is missing or not valid JSON"
[ -e fixtures/standings-2024-07-04.json ] && bad 1 "fixtures/standings-2024-07-04.json exists (must not be fabricated)"

# --- Check 2: its shape ---------------------------------------------------------------------------
node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const errs = [];
  if (!Array.isArray(s.divisions) || s.divisions.length < 2) errs.push("fewer than 2 divisions");
  for (const d of s.divisions ?? []) {
    if (d.name == null && d.divisionId == null) errs.push("a division has neither name nor id");
    if (!Array.isArray(d.teams) || d.teams.length === 0) { errs.push("division " + d.divisionId + " has no teams"); continue; }
    for (const t of d.teams) {
      if (typeof (t.name ?? t.teamName) !== "string") errs.push("a team in " + d.divisionId + " has no name");
      if (typeof t.wins !== "number" || typeof t.losses !== "number") errs.push((t.name ?? "?") + " lacks numeric wins/losses");
    }
  }
  if (errs.length) { console.log(errs.slice(0, 5).join("; ")); process.exit(1); }
' "$FX" >"$TMP/fx.log" 2>&1 || bad 2 "$FX: $(cat "$TMP/fx.log")"

# --- Check 3: the route -----------------------------------------------------------------------------
grep -qE '"GET /api/v1/standings": "StandingsResponse"' packages/domain/src/api-routes.ts || bad 3 "ApiRoutes has no GET /api/v1/standings → StandingsResponse"
grep -qF 'route: "GET /api/v1/standings"' functions/src/handlers/api.ts || bad 3 "the API router does not dispatch GET /api/v1/standings"
grep -qF '"/api/v1/standings"' openapi/bt-api.v1.json || bad 3 "openapi/bt-api.v1.json has no /api/v1/standings path"
grep -qF '"/api/v1/standings"' web/src/api/client.ts || bad 3 "web/src/api/client.ts does not call /api/v1/standings"
run_vitest 3 functions src/handlers/api.test.ts -t "standings"
run_vitest 3 functions src/handlers/route-table.test.ts

# --- Check 4 / 5: the page names a fixture team; the file passes alone -------------------------------
grep -qE 'StandingsPage' "web/$WT" 2>/dev/null || bad 4 "web/$WT does not render StandingsPage"
grep -qF 'New York Yankees' "web/$WT" 2>/dev/null || bad 4 "web/$WT asserts no team name from the fixture (New York Yankees)"
run_vitest 4 web "$WT" -t "names"
if [ -f "web/$WT" ]; then
  pnpm --filter @bt/web exec vitest run "$WT" >"$TMP/alone.log" 2>&1 || { bad 5 "web/$WT fails run alone:"; tail -10 "$TMP/alone.log" | sed 's/^/        /'; }
else
  bad 5 "web/$WT missing"
fi

# --- Check 6 / 7: no logos, no viewport ----------------------------------------------------------------
for f in $UI_FILES; do
  [ -f "$f" ] || { bad 6 "$f missing"; continue; }
  grep -nE '<img|mlbstatic|/logos/' "$f" >/dev/null && bad 6 "$f has an <img, mlbstatic or /logos/ reference"
  grep -nwE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" >/dev/null && bad 7 "$f reads the viewport"
done

# --- Check 8: the tables ------------------------------------------------------------------------------
cat $UI_FILES 2>/dev/null > "$TMP/ui.tsx"
grep -qw 'TeamSwatch' "$TMP/ui.tsx" || bad 8 "the standings UI does not use TeamSwatch"
grep -qw 'divisionName' "$TMP/ui.tsx" || bad 8 "the standings UI does not head tables with divisionName"
run_vitest 8 web "$WT" -t "table"
run_vitest 8 web "$WT" -t "leader"

# --- Check 9: the states --------------------------------------------------------------------------------
grep -qw 'ViewState' "$TMP/ui.tsx" || bad 9 "the standings UI does not use ViewState"
for state in loading empty error; do
  run_vitest 9 web "$WT" -t "$state"
done

# --- Check 10: design match captures ---------------------------------------------------------------------
S="e2e/design/S4.spec.ts"
for fw in standings-mobile:390 standings-medium:768 standings-desktop:1200; do
  name="${fw%%:*}"; w="${fw##*:}"; png="docs/v3/design-checks/S4/$name.png"
  grep -qF "\"$name\"" "$S" 2>/dev/null || bad 10 "$S does not name $name"
  if [ -f "$png" ]; then
    [ "$(png_width "$png")" = "$w" ] || bad 10 "$png is $(png_width "$png")px wide, want $w"
  else
    bad 10 "$png missing"
  fi
done

# --- Check 11: backlog Status is done ----------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S4\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 11 "S4 row in the Story status table is not \`done\`"
awk '/^### S4 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s4.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s4.md" || bad 11 "S4 story heading Status is not \`done\`"

report "verify-S4"
exit $?
