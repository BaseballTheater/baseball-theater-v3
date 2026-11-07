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
| 7. Fresh-context reviewer | **Ready** | Process below (`/code-review` or Bugbot/security review) |
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

Loop output reaches `stage` only through pull requests, one per story (S121; owner, 2026-11-07: "I think releases to main probably should use GitHub releases, if that's actually possible. I want a release to be a set of PRs basically"; on who merges them: "1. You automatically"). Each story is committed on its own `story/S<N>` branch; the coordinator pushes it and opens its pull request into `stage`, handles Copilot's review (step 5 below), then turns on auto-merge (`gh pr merge --auto --merge`), so it merges once the required checks (`ci-passed`) pass, and the merge deploys `stage.baseball.theater`. Agents never push directly to `stage` or `main` and never merge into `main`. Each pull request is assigned to the next release's milestone, and a story is complete once that release is published. The coordinator publishes a release only when the owner says so; it deploys production and then fast-forwards `main` to the released commit, so `main` mirrors production ("2. Mirror"; CLAUDE.md → "The coordinator manages releases").

Before a story's pull request merges into `stage`:

1. Ensure `pnpm verify` is green on the branch (CI's `ci-passed` gates the auto-merge)
2. Run a **fresh-context** review (no prior loop transcript) when one is asked for:
   - Claude Code: `/code-review`
   - Cursor: Bugbot review and/or Security Review on the diff
3. Fix anything the reviewer flags that violates BACKLOG AC or CLAUDE.md, on the story's branch
4. Only then push the branch and open its pull request
5. Wait for Copilot's review, handle every comment (fix with a test, or reply why not, and resolve the thread), and only then turn on auto-merge; repeated feedback already handled doesn't hold it back (CLAUDE.md → "Copilot's review is handled before a pull request merges"; owner, 2026-11-07: "If Copilot continues giving the same feedback you can merge when you feel the real stuff is all handled")

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
