# Baseball Theater v3 — agent conventions

Clean-slate rewrite of baseball.theater. Planning docs in `docs/v3/` are the product/architecture source of truth. This file captures **how the code is actually written today**.

## Stack (locked)

- **pnpm** workspaces · **Node ≥ 24** (`.nvmrc`)
- **TypeScript** strict, ESM (`.js` extensions in relative imports)
- **Vitest** (+ coverage thresholds per package)
- **React 19 + Vite + Mantine 7** SPA (`web/`)
- **Cloudflare Workers + Durable Objects** (API, live games, cron, static assets) · **Neon Postgres via Hyperdrive** (all durable data) · **Logto** (identity) are the prod target (ADR-017–022); **local default is fixture MLB data + Postgres in Docker** (`compose.yaml`, Postgres 18 like Neon; `pnpm dev` starts and seeds it, S51), with PGlite for tests and the Node server — in-memory repos are test doubles only (no cloud required)
- Ports & adapters: domain/ports stay cloud-agnostic (ADR-012)

## Monorepo layout

| Path               | Role                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `packages/domain`  | Pure types + logic (no I/O). Coordinates, plays, entitlements, impact, window                        |
| `packages/ports`   | Interfaces only (`MlbStatsClient`, repos, auth)                                                      |
| `packages/mlb-api` | Upstream MLB Stats API types + zod parsers, leaf-path coverage diff, replay fold (no I/O)            |
| `functions`        | Ingest services, HTTP handlers, fixture/memory adapters, local Node server (→ Worker entry, ADR-017) |
| `web`              | Mantine SPA; fetches `/api/*` via Vite proxy                                                         |
| `fixtures/`        | Committed schedule/game/plays JSON for local + CI                                                    |
| `docs/v3/`         | INTENT / ORIGIN / FEATURES / VISUAL-DESIGN / ARCHITECTURE / BACKLOG / LOOP / AUDIT                   |
| `CHANGELOG.md`     | User-facing, impact-first record of what shipped (root, not `docs/v3/`) — see Agent / loop rules     |

Do **not** put Cloudflare, Postgres, Logto, or other platform SDKs (or Express) into `packages/domain`. Put cloud impls under `functions/src/adapters/`.

## Code style

- **Formatting is ESLint's job for `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`** (`eslint.config.js`, `@stylistic` rules) — tabs, Allman brace style (opening brace on its own line), double quotes, semicolons, trailing commas, 180-char lines. Prettier does not run on those extensions (`.prettierignore`) because it cannot express Allman brace placement; it still formats JSON/Markdown/YAML/CSS/HTML (`.prettierrc`: tabs at width 4, 120-char lines, no prose wrap; YAML gets 4 spaces since it cannot hold tabs). Recorded fixtures and the frozen OpenAPI baseline are excluded (`.prettierignore`); `pnpm api:spec` formats the spec with this same config. Run `pnpm lint --fix` rather than hand-formatting.
- `tsconfig.base.json` also carries `verbatimModuleSyntax` (type-only imports need `import type`), `noFallthroughCasesInSwitch`, `noImplicitOverride`, `allowUnusedLabels`, `noErrorTruncation` (no `experimentalDecorators` — ADR-024) — full `strict` + `noUncheckedIndexedAccess` + `moduleResolution: "Bundler"` stay as the safety/resolution baseline (not relaxed).
- Prefer small focused modules; match neighboring file patterns
- Named exports; avoid default exports except Vite/React entrypoints
- Domain functions are pure and unit-tested; keep thresholds high in `packages/domain`
- **MLB upstream types:** do **not** copy v2 `baseball-theater-engine` sources. Model the same _style_: named interfaces that reference each other, split by purpose (live / schedule / content / …). Avoid gigantic anonymous nested object types. Keep upstream types separate from BT product domain.
- Handlers stay thin: parse request → call service → `sendJson`
- **Comments are part of the code** (ADR-025): every exported function/type/component and every non-obvious block says _why_ and what it assumes; a change that makes a comment untrue updates it in the same commit
- **One implementation per calculation** (ADR-025): any value derived from BT data (e.g. pitches per inning) is one named, tested function in `packages/domain`; views, lists and notifications call it and only format. **Before planning code, search for an existing function/component/hook and reuse it** — record the reuse check in the story work
- Client state stays simple and followable (ADR-024): TanStack Query via named hooks, one Zustand settings store, `useState`/props otherwise — no proxy/observable, signal, or decorator-driven state
- Web: Mantine components, React Router routes in `web/src/routes.tsx`
- Do not add `useMemo`/`useCallback` by default (React Compiler-friendly)
- No drive-by refactors; no unsolicited markdown docs outside the task
- Prefer editing existing files over creating new abstractions

