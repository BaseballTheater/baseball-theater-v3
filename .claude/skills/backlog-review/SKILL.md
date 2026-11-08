---
name: backlog-review
description: Re-evaluate docs/v3/BACKLOG.md against the current state of the repo and decide whether work may continue. Use when review debt is due (6 stories done since the last review, or any drift event), before starting the next story, or when a loop asks whether the plan is still right.
---

# Backlog review

`pnpm verify` proves the **code** is healthy. Nothing proves the **plan** is still healthy. Stories are written against a repo that no longer exists by the time they run: dependencies land, ADRs get accepted, a fence gets widened, a whole concern turns out to be missing. This review is the gate for that drift.

## When it is due

Due when **either** condition holds — whichever comes first:

| Trigger                                | Threshold                                                    |
| -------------------------------------- | ------------------------------------------------------------ |
| **Story count** (backstop)             | **6** stories flipped to `done` since the last logged review |
| **Drift event** (any one, immediately) | see below                                                    |

The story count was doubled from 3 by the owner on 2026-10-21; a single drift event still makes a review due at once.

**Drift events** — any of these means the backlog has already diverged from reality, so review before the next story rather than waiting for the count:

1. A **scope fence was widened** mid-run, or rule 10 stop-and-report fired.
2. A **turn cap** was hit or exceeded.
3. A story's **acceptance criteria had to be rewritten** to be runnable (BACKLOG rule: tighten the backlog, not just the code).
4. A **new ADR** was accepted in `docs/v3/ARCHITECTURE.md`, or an existing one materially changed.
5. A **new workspace package** appeared.
6. A story was **inserted or re-prioritized** outside a review — unless the owner directed it in the session and then said it needs no review (see below).
7. **`pnpm verify` itself changed** — the gate moved.

**A backlog change the owner directs in the session asks the owner whether it needs a review** (owner, 2026-10-29: "Change it so owner directed backlog changes trigger question about whether review is needed or not"). Apply and commit it with the owner's words, then ask. If yes, it is a drift event and the reviews run. If no, log it with `scripts/audit.sh skip backlog --commit <sha> --answers -` (and `skip parity` when it adds a story or changes a Source line), quoting the answer, so the debt scripts measure drift from it; the next review still checks it. A skip never resets the count of stories done since the last review — only a review does (owner, 2026-11-03: "Skip notes should not reset the counter").

**Applying the owner's answers to a review's questions is not a drift event.** It finishes that review. Log it with `scripts/audit.sh answers backlog --review <date of the review> --commit <sha> --answers -`, quoting the owner and naming what was applied. Only a change that goes beyond what the owner answered counts as drift. Without this rule, every review that asks a question would set up the next one.

Count triggers are cheap to satisfy and easy to ignore; the event list is the part that actually catches drift. Prefer over-reviewing to discovering a missing concern four stories later.

## Fresh context is required

Run this **without** the transcript that produced the stories being reviewed — a separate agent, a subagent, or a new session. An agent reviewing its own recent plan will confirm it. This mirrors the fresh-context reviewer pass in `docs/v3/LOOP.md` §7.

## The four checks

Run all four. Each produces findings or cited evidence — never a bare "looks fine."

### 1. Coverage — is anything missing?

Scope: the **next 3** stories by Priority with Status `todo`, plus the concerns they touch.

- Does the carried product loop have a gap that no story owns? Compare `docs/v3/FEATURES.md`, `VISUAL-DESIGN.md`, and the accepted ADRs against the Gap map (`docs/v3/backlog/frame/05 Gap map (doc → story).md`). Find the ADRs and the rest through `docs/v3/INDEX.md`, reading each by its line range, and read stories from their notes rather than `BACKLOG.md` (~1 MB).
- Did a recently accepted ADR create work that no story carries?
- Is a story about to be built on something that does not exist and is not a listed dependency?
- Is there a **Later theme** that recent work has promoted into a real blocker?
- Did the newest **doc parity review** entry in `docs/v3/AUDIT.md` queue items **For the next backlog review**? Answer each one in this review's findings, as an amendment or as a reason none is needed.

