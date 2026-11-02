#!/usr/bin/env bash
# Grader for BACKLOG story S73 — Baseball Theater installs as an app (ADR-023): a web app
# manifest (standalone, flag-mark icons at 192 and 512, #10100F), a service worker at scope
# `/` precaching the shell and never `/api/`, the update notice when a new worker waits, the
# Install app row in Settings (and the iPhone/iPad Share steps), safe-area insets in
# standalone mode, the size budget and Playwright flows intact. A commit-time proof of this
# story (S84).
# Contract: docs/v3/BACKLOG.md#verify-script-contract
# No network. No writes outside /tmp (the web build goes to a temp dir). Does its own
# checking (never `pnpm verify`).

set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/checks.sh
source "$(dirname "$0")/lib/checks.sh"

check 1 "the built manifest.webmanifest: display standalone, theme_color #10100F, flag-mark icons at 192 and 512 that exist in the build"
check 2 "the service worker registers at scope / and precaches the shell, never /api/ (config test + the built sw.js)"
check 3 "a waiting worker shows the NoticeBanner 'An update to Baseball Theater is ready.' with Reload and ✕; Reload activates it and reloads (mocked registration)"
check 4 "Settings shows the Install app row only after beforeinstallprompt and never installed; iPhone/iPad Safari shows the Share steps, never installed (tests)"
check 5 "standalone mode applies the S55 safe-area insets (CSS test); sw.js and index.html are served to revalidate (_headers test)"
check 6 "the entry chunk stays inside the 200 KB budget; a Playwright flow covers the update notice and the flows pass"
check 7 "files this story adds or edits reference no team logo and read no viewport outside web/src/layout/"
check 8 "design match: e2e/design/S73.spec.ts names its 7 frames; docs/v3/design-checks/S73/ holds them at their widths"
check 9 "backlog Status is done (story heading and Story status table)"

BASE=928a798
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

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

# --- Build once, into a temp dir ------------------------------------------------------------------
BUILT=0
if (cd web && pnpm exec vite build --outDir "$TMP/dist" --emptyOutDir >"$TMP/build.log" 2>&1); then
  BUILT=1
else
  bad 1 "vite build failed:"; tail -10 "$TMP/build.log" | sed 's/^/        /'
fi

