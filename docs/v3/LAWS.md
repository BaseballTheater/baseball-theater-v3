# Laws

What must stay true on every commit, whoever changes the code — and, beside it, every check every story's grader makes, sorted into the two kinds (S84).

The owner, 2026-10-28: *"Any given story may perform work whose requirements are specific to that story's functionality, but another story might do work that directly conflicts. … We'd only want to check each test's outcomes within the scope of its work, not in the context of the entire system."* And: *"The first would be an "at commit time" check which essentially proves the work is complete as defined at the time it's built, and would only be expected to succeed against the codebase as of the time of its commit. The second would be more of a law, something that defines things which ought to be checked henceforth."*

- **A grader is a commit-time proof.** `scripts/verify-<ID>.sh` proves its own story as the code stood when the story shipped. Its "this story didn't change X" checks look only at the story's own commits (`story_diff` / `story_changed_files` in `scripts/lib/checks.sh`), and `scripts/audit.sh story <ID> --reverify` runs it in a worktree at the story's shipping commit. A later story may legitimately do what an earlier grader forbade; the earlier grader stays true.
- **A law runs in `pnpm verify` on every commit** and is listed below with where it is enforced. Adding, changing or removing a law is an owner decision, recorded like a budget change (ADR-026). A requirement a story wants to hold forever becomes a law here, not a check in its grader.
- **Proposed** laws are requirements that should hold forever but that nothing in `pnpm verify` checks yet. Each names what would enforce it; a later story builds that, one law at a time.

`scripts/backlog-vault/laws.test.ts` fails when an enforced law's file is missing or its step is not in the `pnpm verify` chain.

## The laws