### 2. Ground truth — do the next stories still hold at HEAD?

For **each** of the next 3 stories:

- Every path named in its **Scope files** and acceptance criteria: does it exist at HEAD, or is its absence exactly what the story creates (red-first per rule 9)?
- Every command in its ACs: is it still the right command? (Package names, script names, and filters drift.)
- Every story in its **Depends on** / **Prefer after**: is it `done`?
- Its **turn cap**: is the stated assumption still true given what has landed since?
- Its **Goal condition** fence: can the ACs actually be met inside it? (This is what rule 10 exists to catch — catching it here is cheaper than mid-run.)

### 2b. Adversarial pass — try to break every acceptance criterion

Check 2 confirms a story's names exist; this check asks whether its plan holds. The goal is that Copilot finds nothing in the backlog's pull request (owner, 2026-11-07: "Our goal should be zero Copilot discoveries for each pull request"); on 2026-11-07 it found twelve real problems in the backlog pull request #10 after two reviews had passed it, all of this kind.

Scope: every acceptance criterion and note of the next 3 stories **and of every story inserted, re-scoped or rewritten since the last review**. For each, apply the [Copilot-class checklist](../../../docs/v3/LOOP.md#copilot-class-checklist) in `docs/v3/LOOP.md` §7 (LOOP.md holds the authoritative list; read it there, every time) reading the code each criterion touches at HEAD, not just its name.

Each finding names the **exact input or sequence that breaks the criterion** (for example "stopped after 13 failed days, the resumed run skips those days and never reaches 14") and becomes an amendment to that story. The ledger entry lists, for each story in scope, the checklist items that applied and what was checked; a story recorded with no items checked fails the evidence requirement below.

### 3. Prioritization challenge — the whole backlog, not just the next few

Argue **against** the current order, using what has changed since the last logged review:

- Does anything now block something above it?
- Did a dependency landing make a lower story cheap, or a higher story pointless?
- Is a story still the smallest thing that moves the carried loop (rule 4)?
- Has anything become obsolete, or been quietly done by another story?
- Do the `done` stories suggest a class of work being systematically underestimated?

**All backlog edits go to the notes, not `BACKLOG.md`** (it is generated): story text and fences in `docs/v3/backlog/stories/S<N>.md`, priority and status in that note's frontmatter, everything else (reviews, baseline, gap map, rules) in `docs/v3/backlog/frame/`. Run `pnpm backlog:build` after editing — it regenerates `docs/v3/BACKLOG.md` with the **Story status** table re-sorted from each note's `priority`, so re-prioritizing is just changing those numbers. A new story is a new note plus an `![[S<N>]]` line where it belongs in a frame note.

Check the **Current baseline** table (`docs/v3/backlog/frame/01 Current baseline.md`) against HEAD (rule 17): every **Done** row names something that exists, every `done` story since the **As of** line is reflected, and any amendment this review makes (insert, remove, re-scope) is reflected too. Fix drifted rows as part of the amendment.

### Duplication sweep (ADR-025)

Every backlog review also looks for **the same logic written more than once** — the failure ADR-025 exists to catch. Read the code the `done` stories since the last review added, and search for:

- Values derived from BT data computed outside `packages/domain` (in a view, handler, or test helper), or computed twice in different ways.
- Components, hooks, or helpers that do the same job under different names.
- `jscpd` output from `pnpm verify`, then the cases it cannot see: same meaning, different code.

Each hit becomes an amendment (a story or a re-scope that consolidates it), with both locations cited. Record "none found" only with the files and searches you checked.

### Personal-data sweep (ADR-028)

Every place BT keeps personal data must be in ADR-028's inventory and reachable by deletion. Code enforces most of it (the classification manifest in `functions/src/services/data-classification.ts`, the registry in `functions/src/services/personal-data.ts`, the repository contract's deletion case, and `bt/no-browser-storage`); this sweep covers what code can't see. For the next 3 stories, and for the code the `done` stories since the last review added:

