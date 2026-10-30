---
name: run-stories
description: Work through the backlog in priority order — the next N stories (default 10) — parking any story that gets blocked and moving on to the next one whose dependencies are all done. Use when the owner types /run-stories [N], or asks to loop the next stories and skip past blocked ones.
---

# Run stories

The owner's shorthand (2026-10-30): _"loop the next 10 stories, in order, and if you get blocked, move on to the next story that has no unresolved dependencies."_ This skill strings together the flow `CLAUDE.md` already defines for one story — it adds no new rules and relaxes none.

**Argument:** `N`, the number of stories to **start** (default 10). Count starts, not finishes, so a run of parked stories can't stretch the loop past what the owner expected. Resuming a story that was already `doing` or `blocked` (step 1) does not count.

## 0. Before the first story

- `git status`: if a finished story is uncommitted, commit it first (rule 6). If uncommitted work you can't attribute to a story is in the tree, stop and ask. (`docs/v3/.obsidian/workspace.json` is editor state — leave it out of commits, ignore it.)
- A story already `doing` that waits on the owner (e.g. a design match): park it as in step 4 before moving on. One that is mid-build: finish it first, as step 3.

## 1. Owner answers first

If the owner has, **in this session**, answered a parked story's question (a design match "Yes", a ratification go-ahead, a fence or scope decision), finish that story before starting new ones: set `status: doing`, apply the answer (e.g. `scripts/audit.sh story <ID> --design-match -` with the owner's words), then finish it per step 3. Never infer an answer — no explicit owner words in this session, no change.

## 2. Gates, before every story

Check in this order:

1. **Backlog review due?** Count `done` flips since the last review entry in `docs/v3/AUDIT.md` (6 triggers it), plus any drift event (`CLAUDE.md` → Agent / loop rules). If due, run `.claude/skills/backlog-review/SKILL.md` in a **fresh-context subagent** (the Agent tool; this skill is the owner's explicit request for it — the agent that built the stories must not review them). Commit its result.
2. **Doc parity due?** `pnpm parity:debt`. If due, run `.claude/skills/doc-parity-review/SKILL.md` the same way.
3. A review verdict of **`blocked` stops the whole loop** — go to step 5. Questions from a `continue` / `amended` review don't stop it; collect them for the summary.

## 3. Pick and run the next story

**Eligible** = the lowest-`priority` story with `status: todo` whose:

- every `depends_on` story is `done` (a dependency that is `doing`, `blocked` or `todo` is unresolved — e.g. S67 waits while S66 waits on a design match);
- every `design:` story is `done` (rule 18).

Read both lists from the note's frontmatter in `docs/v3/backlog/stories/S<N>.md`. The generated **Next** line in `BACKLOG.md` checks designs only, not `depends_on`, so don't rely on it alone. `superseded` stories are skipped.

Run it exactly as `/goal S<N> done` (`CLAUDE.md` → `/goal <ID> done` shorthand): quote the `/goal` line and ACs word for word, `status: doing` + `pnpm backlog:build`, the reuse check, grader written and shown red on HEAD before product code, build inside the fence, grader green, `pnpm verify` 0, `status: done`, `CHANGELOG.md`, the baseline table, `scripts/audit.sh story <ID>`, one commit, and the `S<N> verified:` section with evidence.

Give the owner a one-line progress note when each story starts and ends.

## 4. Blocked → park and move on

A story is **blocked** when it needs something only the owner can give, or the rules forbid going further:

- a design match (rule 22) or ratification (rule 18) waiting on the owner;
- an AC that can't be met inside the fence (rule 10) — never widen it;
- a missing input the story says to stop and ask for;
- the turn cap reached;
- an owner decision the story can't make (a pillar citation, an `Open:` source, a new ADR).

Park it:

1. Commit everything done so far as a **checkpoint** (grader, code, captures), worded like earlier checkpoints: `S<N> checkpoint (parked for …): …`. `pnpm verify` must exit 0 at the checkpoint. If it doesn't and can't be made to inside the fence, revert the story's product changes, keep the grader, and say so.
2. Set `status: blocked` in its note, `pnpm backlog:build`, include it in that commit. A committed checkpoint satisfies rule 6, so other stories may run.
3. Record the question for the summary (what it needs, with the evidence). For a design match, run `pnpm design:review <ID>` and name `.designreview/<ID>/`; run `pnpm design:review <ID> --done` once the owner gives the verdict.
4. A turn-cap hit or a fence problem is a **drift event**: the next step 2 makes a backlog review due.

Then go back to step 2.

## 5. Stop

Stop when `N` stories have been started, nothing is eligible, a review returns `blocked`, `pnpm verify` breaks in a way no story owns, or the owner interrupts. Never push, deploy or open a PR.

End with one summary:

- **Done:** each story with its commit and a one-line impact.
- **Parked:** each `blocked` story, what it waits on.
- **Questions for the owner**, every one from stories and reviews, numbered, each a **bold direct question first**, then self-contained context (no "see above"). The context never stops at an ID or an AC number (owner, 2026-10-30: "you need to tell me more than just the label for the AC or the Story"): say what the story builds, what the AC or change says in plain words, what went wrong or changed, and what each answer would lead to.
- **Not eligible:** stories skipped, and the unresolved dependency or design for each.
- **Next run:** what `/run-stories` would pick up first.