## Data & fixtures

- Schedule/game reads go through ports (`MlbStatsClient`, `ScheduleRepository`, `GameRepository`)
- Local/CI: `FixtureMlbStatsClient` reads `fixtures/schedule-*.json`, `fixtures/game-*.json`, `fixtures/plays-*.json`
- Play-level Statcast fields live on `GameSnapshot.plays` (`AtBat` / `PitchEvent` in domain)
- Pitch plate location uses `plateToStrikeZonePct`; trajectories use `samplePitchTrajectory` / kinematics — **not** v2’s hacky `%` formulas
- **Dev update flow:** after recording new fixtures (or periodically in season), run `pnpm mlb:scan-drift` — it diffs each raw payload against its parser and reports unmodeled paths to triage into typed fields or backlog stories. Offline by default; `BT_USE_LIVE_MLB=1 … --date= --game=` records a fresh game first
- **Live UX:** clients read BT only. Ingest cadence owns MLB pulls (ADR-002). Project upstream into durable BT store shapes before polishing UI. Watched-game updates go through a BT-mediated hub, never browser→MLB: per in-window game an ingest Durable Object writes Postgres then publishes to hub object(s) that push one-way over hibernated WebSockets (ADR-020); every update is versioned and applied only if newer, so duplicates are harmless (ADR-022); finished games are cached HTTP with graduated freshness (ADR-021)

## Testing

- Colocate `*.test.ts(x)` next to source
- Web tests: jsdom + `web/src/test/setup.ts` (mocks `matchMedia` for Mantine)
- Functions tests run in Node against fixtures, with memory repos as doubles or PGlite where they compose the app, and `*.workerd.test.ts` run the real Worker inside workerd via `@cloudflare/vitest-pool-workers` (`functions/vitest.workers.config.ts`, S45) — its `HYPERDRIVE` binding pointed at a migrated PGlite served over a socket (`functions/src/test/pglite-server.ts`, S51), so no Docker is needed in CI
- Coverage floors are enforced in each package’s `vitest.config.ts`
- **Truth gate:** `pnpm verify` (see `.claude/skills/verify/SKILL.md`)

## Quality automation

- Husky + lint-staged on commit (ESLint --fix + Prettier)
- CI (`.github/workflows/ci.yml`): lint → test:coverage → build
- `pnpm build` fails on lint

## Product boundaries (do not reintroduce)

Dropped from v2: featured/tagged video feeds, team pages, Chromecast, public playback catalog APIs, no-hitter bot, `/schedule` surface, Patreon-as-login. (PWA is back — installable at launch, ADR-023.)

Auth direction: Logto (email sign-in at launch, **no passkeys at launch**) behind identity ports; BT owns the user ID and session; Patreon = linked payments/tier only (ADR-019).

## Agent / loop rules