- A story that adds a **table**, a **field** on a stored record, an **outside service**, a **browser key** or a **log line** must name its inventory entry: the row in ADR-028's inventory table (verbatim **Where**), the store registered in `personal-data.ts` that deletes it, and its manifest or `web/src/storage/` label. A store the table doesn't list is an ADR-028 amendment for the owner (`blocked`, not a new row).
- **Log lines** never carry email or other personal fields; check new `console.*` / logger calls in what was added.
- An **outside service** (Logto, Patreon, push, email) says how deletion reaches it and what only ages out there; **backup retention** changes say how the deletion log is re-applied.

Each miss becomes an amendment naming the story and the missing entry. Record "none found" only with the stories and files you checked.

### 4. Verdict — the call

| Verdict    | Meaning                                                  | Then                                           |
| ---------- | -------------------------------------------------------- | ---------------------------------------------- |
| `continue` | Next stories are sound as written                        | Log it, proceed                                |
| `amended`  | Backlog changed — tightened, inserted, or re-prioritized | Log it, **commit the amendment**, then proceed |
| `blocked`  | Needs a human decision (product call, scope conflict)    | Log it, **stop and ask**. Do not start a story |

## Evidence requirement (anti-rubber-stamp)

A `continue` verdict is only valid if the log entry records, for each of the next 3 stories, that check 2 was actually performed — the paths and commands looked at, and the dependency statuses — and, for every story in check 2b's scope, the checklist items applied and what was checked. A review with no findings and no cited evidence is not a review; treat it as not having happened.

Findings that are real but out of scope to fix now become **backlog amendments**, not chat commentary. Chat-only conclusions die at compaction.

## Log it

Append an entry to the verification ledger, `docs/v3/AUDIT.md`, and commit it with any amendment:

```bash
scripts/audit.sh review \
  --trigger "6 stories done since last review" \
  --since "S23, S21, S13" \
  --verdict amended \
  --findings -   # reads the findings body from stdin
```

The script records date, HEAD short SHA, tree state, trigger, stories `done` since, and the verdict; you supply the findings. It refuses a verdict with no findings, and exits nonzero on `blocked`.

That ledger defines "since the last review" — it holds the story completion entries too, so the counter reads off one file. Without the entry the next review has no baseline and the story counter cannot be trusted.

Then update the **Backlog reviews** scheduling notes (in `docs/v3/backlog/frame/00 Baseball Theater v3 — Checkable backlog.md`, then `pnpm backlog:build` to regenerate `docs/v3/BACKLOG.md`): what is now due next, and any drift the following review must weigh.

## Write scope vs. the doc parity review

This review never edits `docs/v3/INTENT.md`, `docs/v3/FEATURES.md`, or an existing story's `**Source:**` line. Those belong to the [doc parity review](../doc-parity-review/SKILL.md), and keeping the two scopes apart is what stops the reviews from triggering each other in a loop. A story this review **inserts** still needs a `**Source:**` line that passes rule 19: cite a feature FEATURES already names. If none fits, write `Open:` with the question for the owner. A pillar needs the owner's approval in this session. Inserting or removing a story, or re-scoping one that cites a pillar, makes a parity review due, which is intended. Other story edits don't.

## What this does not cover

- Code correctness — that is `pnpm verify` plus the fresh-context code review in `LOOP.md` §7.
- Whether the code a `done` story shipped is correct; that is the pre-PR review and `pnpm verify`. Whether a story's acceptance criteria hold up _is_ covered, by check 2b.
- Product decisions. Surface them as `blocked`; do not decide them.
- Whether the product docs still match the backlog: that is the [doc parity review](../doc-parity-review/SKILL.md) (`pnpm parity:debt`).

## Recipe maintenance

If a drift class slips through — a review said `continue` and the next story still went sideways — add the signal to the drift-event list above and to check 2, then note it in the review log entry that caught it. If Copilot finds a real problem in a backlog pull request this review passed, that is a miss of check 2b: add its class to the checklist in `docs/v3/LOOP.md` §7 in the same pull request as the fix.
