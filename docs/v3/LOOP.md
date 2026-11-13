# Loop-ready automation guide

How to run Baseball Theater v3 with goal/loop agents without relying on chat memory.

## Checklist status

| Step | Status | Evidence |
|------|--------|----------|
| 1. Clean baseline + tag | **Done** | `git status` clean at tag `loop-baseline` (pre-scaffold) / post-scaffold commit |
| 2. Single exit-code verify | **Done** | `pnpm verify` · recipe `.claude/skills/verify/SKILL.md` |
| 3. Conventions recovered | **Done** | `CLAUDE.md` (edit if wrong) |
| 4. Checkable backlog | **Done** | `docs/v3/BACKLOG.md` |
| 5. Permission boundaries | **Done** | `.claude/settings.json` + `.cursor/rules/agent-boundaries.mdc` |
| 6. Pilot one story | **Ready** | S1 prompt in BACKLOG — **you** run/watch first `/goal` |
| 7. Fresh-context reviewer | **Ready** | Process below: a fresh-context pre-PR review with the review-class checklist, on every pull request, then Claude's review (`.github/workflows/claude-review.yml`) |
| 7b. Backlog review cadence | **Ready** | `.claude/skills/backlog-review/SKILL.md` · log in `docs/v3/AUDIT.md` |
| 7c. Verification ledger | **Done** | `scripts/audit.sh` → `docs/v3/AUDIT.md` (story + review entries) |
| 8. Scale then unattended loop | **Not yet** | Only after S1–S2 succeed observed |

## 1 — Baseline

```bash
git status          # clean
git tag -l loop-baseline
```

Rollback if a loop trashes the tree:

```bash
git switch -C recovery loop-baseline
```

## 2 — Verify

```bash
pnpm verify
```

Non-zero ⇒ not done. Details: `.claude/skills/verify/SKILL.md`.

**Capture it.** `pnpm verify` prints and forgets. Every finished story and every backlog review gets an entry in the ledger, `docs/v3/AUDIT.md`, written by `scripts/audit.sh` — never by hand:

```bash
scripts/audit.sh story S14            # grader + pnpm verify, captured verbatim
scripts/audit.sh review --verdict …   # a review pass, event-triggered or manual
scripts/audit.sh story S14 --reverify # today's grader at S14's shipping commit
scripts/audit.sh design S79 --design-match -  # an owner's design verdict on its own
```

**Two tiers (S84).** A story's grader is a **commit-time proof**: it proves that story at its own commit and is never expected to hold for the whole system later. What must hold on every commit is a **law**, listed in `docs/v3/LAWS.md` and enforced by `pnpm verify`.

The ledger is the only durable record of *what was actually checked*: which of the story's checks ran, whether they passed, and the commit the story shipped in. It is also what the review cadence counts off — "6 stories since the last review" reads from that one file.

## 3 — Conventions

Read and correct `CLAUDE.md` once. Anything you disagree with must be written there; chat-only preferences die at compaction.

## 4 — Backlog

Work only from `docs/v3/BACKLOG.md`. If a criterion is ambiguous mid-run, **tighten the backlog**, then re-run — don’t just patch code.

**Status is part of done:** set the story to `doing` when you start and to `done` when all acceptance criteria pass. Commit that status flip with the implementation, and keep the top **Story status** table in sync. A green `pnpm verify` with Status still `todo` is incomplete.

**Commit before the next goal:** if the prior story is marked done (or claimed complete) but its changes are still uncommitted, **do not start the next story**. Refuse to move on until that work is committed (or the user explicitly overrides). Check with `git status`.

**Review the plan, not just the code:** `pnpm verify` proves the code is healthy and says nothing about whether the backlog is still right. Every **6** `done` stories — or immediately on a drift event (fence widened, turn cap hit, ACs rewritten mid-run, new ADR, new package, out-of-review re-prioritization, `pnpm verify` changed) — run `.claude/skills/backlog-review/SKILL.md` with **fresh context** and log the verdict in `docs/v3/AUDIT.md` (`scripts/audit.sh review`). `blocked` stops the loop. This is the plan-side counterpart to §7's reviewer pass.

## 5 — Boundaries

Claude Code: `.claude/settings.json` (`permissions.deny` / `ask`).

Cursor: `.cursor/rules/agent-boundaries.mdc` (always apply).