# --- Check 1: the manifest ------------------------------------------------------------------------
if [ "$BUILT" = 1 ]; then
  node -e '
    const fs = require("fs"), path = require("path");
    const dist = process.argv[1], file = path.join(dist, "manifest.webmanifest");
    if (!fs.existsSync(file)) { console.log("no manifest.webmanifest in the build"); process.exit(1); }
    const m = JSON.parse(fs.readFileSync(file, "utf8")), errs = [];
    if (m.display !== "standalone") errs.push("display is " + m.display);
    if (String(m.theme_color).toUpperCase() !== "#10100F") errs.push("theme_color is " + m.theme_color);
    for (const size of ["192x192", "512x512"]) {
      const icon = (m.icons || []).find((i) => String(i.sizes).split(" ").includes(size));
      if (!icon) { errs.push("no " + size + " icon"); continue; }
      if (!/flag|icon/i.test(icon.src)) errs.push(size + " icon " + icon.src + " is not the flag mark");
      if (!fs.existsSync(path.join(dist, icon.src.replace(/^\//, "")))) errs.push(size + " icon " + icon.src + " is missing from the build");
    }
    if (errs.length) { console.log(errs.join("; ")); process.exit(1); }
  ' "$TMP/dist" >"$TMP/m.log" 2>&1 || bad 1 "$(cat "$TMP/m.log")"
  grep -q 'manifest.webmanifest' "$TMP/dist/index.html" || bad 1 "the built index.html does not link the manifest"
fi

# --- Check 2: the worker ---------------------------------------------------------------------------
run_vitest 2 web src/pwa/pwa.test.ts -t "scope"
run_vitest 2 web src/pwa/pwa.test.ts -t "precache"
if [ "$BUILT" = 1 ]; then
  if [ ! -f "$TMP/dist/sw.js" ]; then
    bad 2 "the build has no sw.js"
  else
    grep -q 'index.html' "$TMP/dist/sw.js" || bad 2 "sw.js does not precache index.html"
    grep -oE 'url:"[^"]*"' "$TMP/dist/sw.js" | grep -qE 'url:"/?api/' && bad 2 "sw.js precaches an /api/ response"
  fi
fi

# --- Check 3: the update notice --------------------------------------------------------------------
grep -rqF 'An update to Baseball Theater is ready.' web/src --include='*.tsx' --include='*.ts' || bad 3 "web/src has no 'An update to Baseball Theater is ready.'"
run_vitest 3 web src/pwa/UpdateNotice.test.tsx -t "update notice"
run_vitest 3 web src/pwa/UpdateNotice.test.tsx -t "Reload"

# --- Check 4: the Install app row ------------------------------------------------------------------
run_vitest 4 web src/pages/settings/InstallApp.test.tsx -t "install row"
run_vitest 4 web src/pages/settings/InstallApp.test.tsx -t "iOS"
run_vitest 4 web src/pages/settings/InstallApp.test.tsx -t "installed"

# --- Check 5: safe areas; revalidation headers -----------------------------------------------------
run_vitest 5 web src/pwa/standalone.test.ts -t "safe-area"
run_vitest 5 web src/pwa/standalone.test.ts -t "headers"

# --- Check 6: budget and flows ----------------------------------------------------------------------
if [ "$BUILT" = 1 ]; then
  SIZE="$(node -e '
    const fs = require("fs"), path = require("path"), zlib = require("zlib");
    const dir = path.join(process.argv[1], "assets");
    let total = 0;
    for (const f of fs.readdirSync(dir).filter((f) => /^index-.*\.js$/.test(f))) total += zlib.gzipSync(fs.readFileSync(path.join(dir, f)), { level: 9 }).length;
    process.stdout.write(String(total));
  ' "$TMP/dist")"
  [ "$SIZE" -le 200000 ] || bad 6 "the entry chunk is $SIZE bytes gzipped, over 200000"
fi
grep -lF 'An update to Baseball Theater is ready.' e2e/flows/*.spec.ts >/dev/null 2>&1 || bad 6 "no e2e/flows spec covers the update notice"
if ! pnpm exec playwright test --config e2e/playwright.config.ts e2e/flows >"$TMP/flows.log" 2>&1; then
  bad 6 "the Playwright flows fail:"; tail -15 "$TMP/flows.log" | sed 's/^/        /'
fi

# --- Check 7: no logos, no viewport ------------------------------------------------------------------
for f in $(story_changed_files S73 "$BASE" web/src); do
  [ -f "$f" ] || continue
  grep -nE '<img[^>]*logo|/logos/' "$f" >/dev/null && bad 7 "$f references a team logo"
  case "$f" in
    web/src/layout/*) ;;
    *) grep -nwE 'useMediaQuery|hiddenFrom|visibleFrom' "$f" >/dev/null && bad 7 "$f reads the viewport" ;;
  esac
done

# --- Check 8: design match captures -------------------------------------------------------------------
S="e2e/design/S73.spec.ts"
for fw in scoreboard-standalone-mobile:390 shell-update-mobile:390 shell-update-medium:768 shell-update-desktop:1200 settings-install-mobile:390 settings-install-desktop:1200 settings-install-ios-mobile:390; do
  name="${fw%%:*}"; w="${fw##*:}"; png="docs/v3/design-checks/S73/$name.png"
  grep -qF "\"$name\"" "$S" 2>/dev/null || bad 8 "$S does not name $name"
  if [ -f "$png" ]; then
    [ "$(png_width "$png")" = "$w" ] || bad 8 "$png is $(png_width "$png")px wide, want $w"
  else
    bad 8 "$png missing"
  fi
done

# --- Check 9: backlog Status is done -------------------------------------------------------------------
grep -qE '^\| [0-9]+ \| \[S73\].*\| `done` \|$' docs/v3/BACKLOG.md ||
  bad 9 "S73 row in the Story status table is not \`done\`"
awk '/^### S73 —/{f=1;next} /^### S[0-9]/{f=0} f' docs/v3/BACKLOG.md > "$TMP/s73.md"
grep -qE '^\*\*Status:\*\* `done`$' "$TMP/s73.md" || bad 9 "S73 story heading Status is not \`done\`"

report "verify-S73"
exit $?