- **Read the docs from `docs/v3/INDEX.md` down** (owner, 2026-11-04: a cascading linked docs approach "whenever it is mostly lossless contextually"). It is generated (`pnpm backlog:build`) and lists every doc with its size, the line range of each section of the big ones (ADRs, backlog rules by number, frame notes), and every story by status with a link to its note. Open the smallest thing that answers the question and read only its line range. Never open `docs/v3/BACKLOG.md` or `docs/v3/AUDIT.md` whole: a story's text is its note, and a ledger entry is found through `docs/v3/audit.jsonl`.
- Work from `docs/v3/BACKLOG.md` stories; acceptance criteria must map to commands/tests
- **`docs/v3/BACKLOG.md` is generated — never edit it directly.** Its source is the Obsidian notes in `docs/v3/backlog/`: one `stories/S<N>.md` per story (frontmatter `title`, `table_title`, `priority`, `status` are authoritative; the body is the story text minus its heading and `**Status:**` line) plus `frame/` notes for everything around the stories. After any edit run `pnpm backlog:build`, and commit the notes and `BACKLOG.md` together. `pnpm backlog:check` (in `pnpm verify` and CI) fails when they diverge; the pre-commit hook rebuilds and rejects hand edits to `BACKLOG.md`.
- Update backlog **Status** in the same change set: `status: doing` in the story's note when you start, `status: done` when every AC passes (never leave it stale after finishing), then `pnpm backlog:build` before running the grader. The **Story status** table and its order are generated from each note's `status`/`priority` (IDs are labels, not order) — re-prioritize by editing `priority`, never by hand-editing the table. Keep the **Current baseline** table (`docs/v3/backlog/frame/01 Current baseline.md`) and its **As of** line in sync too (`docs/v3/BACKLOG.md` rule 17) — whenever a story flips to `done` or is inserted/removed/re-scoped.
- **UI waits for a ratified design** (`docs/v3/BACKLOG.md` rule 18). A UI story names its design stories on a `**Design:**` line and can't go to `doing` until they are `done` — `pnpm backlog:check` enforces it. On a design story (S31–S34), prepare `docs/v3/visual/<surface>/DESIGN.md` and **ask the owner to ratify**. Write `RATIFIED.md` only when the owner has explicitly told you, in the current session, to ratify that surface — **never assume a go-ahead**; without one, park the story. Never edit a ratified file (changes are ratified amendments), and never design a missing screen in code — stop and ask.
- **Design match review folder** (owner, 2026-10-30): when a story parks for a design match, run `pnpm design:review <ID>` — it puts each capture beside its ratified frame (amendment first) in the git-ignored `.designreview/<ID>/`, one PNG per frame — and point the owner there. After the verdict, `pnpm design:review <ID> --done` deletes that folder.
- **Capture every finished story in the ledger.** Run `scripts/audit.sh story <ID>` before committing: it runs the grader and `pnpm verify` for real and appends what they checked to `docs/v3/AUDIT.md`, which ships in the same commit as the code. Never hand-write a ledger entry. AUDIT.md is ~1 MB: find entries through its generated index `docs/v3/audit.jsonl` (one JSON line per entry with its `line`, `kind`, `story`, `verdict`) and read only that part; code that needs the ledger as data goes through `scripts/backlog-vault/ledger.ts`, its one parser. A `done` story with no ledger entry is not done.
- **A grader is a commit-time proof; laws hold forever** (S84; owner, 2026-10-28). A story's grader proves that story at its own commit: its scope checks look only at the story's own commits (`story_diff` / `story_changed_files` in `scripts/lib/checks.sh`), and `scripts/audit.sh story <ID> --reverify` runs it in a worktree at the shipping commit, never at HEAD. Until the story's shipping commit its grader may be updated when what the story must do changes (an amendment, an owner answer, a re-scope): re-run it red first, never loosen a check to pass code that misses its ACs, and record why in the commit and ledger (`docs/v3/BACKLOG.md` rule 7; owner, 2026-11-02: "This is generally how things should work, in case you want to write updated instructions to that effect - graders may be updated prior to being committed."). After it ships the grader is frozen. Whatever must hold on every commit is a **law** in `docs/v3/LAWS.md`, enforced by `pnpm verify`; adding, changing or removing one is the owner's decision. Record a design verdict on its own with `scripts/audit.sh design <ID> --design-match -`.
- **Every story states an Impact** (`docs/v3/BACKLOG.md` rule 15): right after **Gap**, one or two plain-language sentences — what was true before, what's different after. No jargon required to follow it. Not a graded AC (a backlog review spot-checks it); it's the raw material for the story's `CHANGELOG.md` entry.
- **A `done` story updates `CHANGELOG.md` in the same commit** (rule 16): an impact-first headline (understandable without technical background, even for a dev-only change — frame it by who benefits and how) plus a short **Details** line naming the story ID for anyone who wants the technical trail. Nest under a bold effort header only when the story is clearly one part of a larger push already reflected there; a standalone change gets its own bullet. Skip only for stories with nothing a reader outside the team would call an outcome (e.g. a pure grader-script fix) — default to including it.
- **Reject starting the next story/goal** if the prior finished story is still uncommitted — commit first (or stop and ask the user). Uncommitted “done” work is incomplete for sequencing.
- **Re-evaluate the backlog when review debt is due — before starting the next story.** Due when **6** stories (story count doubled from 3 by the owner, 2026-10-21; a single event still triggers it) have flipped to `done` since the last review entry in `docs/v3/AUDIT.md`, **or** immediately on any drift event: a scope fence widened, a turn cap hit, ACs rewritten mid-run, a new ADR accepted, a new workspace package, a story inserted/re-prioritized outside a review, or `pnpm verify` itself changed. **A backlog change the owner directs in the session asks the owner whether it needs a review** (owner, 2026-10-29: "Change it so owner directed backlog changes trigger question about whether review is needed or not"; earlier the same day, running both reviews after a small one "Seems unnecessary"). Apply it with the owner's words quoted, commit it, then ask — **unless a review is already due by story count**: then don't ask; run that one review and let it cover the change (owner, 2026-10-29: "in the future if a review is due because of the number of stories that have been completed, you don't need to ask whether one is due for another reason, you can just run it"; and "Do one backlog review, not two"). **Yes:** it is drift — run the reviews as usual. **No:** log a skip — `scripts/audit.sh skip backlog --commit <sha> --answers -` (and `skip parity` when it adds a story or changes a `**Source:**` line), quoting the "no" — and the next scheduled or drift-triggered review still checks it. A skip clears only that drift event: it never resets the count of stories done since the last review, so a count already at 6 stays due (owner, 2026-11-03: "Skip notes should not reset the counter, they should just avoid incrementing it, and if the counter is already at the target, the skip should leave the counter as it is so the next time triggers the review"). Procedure: `.claude/skills/backlog-review/SKILL.md`. Run it with **fresh context** (an agent that wrote the stories will rubber-stamp them). The review checks the next 3 stories for missing work and against HEAD, argues against the whole backlog's priority order, then records `continue` / `amended` / `blocked` in `docs/v3/AUDIT.md` via `scripts/audit.sh review`. **`blocked` means stop and ask.** A `continue` with no cited evidence does not count as a review.
- **Every story says what it is for** (`docs/v3/BACKLOG.md` rule 19). Its `**Source:**` line cites a **feature** in `docs/v3/FEATURES.md` whenever one applies. Only if none does, it cites a **pillar** in `docs/v3/INTENT.md`, and only after the owner explicitly approves that citation in the current session, quoted in the line. Never assume approval. If neither fits, it is `Open:`: ask the owner whether to do it and why, and never invent a feature or stretch a pillar to fit. When the owner describes a new feature, edit FEATURES in their words **in the same change set** as the story that cites it. `pnpm backlog:check` enforces the form.
- **Ratified designs feed the backlog through a design intake review** (`.claude/skills/design-intake-review/SKILL.md`): due when a surface is ratified or amended, or a frontend ADR changes. It treats drawn screens/components/states as features, maps them to stories, plans the shared component layer, and slices what nothing builds. Fresh context; two independent reviewers merged for a full intake. It is a backlog review (same write scope and ledger entry).
- **Doc parity debt is checked before starting the next story**, alongside review debt: run `pnpm parity:debt` (due on any single change event, or at **6** stories `done`). If it is due, run `.claude/skills/doc-parity-review/SKILL.md` with **fresh context** and commit its edits together with its `scripts/audit.sh parity` entry. `blocked` means stop and ask. The two reviews have separate write scopes so they can't trigger each other in a loop: the parity review edits only INTENT, FEATURES, and `**Source:**` lines; the backlog review edits everything else in the backlog. **Applying the owner's answers to a review's questions finishes that review; it is not new drift.** Log it with `scripts/audit.sh answers backlog|parity --review <date> --commit <sha> --answers -`, quoting the owner. Only changes beyond the answers count toward the next review.
- `docs/v3/ORIGIN.md` is the frozen origin story (goals G1–G5, clean-slate framing). Edit it only to correct the historical record. What the product is now lives in INTENT.
- Never deploy to production (Cloudflare `wrangler deploy` to prod, production Neon branches, the production Logto tenant), never force-push `main`, never commit secrets
- **Push as part of finishing a story** (owner, 2026-11-02: "we should be pushing as part of completing stories"): once a story's commit lands (`done`, or a parked checkpoint), push `main`. **Check GitHub Actions before every push** (owner, same day: "we should be checking the status of GH actions prior to pushing"): `gh run list --branch main --limit 1`. If the latest run failed and the commits being pushed don't fix it, find out why (`gh run view <id> --log-failed`) and fix it first, or stop and ask; never push on top of a red `main` without saying so. After pushing, watch the new run (`gh run watch <id> --exit-status`, in the background) and treat a failure as the next thing to fix. Under `/run-stories` the run pushes once, after its last story (owner, same day: "if we're using run-stories, we don't have to push until they are all done").
- Ask before any other `git push`, PR creation, or changing CI/deploy workflows unless the user explicitly requested it
- Prefer fixture/local adapters over live MLB/Patreon unless the story says otherwise

