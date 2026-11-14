---
name: doc-parity-review
description: Check that the product docs (INTENT, FEATURES) still describe what the backlog and shipped code are — every story's **Source:** is honest, open questions reach the owner, and no doc has become a relic of an old plan. Use when `pnpm parity:debt` says a review is due, before starting the next story, or when asked whether the docs still match the plan.
---

# Doc parity review

A [backlog review](../backlog-review/SKILL.md) asks whether the **plan** still holds against the repo. This review asks whether the **docs that justify the plan** still say what is being built. INTENT and FEATURES are the source of truth for future sessions, so a doc that drifts from the backlog is worse than no doc: the next agent will trust it.

Rule 19 in `docs/v3/BACKLOG.md` is the contract. Every story's `**Source:**` line cites, in order of preference, a **feature** in FEATURES, an owner-approved **pillar** in INTENT, or an **open** question for the owner. `pnpm backlog:check` already proves each citation _resolves_. This review checks that it is _honest_.

## When it is due

`pnpm parity:debt` exits 1 and says why when, since the commit that logged the last parity review or the owner's answers to it:

- a product doc changed (INTENT, ORIGIN, FEATURES, VISUAL-DESIGN, ARCHITECTURE),
- a story note was added or removed,
- a story's `**Source:**` line changed,
- a **pillar-cited** story's Gap, Impact or acceptance criteria changed (the approval may no longer cover it), or
- **6** stories went `done` (doubled from 3 by the owner, 2026-10-21; any single change above still makes it due).

Other story-text edits don't count: a feature citation is checked against FEATURES, not the story text, and a pillar story's scope list, goal-line paths, work items or notes don't change what it is for (owner, 2026-10-23).

Do not start a story while it is due. Run it with **fresh context** (a separate agent or session; as a subagent, the `doc-parity-reviewer` agent type, which loads this skill). An agent that wrote a story will defend its citation.

## Write scope: this is what prevents thrash

You may edit **only**:

- `docs/v3/FEATURES.md` and `docs/v3/INTENT.md`
- the `**Source:**` line of story notes in `docs/v3/backlog/stories/`, plus `docs/v3/BACKLOG.md` via `pnpm backlog:build`
- `docs/v3/AUDIT.md`, via `scripts/audit.sh parity` only

And only to **record a decision the owner has already made**: their words in this session, a story they asked for, or a commit or ledger entry that records their call. Cite it in the finding. Never write product intent yourself.

Never touch story text, priorities, statuses, ACs, ADRs (`ARCHITECTURE.md`), ratified designs, `ORIGIN.md` (frozen except to correct the historical record), or anything in `pnpm verify`. Those are backlog-review or owner territory. Because of these limits, a parity review can never cause a backlog-review drift event.

## The checks

Each check produces findings or cited evidence, never a bare "looks fine".

### 1. Citation honesty

Scope: every story `pnpm parity:debt` named, plus the next 3 `todo` stories by priority.

- **Feature citations.** Read the cited FEATURES row or theme next to the story's Gap and Impact. Does the feature actually describe what the story delivers, or does the story just sit near it? A story citing a broad theme (e.g. "Robust core") for something specific is a finding.
- **Pillar citations.** Is there really no feature that applies? A pillar where a feature fits usually means FEATURES is missing something. Does the `Approved by owner` quote match a real owner decision? Look for it in the session, the commit, or the ledger. Has the story been re-scoped since that date (`git log -p` on the note)? If so, the approval no longer covers it, so set the line back to `Open:` and ask again.
- **Open questions.** List every `Open:` story. Each one goes to the owner.

### 2. Doc reflects reality

- Does FEATURES describe what `done` stories actually shipped? Look for carry/cut verdicts, "TBD"s, and open product questions that the backlog has since settled.
- Does any FEATURES or INTENT statement contradict a story, or another doc (VISUAL-DESIGN, ARCHITECTURE)? Name both sides.
- Is any FEATURES entry now a relic: a theme nothing serves, or one the owner has walked back?

### 3. Coverage for the backlog review

Look for FEATURES items no story serves, and for features you added this review. Do **not** write stories for them. Put them in the ledger entry under **For the next backlog review**; the next backlog review must answer each one.

## Verdict

| Verdict    | Meaning                                                                                                           | Then                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `continue` | Every citation checked holds, and the docs match                                                                  | Log it, commit, proceed                          |
| `amended`  | Docs or `**Source:**` lines updated to record decisions the owner already made                                    | Log it, commit edits **with** the entry, proceed |
| `blocked`  | An `Open:` story is next up, an approval is void, or doc and backlog conflict and no recorded decision settles it | Log it, **stop and ask the owner**               |

When asking, batch the questions. For each story the question is: should we do this, and why? Is there a feature you have in mind that FEATURES doesn't describe? Offer the concrete choices: describe the feature (FEATURES gets it in the owner's words, and the story cites it), approve the proposed pillar (the `Approved by owner` line quotes them), or drop the story.

## Log it, in the same commit as the edits

```bash
scripts/audit.sh parity \
  --trigger "S40 inserted; FEATURES.md changed" \
  --since "S23, S21" \
  --verdict amended \
  --findings -   # stdin; include a "For the next backlog review" list when there is one
```

Commit the ledger entry **together with** every edit the review made. `pnpm parity:debt` measures from the commit that added the entry, so anything committed after it counts as new drift, and the review would trigger itself.

If the verdict was `blocked`, applying the owner's answers is part of finishing this review, not new drift. Log it in the same commit as the edits:

```bash
scripts/audit.sh answers parity --review <date of this review> --answers -   # quote the owner, then what was applied
```

Anything beyond what the owner answered is new drift and waits for the next review.