| ID | Law | Source | Enforced by | Step | Status |
| --- | --- | --- | --- | --- | --- |
| L1 | Browser storage is touched only in `web/src/storage/` (`bt/no-browser-storage`) | ADR-028 (S76) | `tools/eslint-rules/no-browser-storage.js` | lint | enforced |
| L2 | No arithmetic or `Math.*` over BT data in web components and pages (`bt/no-domain-arithmetic`) | ADR-025 rule 1 (S52) | `tools/eslint-rules/no-domain-arithmetic.js` | lint | enforced |
| L3 | Every repository class, `UserProfile` field and adapter directory is labeled in the personal-data manifest | ADR-028 (S76) | `functions/src/services/data-classification.test.ts` | test:coverage | enforced |
| L4 | The API's dispatched routes equal `ApiRoutes` | ADR-017 (S44) | `functions/src/handlers/route-table.test.ts` | test:coverage | enforced |
| L5 | The entry JavaScript stays within 200 KB gzipped (`pnpm size`) | ADR-026 (S54) | `.size-limit.json` | size | enforced |
| L6 | Every package meets its coverage floor | ADR-026, backlog rule 21 (S54) | `web/vitest.config.ts` | test:coverage | enforced |
| L7 | No copy-paste above the threshold (`pnpm dup:check`) | ADR-025 (S53) | `.jscpd.json` | dup:check | enforced |
| L8 | Every unfinished UI story carries a **Design match (rule 22)** criterion | ADR-026 as amended 2026-10-28, rule 22 (S81) | `scripts/backlog-vault/parse.ts` | lint | enforced |
| L9 | The backlog notes and `BACKLOG.md` agree; a UI story waits for its ratified design; every story says what it is for | backlog rules 5, 18, 19 (V3) | `scripts/backlog-vault/cli.ts` | lint | enforced |
| L10 | The generated web API types match the published spec | ADR-016 (S29) | `web/src/api/codegen.test.ts` | test:coverage | enforced |
| L11 | No explicit `any` | CLAUDE.md "TypeScript strict" (S11, S13, S25, S29); typescript-eslint recommended | `eslint.config.js` | lint | enforced |
| P1 | Only `web/src/layout/` reads the viewport (`useMediaQuery`, `hiddenFrom`, `visibleFrom`; `bt/no-viewport-outside-layout`) | ADR-014 rule 8 (S6, S40, S59, S60, S83); owner, 2026-10-28: *"Yes: P1, P3, P5, P8"* (S85) | `tools/eslint-rules/no-viewport-outside-layout.js` | lint | enforced |
| P3 | The web app never calls MLB directly (`bt/no-mlb-in-web`) | ADR-002 (S16); owner, 2026-10-28 (S85) | `tools/eslint-rules/no-mlb-in-web.js` | lint | enforced |
| P5 | No personal data (emails, exports) in logs (`bt/no-personal-data-in-logs`) | ADR-028 (S77, S80); owner, 2026-10-28 (S85) | `tools/eslint-rules/no-personal-data-in-logs.js` | lint | enforced |
| P6 | Coverage floors never fall — except where an active override in [Overrides](#overrides) covers it | backlog rule 21 (owner, 2026-10-19: ratchet) (S7, S25, S29, S42–S44, S49, S52, S54) | would be: a test comparing each floor with its last committed value | — | proposed |
| P7 | Sealed design files never change — except where an active override in [Overrides](#overrides) covers it | backlog rule 18 (S55–S58, S78) | would be: a test verifying every `RATIFIED.md` and amendment manifest | — | proposed |
| P8 | `pnpm verify` starts no browser | S81; owner, 2026-10-28 (S85) | `scripts/backlog-vault/verify-chain.test.ts` | test:coverage | enforced |
| P9 | No breaking API change without a new version — except where an active override in [Overrides](#overrides) covers it | ADR-015, ADR-016 (S27, S44) | `pnpm api:breaking` runs in CI (`.github/workflows/ci.yml`), not in `pnpm verify` | — | proposed |
| P10 | Cookies are set by one codepath only (`functions/src/services/cookies.ts`); today the one cookie is the deletion cookie | owner, 2026-10-29: *"Yes, add it with S87"* (S87; the owner's earlier example, now a conscious choice) | `functions/src/handlers/cookie-law.test.ts` | test:coverage | enforced |
| P11 | CI runs `pnpm verify` on every change to code, so every law it holds — including `pnpm dup:check` (L7) and `pnpm size` (L5) — also holds in CI (`.github/workflows/ci.yml`, step "Verify"). A docs-only change (only Markdown, `docs/`, `.claude/`, as `scripts/ci-changes.sh` decides: a pull request against its base, a push against the last commit on its branch whose CI run passed) runs only the docs checks: `pnpm backlog:check`, `pnpm test:backlog` and Markdown format outside `docs/` | owner, 2026-10-29: *"Yes"*, to running all of `pnpm verify` in CI (S62); owner, 2026-11-07, of a docs-only pull request: *"Things like this shouldn't trigger CI."* | `scripts/backlog-vault/ci-law.test.ts` | test:coverage | enforced |

**Owner decisions, 2026-10-28.** P1, P3, P5 and P8 are enforced (*"Yes: P1, P3, P5, P8"*; built by S85). Taken out of the registry: no team-logo images and no magic-link or passkey sign-in (*"Some of these aren't wrong, but don't need to be checked or can't be checked: P2, P4"*) — the graders that checked them still prove their own stories; and, at first, the cookie law (*"One was just an example: P10 (not saying it's not a good idea, but it should be a consequence of a conscious choice, not an example)"*) — it is added when a story deliberately introduces cookies. P6, P7 and P9 hold *"except when directed by the owner to override, with a reason and explanation, and a clear scope, so the override is not indefinite"*; for P9: *"Specifically for P9, my fear was having to make a "breaking change" that actually removes a breaking change, i.e. a change that is considered breaking compared to the prior version, but that prior version is broken and there is some reason why avoiding versioning matters."*

## Overrides

A law marked *except where an active override covers it* yields only to a row here, written at the owner's direction (owner, 2026-10-28: *"except when directed by the owner to override, with a reason and explanation, and a clear scope, so the override is not indefinite"*). Each row quotes the owner, says why, names exactly what it covers (the floor, the file, the route and spec version — never "everything"), and says when it ends (a story ID, a date, or the event that retires it). When a story enforces such a law, its check reads this table and allows only what an active row covers; an ended row allows nothing. No row is ever deleted — ended rows stay as the record.

| Law | Owner's words | Why | Scope | Ends | Status |
| --- | --- | --- | --- | --- | --- |

## Every grader, sorted

Each declared check of each `scripts/verify-*.sh`, as **pinned** (proves its own story at its commit) or **law** (should hold forever: `enforced:` names the law that holds it in `pnpm verify`, `proposed:` the law that would). A law row stays in its grader too — a grader still proves its story did the thing — but holding it from now on is the law's job.

| Grader | Check | What it proves | Class | Law |
| --- | --- | --- | --- | --- |
| S11 | 1 | workspace package with >=2 concern-split modules | pinned | — |
| S11 | 2 | named exported types cover schedule / live feed / content | pinned | — |
| S11 | 3 | no \`any\` on carried files | law | enforced: L11 |
| S11 | 4 | named play-event type, referenced as an array (not inline) | pinned | — |
| S11 | 5 | the three recorded raw payloads, unmodified | pinned | — |
| S11 | 6 | a story-scoped Vitest file parses all three with zod/valibot | pinned | — |
| S11 | 7 | GameSnapshot stays a BT domain type | pinned | — |
| S11 | 8 | backlog status | pinned | — |
| S12 | 1 | HttpMlbStatsClient under adapters, assignable to MlbStatsClient | pinned | — |
| S12 | 2 | talks to statsapi.mlb.com via fetch/https (read source, no calls) | pinned | — |
| S12 | 3 | highlights provenance is stated in Scope files | pinned | — |
| S12 | 4 | pure mapper modules (no I/O) → ScheduleDay / GameSnapshot | pinned | — |
| S12 | 5 | named unit test maps the recorded live fixture to domain | pinned | — |
| S12 | 6 | fixtures stay the default; live client is opt-in | pinned | — |
| S12 | 7 | existing API tests still pass offline | pinned | — |
| S12 | 8 | backlog status | pinned | — |
| S13 | 1 | the port declares all three new methods | pinned | — |
| S13 | 2 | FixtureMlbStatsClient implements all three from fixtures/ | pinned | — |
| S13 | 3 | named upstream types in the S11 tree, no \`any\`, coverage-gated | law | enforced: L11 |
| S13 | 4 | a mapper unit test per endpoint, fixtures only, green in isolation | pinned | — |
| S13 | 5 | the S11-tree suite stays green with the new types | pinned | — |
| S13 | 6 | backlog Status is done | pinned | — |
| S14 | 1 | functions/package.json exposes record-fixtures under functions/, dead seed script gone | pinned | — |
| S14 | 2 | two recording paths: raw via injected fetch, normalized via an MlbStatsClient adapter | pinned | — |
| S14 | 3 | the raw path writes the established fixtures/raw/<endpoint>-<key>.json names | pinned | — |
| S14 | 4 | a temp-dir Vitest round-trip proves non-empty schedule, standings and plays | pinned | — |
| S14 | 5 | README documents the command, both paths, and the no-network guarantee | pinned | — |
| S14 | 6 | backlog Status is done | pinned | — |
| S15 | 1 | root package.json has mlb:scan-drift; entrypoint under functions/ or packages/, not scripts/ | pinned | — |
| S15 | 2 | default invocation is offline (raw fixtures); live path gated on BT_USE_LIVE_MLB | pinned | — |
| S15 | 3 | a Vitest file: injected unknown path is reported; clean input reports nothing and exits 0 | pinned | — |
| S15 | 4 | two of LOOP.md / CLAUDE.md / README.md document the command and the dev update flow | pinned | — |
| S15 | 5 | scan runs green on committed fixtures from a named script; CI stays offline; .github/ untouched | pinned | — |
| S15 | 6 | CLAUDE.md monorepo table lists packages/mlb-api | pinned | — |
| S15 | 7 | packages/mlb-api/src/replay.ts is in the coverage include list and its comment is corrected | pinned | — |
| S15 | 8 | backlog Status is done | pinned | — |
| S16 | 1 | lead, trail and interval live in one module exporting DEFAULT_CADENCE, documented | pinned | — |
| S16 | 2 | tickIngest selects the active window, fetches, projects and upserts as windowMode active | pinned | — |
| S16 | 3 | injected clock + fake client: in-window projected, far out-of-window never fetched | pinned | — |
| S16 | 4 | tickIngest is exported and any pnpm dev interval is env-gated | pinned | — |
| S16 | 5 | web/ never imports HttpMlbStatsClient or statsapi.mlb.com | law | enforced: P3 |
| S16 | 6 | backlog Status is done | pinned | — |
| S17 | 1 | cache-mode read path refreshes once when missing or stale per a documented TTL constant | pinned | — |
| S17 | 2 | N parallel reads for one key collapse to exactly 1 upstream call (single in-flight) | pinned | — |
| S17 | 3 | a refresh inside a documented cooldown constant does not re-hit upstream | pinned | — |
| S17 | 4 | src/handlers/api.test.ts still passes (offline fixture path) | pinned | — |
| S17 | 5 | backlog Status is done | pinned | — |
| S21 | 1 | pure projection module over named BT store types | pinned | — |
| S21 | 2 | a repository persists projections, and ingest projects | pinned | — |
| S21 | 3 | fixture → projections, on the paths the UI will bind to | pinned | — |
| S21 | 4 | the store shapes are written down | pinned | — |
| S21 | 5 | existing ingest/API behavior still holds | pinned | — |
| S21 | 6 | backlog Status is done | pinned | — |
| S22 | 1 | port declares fetchGameTimestamps + fetchGameDiffPatch; FixtureMlbStatsClient implements both | pinned | — |
| S22 | 2 | named DiffPatch / JsonPatchOp / ReplayPatchEntry types in packages/mlb-api, no any, parser exercised | law | enforced: L11 |
| S22 | 3 | a pure module reconstructs feed state per timecode from base + ReplayPatchEntry[] | pinned | — |
| S22 | 4 | reconstruction test: retained < 553, final GameSnapshot runs match, plays non-decreasing | pinned | — |
| S22 | 5 | capture entrypoint under functions/ persists one replay artifact that round-trips | pinned | — |
| S22 | 6 | local-server default wiring still FixtureMlbStatsClient; capture is not part of pnpm dev | pinned | — |
| S22 | 7 | README documents capture-replay: post-final, never network in verify/CI | pinned | — |
| S22 | 8 | web/ is untouched by this story | pinned | — |
| S22 | 9 | diffpatch-823823.json is registered in coverage.test.ts with its parser | pinned | — |
| S22 | 10 | backlog Status is done | pinned | — |
| S23 | 1 | coverage helper with leafPaths + uncoveredPaths | pinned | — |
| S23 | 2 | coverage test + reasoned allowlist | pinned | — |
| S23 | 3 | every single-response raw fixture is covered | pinned | — |
| S23 | 4 | allowlist ceiling (<= 25 entries) | pinned | — |
| S23 | 5 | liveData.boxscore fully modeled | pinned | — |
| S23 | 6 | gameData branches + liveData leaders/decisions | pinned | — |
| S23 | 7 | no \`any\`; id-keyed escape hatches capped at 6 | law | enforced: L11 |
| S23 | 8 | composition, not repetition | pinned | — |
| S23 | 9 | the package's own suite is green | pinned | — |
| S23 | 10 | backlog Status is done | pinned | — |
| S24 | 1 | styles.css defines the five brand tokens with the right hex values | pinned | — |
| S24 | 2 | styles.css drops the night-park vars and the body radial-gradient | pinned | — |
| S24 | 3 | theme sets defaultColorScheme=auto and drops primaryColor teal | pinned | — |
| S24 | 4 | theme anchors Mantine primary on #CE0F0F | pinned | — |
| S24 | 5 | theme does not set Fraunces headings; body font includes IBM Plex Sans | pinned | — |
| S24 | 6 | index.html drops Fraunces and sets a valid theme-color | pinned | — |
| S24 | 7 | pages/ and layout/ contain no brand-hex paint chips | pinned | — |
| S24 | 8 | backlog Status is done | pinned | — |
| S25 | 1 | @tanstack/react-query v5+ in web/package.json and a QueryClientProvider mounted | pinned | — |
| S25 | 2 | web/src/api/{game,schedule}.ts each export a queryOptions( descriptor and their hook | pinned | — |
| S25 | 3 | payload types derive from ApiResponseFor; no client-side re-declaration of server shapes | pinned | — |
| S25 | 4 | a colocated type-level test @ts-expect-errors a wrong-typed setQueryData; web tsc exits 0 | pinned | — |
| S25 | 5 | no any / as unknown as in web/src/api/*.ts | law | enforced: L11 |
| S25 | 6 | no fetch(, setQueryData(, or raw key arrays under pages/ or components/ | pinned | — |
| S25 | 7 | GamePage and ScoreboardPage drop the cancelled flag and call their hooks | pinned | — |
| S25 | 8 | one exported freshness policy reads windowMode; both descriptors call it; no stray interval literals | pinned | — |
| S25 | 9 | an offline test proves one cache write updates two readers without remounting | pinned | — |
| S25 | 10 | the whole web suite passes | pinned | — |
| S25 | 101 | web coverage floor: lines/statements strictly up, functions/branches not lowered | law | proposed: P6 |
| S25 | 11 | backlog Status is done | pinned | — |
| S26 | 1 | one runtime-enumerable ApiRoutes table, keyof-constrained, covers schedule/game/error | pinned | — |
| S26 | 2 | each *Response type is a derived alias of its domain type, not hand-copied | pinned | — |
| S26 | 3 | every route path begins /api/v1/; no unversioned /api/<name> literal remains | pinned | — |
| S26 | 4 | a type-level assertion proves each alias is mutually assignable with its domain type | pinned | — |
| S26 | 5 | egress typed: no body: unknown, sends through to*Response mapping functions | pinned | — |
| S26 | 6 | server type-level test: @ts-expect-error on a bad send, tsc --noEmit exits 0 | pinned | — |
| S26 | 7 | ingress typed: fetch helper keyed by the route map, no getJson< call sites | pinned | — |
| S26 | 8 | at most one type assertion in the ingress path | pinned | — |
| S26 | 9 | client type-level test: @ts-expect-error on a wrong assignment, tsc --noEmit exits 0 | pinned | — |
| S26 | 10 | no runtime validation added (no zod/valibot at this boundary) | pinned | — |
| S26 | 11 | src/handlers/api.test.ts still exits 0 | pinned | — |
| S26 | 12 | backlog Status is done | pinned | — |
| S27 | 1 | generator under functions/ or packages/ uses ts-json-schema-generator, wired to root api:spec; no ts-oas | pinned | — |
| S27 | 11 | emitter names schemas from the route table's aliases, never GameSnapshot/ScheduleDay by name | pinned | — |
| S27 | 2 | openapi/bt-api.v1.json is OpenAPI 3.x JSON with one operation per ApiRoutes entry | pinned | — |
| S27 | 3 | each success response \$refs its alias component, which carries fetchedAt and windowMode | pinned | — |
| S27 | 31 | every operation has a 4xx ApiErrorResponse ref; schedule declares 400, game declares 404 | pinned | — |
| S27 | 4 | regenerating into a temp dir is byte-identical to the committed spec | pinned | — |
| S27 | 5 | oasdiff dev dependency; api:breaking uses --fail-on ERR against a distinct committed baseline | pinned | — |
| S27 | 6 | gate works both ways: unmodified spec exits 0, removed response field exits nonzero | pinned | — |
| S27 | 7 | ci.yml runs spec freshness + breaking gate; no network fetch added | pinned | — |
| S27 | 8 | README documents regeneration, generated-only, additive-only, ADR-015 versioning, baseline advancement | pinned | — |
| S27 | 9 | backlog Status is done | pinned | — |
| S29 | 1 | web depends on openapi-typescript, a package.json script regenerates offline, no openapi-fetch in any manifest | pinned | — |
| S29 | 2 | generated output is under web/src/api/generated/, not git-ignored, every file has an @generated banner in its first 5 lines | pinned | — |
| S29 | 3 | drift gate: regenerating produces no diff, and a web Vitest test runs the same regenerate-then-compare | law | enforced: L10 |
| S29 | 4 | a type-level test asserts generated <-> <DomainType>Response mutual assignability for every spec route; web tsc exits 0 | pinned | — |
| S29 | 41 | the fidelity test @ts-expect-errors a deliberately wrong pairing | pinned | — |
| S29 | 5 | web/src/api/{game,schedule}.ts import payload types from generated/, not through ApiResponseFor | pinned | — |
| S29 | 51 | src/api/generated/** excluded from web coverage; no threshold lowered since $START | law | proposed: P6 |
| S29 | 6 | no any / as unknown as in web/src/api outside generated/ | law | enforced: L11 |
| S29 | 7 | no zod / valibot import under web/src/api/ | pinned | — |
| S29 | 8 | the whole web suite passes | pinned | — |
| S29 | 9 | backlog Status is done | pinned | — |
| S30 | 1 | functions/vitest.config.ts declares branches: 60 (lines/functions/statements unchanged) | pinned | — |
| S30 | 2 | pnpm --filter @bt/functions exec vitest run --coverage exits 0 against that threshold | pinned | — |
| S30 | 3 | no non-test file under functions/src/ differs from the commit that starts this story | pinned | — |
| S30 | 4 | mappers/live.ts and mappers/schedule.ts each individually clear 60% branch coverage | pinned | — |
| S30 | 5 | backlog Status is done | pinned | — |
| S31 | 1 | DESIGN.md has its six sections, a design-source link, and ## Open questions is exactly None. | pinned | — |
| S31 | 2 | exports named <screen>[-<state>]-<pairing>; shell + scoreboard at mobile and medium/desktop; a shell-notice and a collapsed scoreboard export; ## Frames names two slot occupants | pinned | — |
| S31 | 3 | every export appears in the ## Frames table and every file the table names exists | pinned | — |
| S31 | 4 | ## Decisions and VISUAL-DESIGN §9 settle team-color strength and the letterform favicon, linking DESIGN.md | pinned | — |
| S31 | 5 | RATIFIED.md has Ratified by / Date / Source version / Go-ahead, a matching SHA-256 manifest, and the directory is committed | pinned | — |
| S31 | 6 | backlog Status is done | pinned | — |
| S32 | 1 | DESIGN.md has its six sections, a design-source link, and ## Open questions is exactly None. | pinned | — |
| S32 | 2 | exports named <screen>[-<state>]-<pairing>; game + video-player at mobile and medium/desktop; ## Frames shows the ← back control | pinned | — |
| S32 | 3 | every export appears in the ## Frames table and every file the table names exists | pinned | — |
| S32 | 4 | ## Decisions and VISUAL-DESIGN §9 settle mobile room chrome, the video player, and Videos sort/filter fields, linking DESIGN.md | pinned | — |
| S32 | 5 | RATIFIED.md has Ratified by / Date / Source version / Go-ahead, a matching SHA-256 manifest, and the directory is committed | pinned | — |
| S32 | 6 | backlog Status is done | pinned | — |
| S33 | 1 | DESIGN.md has its six sections, a design-source link, and ## Open questions is exactly None. | pinned | — |
| S33 | 2 | exports named <screen>[-<state>]-<pairing>; live, box, recap at mobile and medium/desktop; Live rows show the pitch-theater modules, collapsed and expanded rows, and no box on mobile | pinned | — |
| S33 | 3 | every export appears in the ## Frames table and every file the table names exists | pinned | — |
| S33 | 4 | ## Decisions is non-empty and §9 does not link visual/game-rooms/DESIGN.md | pinned | — |
| S33 | 5 | RATIFIED.md has Ratified by / Date / Source version / Go-ahead, a matching SHA-256 manifest, and the directory is committed | pinned | — |
| S33 | 6 | backlog Status is done | pinned | — |
| S34 | 1 | DESIGN.md has its six sections, a design-source link, and ## Open questions is exactly None. | pinned | — |
| S34 | 2 | exports named <screen>[-<state>]-<pairing>; standings, search, settings at mobile and medium/desktop; DESIGN.md names game-row slot and collapse non-favorites | pinned | — |
| S34 | 3 | every export appears in the ## Frames table and every file the table names exists | pinned | — |
| S34 | 4 | ## Decisions is non-empty and §9 does not link visual/standings-search-settings/DESIGN.md | pinned | — |
| S34 | 5 | RATIFIED.md has Ratified by / Date / Source version / Go-ahead, a matching SHA-256 manifest, and the directory is committed | pinned | — |
| S34 | 6 | backlog Status is done | pinned | — |
| S35 | 1 | REVISIONS.md has ## Source (figma.com URL + non-empty Version:) and ## Revisions | pinned | — |
| S35 | 2 | ## Revisions has a row for R6 R7 R8 R9 R14a R16 R17a R18, each naming an existing export | pinned | — |
| S35 | 3 | every export is named <slug>-(mobile\|medium\|desktop).(png\|svg\|pdf) with no dark/light token | pinned | — |
| S35 | 4 | required exports exist: shell-notice, scoreboard-slot-room-menu, 5 states x 3 sizes | pinned | — |
| S35 | 5 | backlog Status is done | pinned | — |
| S36 | 1 | REVISIONS.md has ## Source (figma.com URL + non-empty Version:) and ## Revisions | pinned | — |
| S36 | 2 | ## Revisions has a row for R6 R7 R10 R14b R15 R18, each naming an existing export | pinned | — |
| S36 | 3 | every export is named <slug>-(mobile\|medium\|desktop).(png\|svg\|pdf) with no dark/light token | pinned | — |
| S36 | 4 | required exports: game-phase-{pregame,live,final}, videos grid medium+desktop, videos list, video-player mobile + medium/desktop | pinned | — |
| S36 | 5 | REVISIONS.md carries the MLBAM disclaimer sentence verbatim | pinned | — |
| S36 | 6 | backlog Status is done | pinned | — |
| S37 | 1 | REVISIONS.md has ## Source (figma.com URL + non-empty Version:) and ## Revisions | pinned | — |
| S37 | 2 | ## Revisions has a row for R6 R7 R8 R11 R12 R18, each naming an existing export | pinned | — |
| S37 | 3 | every export is named <slug>-(mobile\|medium\|desktop).(png\|svg\|pdf) with no dark/light token | pinned | — |
| S37 | 4 | required exports: live-{mobile,medium,desktop} and at least one box-*-(mobile\|medium\|desktop) | pinned | — |
| S37 | 5 | R11 row names live-mobile, live-medium, live-desktop; R12 row names a live-* export | pinned | — |
| S37 | 6 | backlog Status is done | pinned | — |
| S38 | 1 | REVISIONS.md has ## Source (figma.com URL + non-empty Version:) and ## Revisions | pinned | — |
| S38 | 2 | ## Revisions has a row for R13 R17b R18, each naming an existing export; R13 row names its groups and controls | pinned | — |
| S38 | 3 | every export is named <slug>-(mobile\|medium\|desktop).(png\|svg\|pdf) with no dark/light token | pinned | — |
| S38 | 4 | required exports: settings, standings, search each at mobile, medium, desktop | pinned | — |
| S38 | 5 | backlog Status is done | pinned | — |
| S39 | 1 | styles.css sets --bt-dark #10100F, drops #211819, defines Raised / Raised current / Primary Light | pinned | — |
| S39 | 2 | theme exposes pitch ball / strike / in-play roles with the ratified hex values | pinned | — |
| S39 | 3 | App.tsx locks the color scheme to dark and drops defaultColorScheme=auto | pinned | — |
| S39 | 4 | a web Vitest test asserts the #10100F page ground and dark color scheme | pinned | — |
| S39 | 5 | index.html sets theme-color #10100F | pinned | — |
| S39 | 6 | pages/ and layout/ contain no ratified-palette hex | pinned | — |
| S39 | 7 | the S39 theme test passes on its own | pinned | — |
| S39 | 8 | backlog Status is done | pinned | — |
| S40 | 1 | GamePage test asserts the top bar: back link /games/2024-07-04, NYM @ WSH, the date | pinned | — |
| S40 | 2 | top bar shows no score, venue or status; GamePage/top bar never read linescore or .runs | pinned | — |
| S40 | 3 | phase-aware tabs asserted for final 744834, live 745001 (LIVE indicator) and a Preview copy | pinned | — |
| S40 | 4 | a hidden tab (/game/744834/live) falls back to the Videos room | pinned | — |
| S40 | 5 | room states: loader, error with Retry that refetches; error copy uses Primary, not raw red | pinned | — |
| S40 | 6 | the S40 test files pass, each run alone | pinned | — |
| S40 | 7 | game chrome files: no team logos, no useMediaQuery / hiddenFrom / visibleFrom | law | enforced: P1 |
| S40 | 8 | backlog Status is done | pinned | — |
| S42 | 1 | functions/src/adapters/firestore/, firebase.json and .firebaserc do not exist | pinned | — |
| S42 | 2 | git grep -ilE 'firebase\|firestore' over functions, packages, web, eslint.config.js, .gitignore, .prettierignore prints nothing | pinned | — |
| S42 | 3 | functions/package.json declares no @google-cloud/firestore or firebase* dependency; pnpm-lock.yaml has no @google-cloud/firestore | pinned | — |
| S42 | 4 | local-server.ts has no BT_USE_FIRESTORE and still contains FixtureMlbStatsClient and BT_USE_LIVE_MLB | pinned | — |
| S42 | 5 | functions/vitest.config.ts has no adapters/firestore exclude; thresholds unchanged or higher (lines 70, statements 70, branches 60, functions 70) | law | proposed: P6 |
| S42 | 6 | pnpm --filter @bt/functions exec vitest run src/handlers/api.test.ts exits 0 | pinned | — |
| S42 | 7 | backlog Status is done (story heading and Story status table) | pinned | — |
| S43 | 1 | applyIfNewer exported from @bt/domain; its test feeds duplicated + >=3 shuffled orders and expects the highest version | pinned | — |
| S43 | 2 | cacheLifetimeMs + ladder constants exported from @bt/domain; its test covers 0, every boundary and far beyond 48h | pinned | — |
| S43 | 3 | contentHash exported from @bt/domain; its test covers key-order independence and a changed nested field | pinned | — |
| S43 | 4 | each of the three test files exits 0 when run alone via pnpm --filter @bt/domain exec vitest run <file> | pinned | — |
| S43 | 5 | packages/domain/vitest.config.ts thresholds are unchanged or higher (lines 85, functions 90, branches 60, statements 85) | law | proposed: P6 |
| S43 | 6 | backlog Status is done (story heading and Story status table) | pinned | — |
| S44 | 1 | handleApiRequest is (request: Request, ctx: ApiContext) => Promise<Response>; no node:http under src/handlers/ | pinned | — |
| S44 | 2 | local-server.ts adapts Node http to the handler; api.test.ts exits 0 with its status/body assertions unchanged | pinned | — |
| S44 | 3 | a route-table test: dispatched JSON routes == ApiRoutes keys, negative case, named streaming exception list | law | enforced: L4 |
| S44 | 4 | pnpm api:breaking exits 0 (no contract change) | law | proposed: P9 |
| S44 | 5 | functions/vitest.config.ts coverage thresholds unchanged or higher | law | proposed: P6 |
| S44 | 6 | backlog Status is done (story heading and Story status table) | pinned | — |
| S46 | 1 | GameProjectionRepository and ReplayArtifactRepository live in packages/ports; services import them from @bt/ports | pinned | — |
| S46 | 2 | a shared describeRepositoryContract suite covers cases (a)–(f) | pinned | — |
| S46 | 3 | the contract runs against every in-memory repository, 0 skipped, and its file exits 0 alone | pinned | — |
| S46 | 4 | GameSnapshot/ScheduleDay carry version + lastChangedAt; spec and web types regenerated; pnpm api:breaking exits 0 | pinned | — |
| S46 | 5 | ingest bumps version/lastChangedAt only when contentHash changes (tested: same fixture twice, then a change) | pinned | — |
| S46 | 6 | backlog Status is done (story heading and Story status table) | pinned | — |
| S49 | 1 | requests in web/src/api/ go through an openapi-fetch createClient<paths> typed by generated/bt-api.v1.ts | pinned | — |
| S49 | 2 | no hand-assembled path: no backtick /api/ literal; a @ts-expect-error type test on an undeclared path, tsc exits 0 | pinned | — |
| S49 | 3 | each existing web/src/api/*.test.ts(x) exits 0 when run alone | pinned | — |
| S49 | 4 | web/vitest.config.ts coverage thresholds unchanged or higher | law | proposed: P6 |
| S49 | 5 | backlog Status is done (story heading and Story status table) | pinned | — |
| S52 | 1 | @bt/domain exports gamePhase / roomsForPhase / resolveRoom with tests (incl. a table test against isLiveStatus / isFinalStatus); web gamePhase.ts defines no phase switch | pinned | — |
| S52 | 2 | git grep -nE 'codedGameState ===\|abstractGameState ===' web/src prints nothing | pinned | — |
| S52 | 3 | an ESLint rule under tools/eslint-rules/ flags arithmetic / Math.* on @bt/domain-typed operands in web components + pages; its RuleTester test passes; pnpm lint exits 0 | law | enforced: L2 |
| S52 | 4 | pitchOutcome lives in @bt/domain with a test; web pitch/utils.ts only maps the outcome to a theme role | pinned | — |
| S52 | 5 | tsconfig.base.json has no experimentalDecorators and pnpm build exits 0 | pinned | — |
| S52 | 6 | packages/domain/vitest.config.ts thresholds are unchanged or higher (lines 85, functions 90, branches 60, statements 85) | law | proposed: P6 |
| S52 | 7 | backlog Status is done (story heading and Story status table) | pinned | — |
| S53 | 1 | pnpm verify runs jscpd over packages/, functions/src/, web/src/ with a threshold in .jscpd.json (generated + fixtures ignored); a test shows a copied 30-line block fails it | law | enforced: L7 |
| S53 | 2 | pnpm comments:stale (under tools/) flags exported symbols whose body changed but comment did not, exits 0; unit test covers changed + unchanged | pinned | — |
| S53 | 3 | frame 00's rules require a **Reuse check** section on every story with the ADR-025 wording | pinned | — |
| S53 | 4 | pnpm verify still runs lint (with backlog check), coverage tests and build | pinned | — |
| S53 | 5 | backlog Status is done (story heading and Story status table) | pinned | — |
| S54 | 1 | pnpm verify runs size-limit on the built web/dist with a 200 KB gzipped budget; a test with the budget lowered to 1 KB shows it exits nonzero and names the asset | law | enforced: L5 |
| S54 | 2 | web/src/test/renderCount.tsx exports a React Profiler helper; its test asserts the render count of a toy component across one state change | pinned | — |
| S54 | 3 | every package's coverage floor (lines, branches, functions, statements) is raised to its measured value rounded down to the whole percent | law | enforced: L6 |
| S54 | 4 | frame 00's rules record the ratchet: raise the floors each story can until domain 95 and the rest 85 lines / 80 branches (ADR-026); never lower one | law | proposed: P6 |
| S54 | 5 | backlog Status is done (story heading and Story status table) | pinned | — |
| S55 | 1 | each touched surface has its next free amendments/A<N>.md naming what it adds/overrides/repeals, with ## Frames, ## Decisions (owner's words), ## Open questions = None., and a SHA-256 manifest of its frames | pinned | — |
| S55 | 2 | frames cover: standalone scoreboard (mobile); offline scoreboard (mobile, medium, desktop); offline room + never-viewed room offline (mobile); update notice (mobile, medium, desktop); Settings Install app row (mobile, desktop) — named <screen>[-<state>]-<pairing>.png and listed in ## Frames | pinned | — |
| S55 | 3 | each amendment's ratification record quotes the owner's in-session go-ahead verbatim | pinned | — |
| S55 | 4 | no sealed file in those surfaces changed (each RATIFIED.md manifest still verifies) | law | proposed: P7 |
| S55 | 5 | backlog Status is done (story heading and Story status table) | pinned | — |
| S56 | 1 | each touched surface has its next free amendments/A<N>.md naming what it adds/overrides/repeals, with ## Frames, ## Decisions (owner's words), ## Open questions = None., and a SHA-256 manifest of its frames | pinned | — |
| S56 | 2 | frames cover: nav drawer (mobile, medium) + desktop header without burger; signed-out shell (mobile, desktop); Videos without Filter; search result playing in a modal over the results with a game link; Search retitled; collapsed bar with score; Live full-width tabs (medium); rail version line (desktop); Live footer without subscription link (medium); recap source line; iOS Install row — named <screen>[-<state>]-<pairing>.png and listed in ## Frames | pinned | — |
| S56 | 3 | each amendment's ratification record quotes the owner's in-session go-ahead verbatim | pinned | — |
| S56 | 4 | no sealed file in those surfaces changed (each RATIFIED.md manifest still verifies) | law | proposed: P7 |
| S56 | 5 | backlog Status is done (story heading and Story status table) | pinned | — |
| S57 | 1 | each touched surface has its next free amendments/A<N>.md naming what it adds/overrides/repeals, with ## Frames, ## Decisions (owner's words), ## Open questions = None., and a SHA-256 manifest of its frames | pinned | — |
| S57 | 2 | frames cover: Live, Box, Plays (with Runs) and Recap with Hide Scores on (mobile; Live also medium); scoreboard slot occupants, digest and collapsed bar under Hide Scores (mobile); Videos titles incl. Recap (score hidden); the owner's free-text title rule quoted in ## Decisions — named <screen>[-<state>]-<pairing>.png and listed in ## Frames | pinned | — |
| S57 | 3 | each amendment's ratification record quotes the owner's in-session go-ahead verbatim | pinned | — |
| S57 | 4 | no sealed file in those surfaces changed (each RATIFIED.md manifest still verifies) | law | proposed: P7 |
| S57 | 5 | backlog Status is done (story heading and Story status table) | pinned | — |
| S58 | 1 | each touched surface has its next free amendments/A<N>.md naming what it adds/overrides/repeals, with ## Frames, ## Decisions (owner's words), ## Open questions = None., and a SHA-256 manifest of its frames | pinned | — |
| S58 | 2 | frames cover: signed-in Account section with sign out (mobile, desktop); Patreon not linked and linked with tier (mobile); desktop scoreboard header with rail foot v3.0.0 (c46e853) — named <screen>[-<state>]-<pairing>.png and listed in ## Frames; no sign-in, email or code-entry frame; ## Decisions records that Logto's sign-in experience provides them | pinned | — |
| S58 | 3 | each amendment's ratification record quotes the owner's in-session go-ahead verbatim | pinned | — |
| S58 | 4 | no sealed file in those surfaces changed (each RATIFIED.md manifest still verifies) | law | proposed: P7 |
| S58 | 5 | backlog Status is done (story heading and Story status table) | pinned | — |
| S59 | 1 | web/src/session/ exports a session provider and useSession() (signed out / signed in with uid + email, signIn, signOut), reading GET /api/v1/me through the typed client, not a TanStack query | pinned | — |
| S59 | 2 | a development-only dev sign-in control signs in as dev:test-user; a test proves it is absent when import.meta.env.PROD | pinned | — |
| S59 | 3 | signed out, the Settings nav item is absent and /settings redirects to the scoreboard; signed in, both render (RTL) | pinned | — |
| S59 | 4 | sign-out clears the session and invalidates session-dependent queries (test) | pinned | — |
| S59 | 5 | files this story adds or edits have no team-logo <img> or /logos/, and no useMediaQuery/hiddenFrom/visibleFrom outside web/src/layout/ | law | enforced: P1 |
| S59 | 6 | backlog Status is done (story heading and Story status table) | pinned | — |
| S6 | 1 | GET/PUT /api/v1/me/settings in ApiRoutes and the spec: 401 signed out, PUT then GET round-trips, an older version is ignored, a deleted uid's session is 401 on both; pnpm api:breaking exits 0 | pinned | — |
| S6 | 2 | SettingsRepository port + in-memory adapter pass the S46 contract and a store deletion case of case (h)'s form; registered as BT database: settings and labeled personal; UserProfile has no favoriteTeamIds | pinned | — |
| S6 | 3 | web/src/settings/store.ts: Zustand store, useSettings(), setFavoriteTeams/setOpensFirst save to the account, hydrates after sign-in, resets on sign-out, persists through web/src/storage/ under a personal key; no browser storage outside web/src/storage/ | pinned | — |
| S6 | 4 | Settings renders Game List / Game Detail / Account, one column on mobile and two on medium/desktop; Account shows Signed in as {email} and a Sign out link calling signOut(); no Patreon row (RTL) | pinned | — |
| S6 | 5 | the Favorite Teams dropdown sets favorites and the choice survives a remount with a freshly hydrated store (RTL) | pinned | — |
| S6 | 6 | Opens First offers exactly Videos / Live / Box; GamePage opens that room when the phase offers it, else resolveRoom's fallback; signed out, the house default (test) | pinned | — |
| S6 | 7 | web/src has no presentationProfile, magic link or passkey text (case-insensitive) | pinned | — |
| S6 | 8 | files this story adds or edits have no team-logo <img> or /logos/, and no useMediaQuery/hiddenFrom/visibleFrom outside web/src/layout/ | law | enforced: P1 |
| S6 | 9 | backlog Status is done (story heading and Story status table) | pinned | — |
| S60 | 1 | only web/src/layout/ reads the viewport and passes variant mobile\|medium\|desktop to pages (RTL at three widths); no useMediaQuery/hiddenFrom/visibleFrom elsewhere | law | enforced: P1 |
| S60 | 2 | mobile/medium: header with burger, wordmark, account control; burger opens the nav drawer, which closes on navigate. Desktop: 240px rail, exactly one aria-current by path prefix (/game/:pk -> Scoreboard), no burger (RTL) | pinned | — |
| S60 | 3 | game routes render the game top bar instead of the app header and keep the rail on desktop; room tabs span the full width (medium, Live) | pinned | — |
| S60 | 4 | FooterMeta renders Fetched {age} · baseball.theater from fetchedAgo in packages/domain (0s, 59s, 61s, 2h); never 'Scores hidden in settings' | pinned | — |
| S60 | 5 | NoticeSlot renders NoticeBanner (message, Reload, ✕) under the header; ✕ dismisses; message-only banner renders; the only notice component | pinned | — |
| S60 | 6 | one ViewState (loading keeps the title / empty / error + Retry) replaces components/game/RoomState.tsx; rooms and pages import it | pinned | — |
| S60 | 7 | favicon is the flag mark SVG; version line v3.0.{build} ({7-char commit}) injected by vite.config.ts from GITHUB_RUN_NUMBER (dev outside Actions), nothing written to package.json; format pinned by a test; no 'local fixtures' text in web/src | pinned | — |
| S60 | 8 | signed out: no Settings nav item, header shows 'Sign in' calling useSession().signIn(); signed in, the account control leads to Settings (RTL) | pinned | — |
| S60 | 9 | LiveIndicator is one component used by the game top bar; its blink stops under prefers-reduced-motion (test) | pinned | — |
| S60 | 10 | files this story adds or edits have no team-logo <img> or /logos/, and no useMediaQuery/hiddenFrom/visibleFrom outside web/src/layout/ | law | enforced: P1 |
| S60 | 11 | backlog Status is done (story heading and Story status table) | pinned | — |
| S7 | 1 | FirestoreScheduleRepository + FirestoreGameRepository under functions/src/adapters/, port-assignable (typecheck) | pinned | — |
| S7 | 2 | an integration test skips the emulator round-trip when FIRESTORE_EMULATOR_HOST is unset and still exits 0 | pinned | — |
| S7 | 3 | local-server default repos are still the in-memory adapters unless a documented env flag is set | pinned | — |
| S7 | 4 | src/handlers/api.test.ts still exits 0 (offline) | pinned | — |
| S7 | 5 | functions coverage floor is protected: Firestore adapters thin or excluded; no threshold lowered | law | proposed: P6 |
| S7 | 6 | backlog Status is done | pinned | — |
| S76 | 1 | packages/ports exports PersonalDataStore (name, exportFor, deleteFor); functions/src/services/personal-data.ts exports one registry function, and the in-memory user repository is registered (test) | pinned | — |
| S76 | 2 | a classification manifest in functions/src/ labels every repository class in memory/repos.ts, every UserProfile field and every adapter directory as personal (naming a registered store) or none; a test fails on an unlabeled entry and a test proves the check catches one | law | enforced: L3 |
| S76 | 3 | repository-contract.ts has a lettered deletion case (two uids; deleteFor removes one's profile and identity links, leaves the other), passing against InMemoryUserRepository with its file run alone | pinned | — |
| S76 | 4 | browser storage only in web/src/storage/ (ESLint rule + fixture test), keys labeled personal or not, session token stored through it, one clear-personal function that signOut() calls (test) | law | enforced: L1 |
| S76 | 5 | backlog-review SKILL.md has a personal-data check; every registry store name appears in ADR-028's inventory table | pinned | — |
| S76 | 6 | backlog Status is done (story heading and Story status table) | pinned | — |
| S77 | 1 | GET /api/v1/me/export returns every registered store's export keyed by name plus a single-use deletion token bound to the uid expiring within 15 minutes; 401 signed out (test) | pinned | — |
| S77 | 2 | POST /api/v1/me/delete refuses a session older than 10 minutes (403), a wrong phrase (400, one exported constant) and a missing/used/expired/other-uid/non-export token (403), each tested | pinned | — |
| S77 | 3 | a successful delete runs deleteFor on every store and IdentityAdmin.deleteAccount per linked identity; /me with the same session is then 401 and no store holds the uid; a store that fails once fails the request and a retry finishes (test) | pinned | — |
| S77 | 4 | a deletion log keeps only uid + time and reapplyDeletions removes a restored uid (test); the log is labeled retained (allowed on it only, test) and the token record (ID + expiry only) is labeled | pinned | — |
| S77 | 5 | both routes are in ApiRoutes, the spec and the web types with generated.types.test.ts pairings; pnpm api:breaking exits 0 | pinned | — |
| S77 | 6 | no console.* call in code this story adds logs an email or an export body (grep) | law | enforced: P5 |
| S77 | 7 | backlog Status is done (story heading and Story status table) | pinned | — |
| S78 | 1 | standings-search-settings/amendments/A4.md names what it adds/overrides/repeals, with ## Frames, ## Decisions (owner's words), ## Open questions = None., and a SHA-256 manifest of its frames | pinned | — |
| S78 | 2 | frames cover the ways in (mobile, desktop), ready download, 24-hour refusal, typed-phrase confirmation (mobile, desktop) and its download warning, re-sign-in, failed deletion with Try again + support message (mailto:support@baseball.theater), signed-out after deletion; <screen>[-<state>]-<pairing>.png, all in ## Frames; ## Decisions quotes the owner's 2026-10-23, 2026-10-27 and 2026-10-28 words | pinned | — |
| S78 | 3 | the ratification record quotes the owner's in-session go-ahead verbatim | pinned | — |
| S78 | 4 | no sealed file in the surface changed (RATIFIED.md and A1-A3 manifests still verify) | law | proposed: P7 |
| S78 | 5 | backlog Status is done (story heading and Story status table) | pinned | — |
| S8 | 1 | packages/ports exports IdentityProvider (completeSignIn → { provider, subject, email, emailVerified }) and IdentityAdmin (list, disable, delete) | pinned | — |
| S8 | 2 | UserRepository links (provider, subject) → uid; a contract case for it passes against the in-memory repository | pinned | — |
| S8 | 3 | a BT session (uid, role, entitlements) is HMAC-signed with WebCrypto, keyed through SecretsProvider; verifying reads no repository (spy) | pinned | — |
| S8 | 4 | GET /api/v1/me is in ApiRoutes and the spec (401 / 200 with Bearer dev:test-user, uid + email); no local: prefix; pnpm api:breaking exits 0 | pinned | — |
| S8 | 5 | no passkey/webauthn in ports or functions; no @logto/ import outside functions/src/adapters/logto/ | pinned | — |
| S8 | 6 | the functions test files for ACs 3–4 exit 0 when run alone | pinned | — |
| S8 | 7 | backlog Status is done (story heading and Story status table) | pinned | — |
| S80 | 1 | requesting a download stores every registered store's export (keyed by name) in an ExportStore port with a 14-day expiry and answers id + expiry, not the data; 401 signed out (test) | pinned | — |
| S80 | 2 | a third request inside rolling 24 hours is 429 with the next allowed time; a request 24 hours after the earliest succeeds (test, injected clock; domain rule tested) | pinned | — |
| S80 | 3 | the current download (id + expiry) reads back and its file is fetched by its owner only; another user, an expired download or none is 404 (test) | pinned | — |
| S80 | 4 | a successful request sends one message through a Mailer port to the account's email with a link to BT and no exported data; no email, no message (test) | pinned | — |
| S80 | 5 | POST /api/v1/me/delete deletes with the phrase and a recent sign-in alone, no download made; reauth_required and phrase_mismatch kept (test); no deletionToken, DeletionTokenRepository or export_required in tracked packages/ or functions/src/ (grep) | pinned | — |
| S80 | 6 | the ExportStore is registered as \"Cloud storage: data downloads\", labeled in the manifest, and passes the repository contract's deletion case (test) | pinned | — |
| S80 | 7 | in-memory ExportStore and Mailer adapters live in functions/src/adapters/memory/ and are what pnpm dev uses; no console.* call this story adds logs an email or exported data (grep) | law | enforced: P5 |
| S80 | 8 | the download routes are in ApiRoutes, the spec and the web types with generated.types.test.ts pairings; pnpm api:breaking exits 0 | pinned | — |
| S80 | 9 | backlog Status is done (story heading and Story status table) | pinned | — |
| S81 | 1 | @playwright/test pinned; e2e/playwright.config.ts runs the fixture-backed app with mobile 390x844, medium 768x1024, desktop 1200x844; a spec shows burger-no-rail on mobile/medium and rail-no-burger on desktop | pinned | — |
| S81 | 2 | e2e/design/helpers.ts signs in as the dev account, freezes the clock, stubs API answers with page.route, hides the dev control; a spec uses each | pinned | — |
| S81 | 3 | pnpm design:capture <ID> writes docs/v3/design-checks/<ID>/<frame>.png only (never docs/v3/visual/); Playwright output folders are git-ignored | pinned | — |
| S81 | 4 | audit.sh story --design-match records frame + capture SHA-256 and the owner's quoted verdict, and refuses completion of a design story without it (test) | pinned | — |
| S81 | 5 | pnpm backlog:check fails when a todo/doing story with a design: list lacks a Design match (rule 22) AC (vault test), and passes at HEAD | law | enforced: L8 |
| S81 | 6 | pnpm verify starts no browser (no Playwright in the verify chain) | law | enforced: P8 |
| S81 | 7 | S60 pilot: e2e/design/S60.spec.ts captures the six shell frames at their pairing widths into docs/v3/design-checks/S60/, and the ledger has an S60 re-verification with a Design match section quoting the owner | pinned | — |
| S81 | 8 | backlog Status is done (story heading and Story status table) | pinned | — |
| S83 | 1 | web/index.html loads the owner's Typekit kit exactly; the wordmark's BT is set in clarendon-urw with a serif fallback; Wordmark's comment no longer says Plex (RTL) | pinned | — |
| S83 | 2 | the active rail/drawer item is filled var(--bt-primary) with the lighter left marker bar; inactive items have no bar (RTL) | pinned | — |
| S83 | 3 | rail item, header 'Sign in' and version line text values come from Figma, noted beside where they are set, and pinned by RTL tests | pinned | — |
| S83 | 4 | design match (rule 22): e2e/design/S83.spec.ts shares S60's frame list through one module; the six captures exist in docs/v3/design-checks/S83/ at their pairing widths | pinned | — |
| S83 | 5 | files this story adds or edits have no team-logo <img> or /logos/, and no useMediaQuery/hiddenFrom/visibleFrom outside web/src/layout/ | law | enforced: P1 |
| S83 | 6 | backlog Status is done (story heading and Story status table) | pinned | — |
| S84 | 1 | the verify-script contract states the two tiers: a grader is a commit-time proof of its own story (scope checks on its own commits, never base to HEAD); a law runs in pnpm verify and is listed in docs/v3/LAWS.md; changing a law is an owner decision | pinned | — |
| S84 | 2 | audit.sh story --reverify runs the grader in a temporary worktree at the story's shipping commit and removes it (test: fails at HEAD, re-verifies as passing) | pinned | — |
| S84 | 3 | audit.sh design <ID> --design-match records a verdict without running the grader, and is not counted as a completion; story completion still requires the verdict for a UI story (test) | pinned | — |
| S84 | 4 | docs/v3/LAWS.md lists the seeded laws with source and enforcement; a vault test fails when an enforced law's file is missing or its step is not in the verify chain; pnpm backlog:check passes | pinned | — |
| S84 | 5 | every check of every scripts/verify-S*.sh and verify-V*.sh is classed pinned or law in docs/v3/LAWS.md (laws enforced or proposed); no grader diffs a fixed base against the tree outside the story_* helpers | pinned | — |
| S84 | 6 | each grader edited after its story shipped is listed with its commits and either restored or kept with a reason | pinned | — |
| S84 | 7 | S60 re-verifies at its shipping commit with all 11 checks passing (ledger), and every done grader's result at its shipping commit is in the table | pinned | — |
| S84 | 8 | CLAUDE.md, .claude/skills/verify/SKILL.md and docs/v3/LOOP.md call a grader a commit-time proof and point to docs/v3/LAWS.md | pinned | — |
| S84 | 9 | backlog Status is done (story heading and Story status table) | pinned | — |
| V1 | 1 | backlog:vault --out writes one stories/S<N>.md per ### S<N> heading, same set | pinned | — |
| V1 | 2 | frontmatter fields present; priority/status match the table for every story; spot-checked optional fields | pinned | — |
| V1 | 3 | note body is the story section verbatim, with a generated banner | pinned | — |
| V1 | 4 | generator rejects table/section disagreement (colocated tests cover it) | pinned | — |
| V1 | 5 | generated files are read-only; two runs are byte-identical | pinned | — |
| V1 | 6 | Backlog.base defines a table view sorted by priority; Baseline.md holds the baseline table | pinned | — |
| V1 | 7 | .backlog-vault/ is gitignored | pinned | — |
| V1 | 8 | husky post-commit/post-merge/post-checkout run the generator and never fail git | pinned | — |
| V1 | 9 | audit.sh honors BT_AUDIT_LEDGER / BT_AUDIT_BACKLOG with unchanged defaults | pinned | — |
| V1 | 10 | scripts/backlog-vault vitest suite exits 0 | pinned | — |
| V1 | 11 | BACKLOG.md and scripts/verify-S*.sh unchanged since stage start | pinned | — |
| V1 | 12 | eslint passes on scripts/backlog-vault | pinned | — |
| V2 | 1 | --roundtrip --to assembles BACKLOG.md byte-identically (grader's own cmp) | pinned | — |
| V2 | 2 | round trip is byte-identical for BACKLOG.md at the last 5 commits that touched it | pinned | — |
| V2 | 3 | status table and bodies come from the notes: tampered priority re-sorts the row, tampered body line appears | pinned | — |
| V2 | 4 | any BACKLOG.md change since stage start is whitespace-only | pinned | — |
| V2 | 5 | grader-matched lines (status rows, story headings, Status lines) and verify-S*.sh unchanged | pinned | — |
| V2 | 6 | vitest suite exits 0 and includes a round-trip test | pinned | — |
| V2 | 7 | eslint passes on scripts/backlog-vault | pinned | — |
| V3 | 1 | one note per story ID, frame notes present, backlog:check exits 0 | law | enforced: L9 |
| V3 | 2 | temp copy: status edit fails check, build updates table row + Status line, Obsidian-style frontmatter normalizes | pinned | — |
| V3 | 3 | story note bodies carry no ### heading and no **Status:** line | pinned | — |
| V3 | 4 | lint runs backlog:check, test:coverage runs test:backlog (so verify + CI do); ci.yml unchanged | law | enforced: L9 |
| V3 | 5 | every verify-S*.sh exits 0; audit.sh S26 reverify works; grader-matched BACKLOG lines unchanged | pinned | — |
| V3 | 6 | rules 5/13/17, CLAUDE.md, both skills name docs/v3/backlog/ + backlog:build; no hand-sorting instruction | pinned | — |
| V3 | 7 | pre-commit builds + guards; V1 hooks/script/.backlog-vault references gone; .obsidian ignored | pinned | — |
| V3 | 8 | CHANGELOG.md mentions the Obsidian backlog | pinned | — |
| V3 | 9 | eslint and test:backlog pass | pinned | — |
| V3 | 10 | a backlog review entry landed after the V3 work commit | pinned | — |

## Graders edited after their story shipped

The owner, 2026-10-28: *"some of the graders were modified after the original commit of the story, and I want to either reverse those changes to match the pattern as if it had existed already OR record something that notes why we did NOT change them despite the updated system."* Commits after each story's completion entry (a backfill's `Shipped in` commit); a story's own checkpoints don't count.

| Grader | Commits | Decision | Why |
| --- | --- | --- | --- |
| S11 | `a854c28` | kept: per-check reporting retrofit | S13 moved every grader onto `scripts/lib/checks.sh` when the ledger began: each check is now declared and reported; what it checks is unchanged. A grader written under the pinned model would have had this form. |
| S12 | `a854c28` | kept: per-check reporting retrofit | As S11. |
| S21 | `a854c28` | kept: per-check reporting retrofit | As S11. |
| S14 | `707b595` | kept: wording only | "seam" became "recording path" in check names and comments (the owner's terminology); the checks test the same code and pass 6/6 at S14's shipping commit. |
| S15 | `d0f1950` | kept: the pinned model, early | Its `.github/` fence check was pinned to S15's own commit — the pattern this story makes standard. |
| S22 | `d0f1950`, `21e99c5` | kept: the pinned model, early; a bug fix | `d0f1950` pinned its `web/` fence check to S22's own commit; `21e99c5` fixed a false match in finding the reconstruction test, without changing what is proven. |
| S23 | `e2c6feb`, `a854c28` | restored | `e2c6feb` (S22's commit) loosened checks 3 and 7 so S23's grader would accept S22's later work (two more JSON-node types; S23 no longer asserting it leaves `diffpatch-823823.json` to S22). Reverted: S23's grader again proves S23 at its shipping commit, where it passes 10/10. `a854c28` kept (reporting retrofit, as S11). |
| S55 | `7e2818c` | kept: the pinned model, early | Scoped to S55's own amendment and manifest so later amendments in the same folder don't count — the pattern this story makes standard. |
| V3 | `5036023`, `f74767c`, `9ea8507`, `d0f1950` | restored | `f74767c` loosened check 5 so later backlog growth (new stories, re-numbered priorities) wouldn't turn it red, and `9ea8507` widened check 7 to a renamed pre-commit step; both reverted, and check 5 now reads `BACKLOG.md` at V3's own commit (`story_tip`). Kept: `5036023` (a pipefail flake fix) and `d0f1950` (expects S22 to pass once S22 was pinned). V3 passes 10/10 at its shipping commit. |
| S6, S27, S59, S60, S77, S80, S83, V1, V2 | this story (S84) | restored | Each compared a fixed base with whatever tree it ran in; now each compares the story's own commits (`story_diff` / `story_changed_files`). V3's check 4 likewise. |

## Re-verified at shipping commits

Each grader as it stands today, run by `scripts/reverify-all.sh` in a worktree at its story's shipping commit (S84 AC 7; re-run 2026-10-29 by S88 after `story_tip` moved to the ledger).

| Grader | Shipping commit | Result | Run |
| --- | --- | --- | --- |
| S11 | `c375ad5` | exit 0, 8/8 checks passed | 2026-10-29 |
| S12 | `fac27e9` | exit 0, 8/8 checks passed | 2026-10-29 |
| S13 | `a854c28` | exit 0, 6/6 checks passed | 2026-10-29 |
| S14 | `301e66a` | exit 0, 6/6 checks passed | 2026-10-29 |
| S15 | `641a84b` | exit 0, 8/8 checks passed | 2026-10-29 |
| S16 | `5d22182` | exit 0, 6/6 checks passed | 2026-10-29 |
| S17 | `571ead8` | exit 0, 5/5 checks passed | 2026-10-29 |
| S21 | `6c37778` | exit 0, 6/6 checks passed | 2026-10-29 |
| S22 | `e2c6feb` | exit 0, 10/10 checks passed | 2026-10-29 |
| S23 | `e7abf5e` | exit 0, 10/10 checks passed | 2026-10-29 |
| S24 | `3838547` | exit 0, 8/8 checks passed | 2026-10-29 |
| S25 | `3225a2d` | exit 0, 12/12 checks passed | 2026-10-29 |
| S26 | `38a52aa` | exit 0, 12/12 checks passed | 2026-10-29 |
| S27 | `dafeae8` | exit 0, 11/11 checks passed | 2026-10-29 |
| S29 | `a889c0e` | exit 0, 11/11 checks passed | 2026-10-29 |
| S30 | `f38bc8b` | exit 0, 5/5 checks passed | 2026-10-29 |
| S31 | `71526bf` | exit 0, 6/6 checks passed | 2026-10-29 |
| S32 | `71526bf` | exit 0, 6/6 checks passed | 2026-10-29 |
| S33 | `71526bf` | exit 0, 6/6 checks passed | 2026-10-29 |
| S34 | `71526bf` | exit 0, 6/6 checks passed | 2026-10-29 |
| S35 | `369d9b2` | exit 0, 5/5 checks passed | 2026-10-29 |
| S36 | `ff8f175` | exit 0, 6/6 checks passed | 2026-10-29 |
| S37 | `3a7cc26` | exit 0, 6/6 checks passed | 2026-10-29 |
| S38 | `6c4e48a` | exit 0, 5/5 checks passed | 2026-10-29 |
| S39 | `5a32130` | exit 0, 8/8 checks passed | 2026-10-29 |
| S40 | `97a7e94` | exit 0, 8/8 checks passed | 2026-10-29 |
| S42 | `32fd10b` | exit 0, 7/7 checks passed | 2026-10-29 |
| S43 | `f756072` | exit 0, 6/6 checks passed | 2026-10-29 |
| S44 | `5816edf` | exit 0, 6/6 checks passed | 2026-10-29 |
| S46 | `87de378` | exit 0, 6/6 checks passed | 2026-10-29 |
| S49 | `87a8375` | exit 0, 5/5 checks passed | 2026-10-29 |
| S52 | `58db7c2` | exit 0, 7/7 checks passed | 2026-10-29 |
| S53 | `208c9c3` | exit 0, 5/5 checks passed | 2026-10-29 |
| S54 | `1a12dfe` | exit 0, 5/5 checks passed | 2026-10-29 |
| S55 | `91e17ff` | exit 0, 5/5 checks passed | 2026-10-29 |
| S56 | `b29d151` | exit 0, 5/5 checks passed | 2026-10-29 |
| S57 | `8c31942` | exit 0, 5/5 checks passed | 2026-10-29 |
| S58 | `31818ce` | exit 0, 5/5 checks passed | 2026-10-29 |
| S59 | `ee5a151` | exit 0, 6/6 checks passed | 2026-10-29 |
| S6 | `3f88b15` | exit 0, 9/9 checks passed | 2026-10-29 |
| S60 | `74a93e0` | exit 0, 11/11 checks passed | 2026-10-29 |
| S7 | `6d15d98` | exit 0, 6/6 checks passed | 2026-10-29 |
| S76 | `e73b535` | exit 0, 6/6 checks passed | 2026-10-29 |
| S77 | `09babec` | exit 0, 7/7 checks passed | 2026-10-29 |
| S78 | `f2e4787` | exit 0, 5/5 checks passed | 2026-10-29 |
| S79 | `7c47359` | exit 0, 9/9 checks passed | 2026-10-29 |
| S8 | `43ab6dd` | exit 0, 7/7 checks passed | 2026-10-29 |
| S80 | `fb9c3bd` | exit 0, 9/9 checks passed | 2026-10-29 |
| S81 | `8df14d5` | exit 0, 8/8 checks passed | 2026-10-29 |
| S82 | `db449f3` | exit 0, 5/5 checks passed | 2026-10-29 |
| S83 | `6cf3289` | exit 0, 6/6 checks passed | 2026-10-29 |
| S84 | `21759bd` | exit 0, 9/9 checks passed | 2026-10-29 |
| S85 | `5cc6fd7` | exit 0, 6/6 checks passed | 2026-10-29 |
| S86 | `b103a9c` | exit 0, 5/5 checks passed | 2026-10-29 |
| S87 | `90ca849` | exit 0, 5/5 checks passed | 2026-10-29 |
| S88 | not shipped (this story) | — | 2026-10-29 |
| V1 | `961ac5a` | exit 0, 12/12 checks passed | 2026-10-29 |
| V2 | `dd4fc2a` | exit 0, 7/7 checks passed | 2026-10-29 |
| V3 | `3ee9e46` | exit 0, 10/10 checks passed | 2026-10-29 |