## `/goal <ID> done` shorthand

Story IDs in `docs/v3/BACKLOG.md` are `S` + digits (`S1`…`S29`, case-insensitive here) — stable labels, not priority order. Each story's `### S<N> — …` section holds a **`/goal` command** block: a fenced ` ```text ` block with one line, `/goal docs/v3/BACKLOG.md S<N>. …`. The text on that line is the real completion condition; the story's **Acceptance criteria** list is what `scripts/verify-S<N>.sh` checks.

When the goal you are handed is just a story ID plus `done` (e.g. `/goal S27 done`):

1. Open the story's note, `docs/v3/backlog/stories/S<N>.md`: its body is the story's `### S<N> — …` section of `docs/v3/BACKLOG.md`, word for word (don't open BACKLOG.md whole — it is ~1 MB). Begin your first response with `Goal for S<N>:` then, quoted **word for word**, that story's `/goal …` line followed by its full **Acceptance criteria** list (including nested bullets).
2. If there is no note (no `### S<N> —` heading) for the ID, or the story has no **`/goal` command** block, say so plainly and stop — do not guess what the story means.
3. Work toward the quoted text, not a paraphrase.
4. Never edit a story's `/goal` line or acceptance criteria — in its note `docs/v3/backlog/stories/S<N>.md` or anywhere they are generated (`docs/v3/BACKLOG.md`, rebuilt by `pnpm backlog:build`) — to make them easier to satisfy.
5. When you believe you are finished, end with a section headed `S<N> verified:` listing every clause of the quoted `/goal` line and every acceptance criterion, each with concrete evidence from this session (grader/test output, command exit codes, file contents). Do not mark a clause passed without showing the evidence.

This composes with the Agent / loop rules above — the grader, `scripts/audit.sh` ledger entry, and review-debt gate still apply.

## Commands

```bash
pnpm install
pnpm dev          # API :8787 + web :5173
pnpm verify       # lint + coverage tests + build (single exit code)
pnpm test         # vitest without coverage thresholds path used by CI
pnpm lint
```