Also enable **worktree isolation** for unattended runs so agents don’t mutate your dirty working tree.

## 6 — Pilot (do this next, watched)

Use the S1 prompt in BACKLOG. Watch stalls/overreach. Do not walk away on the first run.

## 7 — Reviewer pass

Loop output reaches `stage` only through pull requests, one per story (S121; owner, 2026-11-07: "I think releases to main probably should use GitHub releases, if that's actually possible. I want a release to be a set of PRs basically"; on who merges them: "1. You automatically"). Each story is committed on its own `story/S<N>` branch; the coordinator pushes it and opens its pull request into `stage`, handles Claude's review (step 5 below), then turns on auto-merge (`gh pr merge --auto --merge`), so it merges once the required checks (`ci-passed`) pass, and the merge deploys `stage.baseball.theater` (unless it changes only docs, which deploys nothing). Agents never push directly to `stage` or `main` and never merge into `main`. Each pull request is assigned to the next release's milestone, and a story is complete once that release is published. The coordinator publishes a release only when the owner says so; it deploys production and then fast-forwards `main` to the released commit, so `main` mirrors production ("2. Mirror"; CLAUDE.md → "The coordinator manages releases").

Before any pull request opens or merges into `stage` (a story, a backlog change, a fix, a rule change):

1. Ensure `pnpm verify` is green on the branch (CI's `ci-passed` gates the auto-merge)
2. Run a **fresh-context pre-PR review** (no prior loop transcript) on the branch's whole diff, **every time**, for every pull request (a story, a backlog change, a fix, a rule change): the goal is that Claude's review finds nothing (owner, 2026-11-07, of Copilot's review, which Claude's replaced on 2026-11-11: "Our goal should be zero Copilot discoveries for each pull request"). The reviewer reads every changed file in full, applies the [review-class checklist](#review-class-checklist) below to each change (for a backlog change, to every acceptance criterion it adds or rewrites), and reports each finding with the **exact input or sequence that breaks it**, as Claude's review does. "Looks fine" without the checklist items it checked is not a review.
   - **Parallel reviewers, one per slice** (owner, 2026-11-08, asked whether reviews could be "conducted by multiple subagents in tandem, orchestrated by the main agent, rather than multiple passes": "Yes, make that change"). The coordinator starts these fresh-context `general-purpose` subagents at once, each given this section, the branch's own diff (`git fetch origin`, then `git diff <base>...HEAD`, where `<base>` is the branch it was cut from: `origin/stage`, or for a stacked `story/S<N>` the earlier story's branch) and one slice of the checklist to own:
     - **correctness and edge cases:** checklist items 1, 2, 3, 4, 5, 12, 13 and 15
     - **contracts and every caller:** items 6, 7, 8, 14 and 16, plus every port, adapter, test double, script and caller of anything whose behavior changes
     - **tests and the grader:** item 12's edges are tested, and no test or grader check would pass on broken code
     - **docs and records:** items 9, 10, 11, 17, 18 and 19, plus comments, specs, `CHANGELOG.md`, the baseline and the ledger

     Each still reads every changed file and reports anything it sees outside its slice. The coordinator merges the reports and drops duplicates. A docs-only diff, or one under about 100 changed lines, may get one reviewer covering all four slices.
   - `/code-review` with the checklist can stand in for the reviewers.
   - Cursor: Bugbot review and/or Security Review on the diff
3. **Fix every real finding in one pass, plan first** (owner, 2026-11-08, on "the plan for the fix was reviewed before implementation", the fixes "pre-reviewed before commit by a subagent", and a post-fix review that "only looked at changes": "Yes, make that change"):
   1. One fresh-context worker gets every merged finding and writes a short plan without changing code: the approach for each finding, the files it touches, every caller or contract it changes, and the test that fails without each fix.
   2. A fresh-context reviewer checks the plan for what it would break (a shared contract changed, a caller missed, a test that wouldn't fail). The worker revises it until the reviewer finds nothing.
   3. The worker builds it (a test that fails without the fix, for code) and leaves it uncommitted.
   4. A fresh-context reviewer checks only the uncommitted changes (`git diff`, plus each new file listed by `git ls-files --others --exclude-standard -- :/`, read in full; the index is left alone) plus every caller of anything whose behavior they change, with the checklist. A strict changed-lines review misses a caller that relied on the old behavior. The worker fixes what it finds, and the review repeats on the new changes until it finds none.
   5. Only then does the worker run `pnpm verify`. Any change made to get it green goes back through step 4 before the commit. Then, for a `done` story, it runs `scripts/audit.sh story S<N>` (never for a parked checkpoint, which has no ledger entry until it's finished) so the ledger names the commit that ships (`--reverify` finds the shipping commit from that entry), and makes one commit for all the fixes.

   **Who runs it.** The coordinator (the session's own agent, or `/run-stories`' coordinating thread) runs each round and passes the plan, the verdicts and the findings between fresh-context subagents. The worker that wrote the plan gets the reviewer's verdict back (`SendMessage`), or a new worker is briefed with the plan and the verdict. For a pull request that isn't a story (a rule, backlog or fix change), the session's agent may be the worker itself, but each review is still a fresh-context subagent. After the fix commit, the coordinator checks that `git status` is clean and `git log -1` names it. **Exit:** if a plan or change review repeats a finding already handled, or three rounds pass without coming back clean, a fresh-context arbiter gets the open findings and the code and rules on each (owner, 2026-11-08, on stopping to ask: "Why do you need to ask me if the loop exits"). A finding it rules not real is answered with its reason and the work goes on. One it rules real but still unfixed **holds** the story:
   - **Before its pull request opens:** its uncommitted fix work is thrown away (`git restore .` and removing the new files `git ls-files --others --exclude-standard -- :/` lists), so the tree is clean. Its branch keeps its commits and is not pushed. Its note, `CHANGELOG.md`, baseline and ledger aren't edited, since nothing on an unpushed branch reaches `stage`; whoever finishes it later fixes the findings on that branch. The run doesn't pick it again. Every story the run starts after it is cut from the nearest earlier story that isn't held, or `origin/stage`, and is reviewed against that branch.
   - **While Claude's review comments are being fixed (step 5):** its pull request is already open. Auto-merge stays off and the pull request gets a comment naming the open finding. The branches stacked on it aren't pushed; they wait, unpushed, until it is fixed.
   - Either way, the run summary lists it under **Parked** with its open findings, and lists every branch waiting on it.

   A finding that needs an owner decision (an AC that can't be met as written, a scope or fence call) is asked. So is any call the arbiter judges too impactful to make itself (owner, 2026-11-08: "The arbiter can also use its judgement to decide the call is too impactful for it to decide and escalate to me"). The story is held the same way, and the question goes in the run summary with what each answer would lead to.
4. Only then push the branch and open its pull request
5. Wait for Claude's review (its "Claude review of <head sha>:" summary review, with that `commit_id`, appears; the workflow runs on `pull_request_target`, so its check is on the base branch's commit, not the head's), handle every comment (fix it through step 3's fix flow, steps 3.1–3.5, or reply why not, and resolve the thread), and only then turn on auto-merge; repeated feedback already handled doesn't hold it back (CLAUDE.md → "Claude's review is handled before a pull request merges"; owner, 2026-11-07, of Copilot's review, whose rule Claude's kept on 2026-11-11: "If Copilot continues giving the same feedback you can merge when you feel the real stuff is all handled"). A review run that fails is re-run, and a pull request never merges without a finished review of its newest commit; if it still can't run, stop and ask the owner. **Every real finding of Claude's review is a miss of step 2:** besides fixing it, add its class to the checklist below (or sharpen the item that should have caught it) in the same pull request, so the next review catches it

### Review-class checklist

What the pull request review (GitHub Copilot's until 2026-11-11, Claude's since) and the 2026-11-07 ultrareview of `stage` caught after our own reviews passed. Claude's review (`.github/workflows/claude-review.yml`) uses this list as its method too. Each item is a question to ask of every change; answer it with the input that breaks the change, or with why none can.

1. **Interrupted work.** A stop, crash or error between two writes or two steps (a snapshot written but not its projection): what is left behind, and does the next run detect and repair it, without redoing finished work?
2. **State that must survive a restart.** Every counter, streak, cursor or "given up" flag a resumed or retried run depends on is persisted, not rebuilt from what the run skips. It stays right for a later run over any range, not only a resume of the same one, and a merge or join rule that keeps an old terminal state (a give-up) must not swallow newer data that should reach its own terminal state: newer days count on their own instead of being folded into the old state and never moving it. Caught by Claude's review of PR #46.
3. **Partly present data.** A range or collection that is empty, partly stored, or stored but stale: each case says what happens (fill only what's missing, refresh what's stale), and a "nothing yet" answer is told apart from "zero".
4. **The real source of truth.** A value is read from the store that actually holds it for every case (a day's schedule summaries hold games a `games` row doesn't exist for yet).
5. **Unsettled states.** Live, scheduled, postponed or suspended items are never treated as finished (today is never "done" while its games are live).
6. **ADR conformance.** Routes under `/api/v1/` (ADR-015), with `:name` path parameters as in `packages/domain/src/api-routes.ts`; freshness from `cacheLifetimeMs` by last change, not by "past vs current" (ADR-021); version-guarded writes (ADR-022); one named implementation per calculation (ADR-025); personal data in the inventory (ADR-028).
7. **Upstream request budget.** A read path or loop that fans out to MLB (per-day requests, `fetchGame`'s three extra calls) has a bounded request count and fits a Worker's subrequest limit; a range request beats one per item.
8. **Import side effects.** Reusing a helper never imports a module whose top level runs a script (seeding, migrating, guards); move the helper to an import-safe module.
9. **Generated files inside the fence.** Every file the work regenerates (`docs/v3/BACKLOG.md`, `docs/v3/INDEX.md`, `docs/v3/audit.jsonl`, `openapi/`, `web/src/api/generated/`, the types fidelity test) is inside the story's scope files, Goal condition and `/goal`.
10. **Structured lines read by parsers.** Text a script parses (a **Depends on** line makes every story ID on it a hard dependency) says only what it should; preferences go on **Prefer after**.
11. **Contradictions inside a story.** No AC requires what another AC or note forbids (existing tests "pass unchanged" while the behavior they test is removed).
12. **Boundaries.** Inclusive ranges and their edge days, time zones (`mlbToday`), the earliest and latest allowed values, and each tested.
13. **Untrusted stored values.** Browser storage can throw (blocked site data, private modes) and can hold stale or out-of-range values (a clock corrected backwards): keep an in-memory fallback, and bound what is read back.
14. **Matching too broadly.** A glob, prefix or pattern matches only what it should (a `settings-*` override must not swallow frames another amendment draws).
15. **Shared state between unrelated features.** One flag or key serving two features (one snooze hiding both the update notice and the retired-version notice) is split, or the coupling is intended and said.
16. **What a tool actually sees.** A tool that changes the working tree before it runs (claude-code-action puts the base branch's `CLAUDE.md` and `.claude/` back on disk) or reads from a checkout other than the one meant (a pull request's merge ref, not its head): every step that reads those files reads the version it means to, and says how (`git show <sha>:<path>`). Caught by Claude's review of PR #29.
17. **A structured value says what its label says.** A ledger row, table cell or field filled from an argument holds what its label names, checked against the source it summarizes (a "Stories `done` since last review" row given the review's scope listed `todo` stories as done). Caught by Claude's review of PR #31.
18. **Work the same change set already did isn't still queued or still contradicted.** No later AC, note, Impact, turn cap or frame bullet asks for, schedules, or still describes as true what the change set itself made or settled (wording fixed in FEATURES left in a story's Impact; a turn cap still justified by work an AC dropped) (an AC still requiring a story to add a FEATURES quote the parity review had added; a frame bullet sending finished FEATURES edits to the next review), and no sentence says both that a story owns a fix and that none does. Caught by Claude's review of PR #31.
19. **Splices keep their sentence boundaries.** Text inserted into an AC or rule still reads as the sentences it was (a lost full stop ran an AC's two requirements into one). Caught by Claude's review of PR #31.

## 8 — Scale → loop

| Stage | When | How |
|-------|------|-----|
| Multi-story `/goal` | After S1 clean under watch | Cap turns; still require `pnpm verify` |
| `/loop` while you’re around | After 2–3 stories boringly succeed | Pick next `todo` from BACKLOG |
| Scheduled / cloud unattended | After verify + backlog prove solid | Only with worktrees + deny rules |

Do **not** jump to unattended loops while criteria still need human eyes.

## Habit

Every failure mode the loop missed → new test or verify step + BACKLOG/skill update.

**MLB API drift:** Periodically (and after recording new fixtures) run the capability scanner from backlog **S15** (`pnpm mlb:scan-drift` once it exists). Newly available paths should become typed fields and/or backlog stories — don’t let Stats API growth go unnoticed.
