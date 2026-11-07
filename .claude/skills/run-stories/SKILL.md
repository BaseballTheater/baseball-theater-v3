---
name: run-stories
description: Work through the backlog in priority order — the next N stories (default 10) — parking any story that gets blocked and moving on to the next one whose dependencies are all done. Use when the owner types /run-stories [N], or asks to loop the next stories and skip past blocked ones.
---

# Run stories

The owner's shorthand (2026-10-30): _"loop the next 10 stories, in order, and if you get blocked, move on to the next story that has no unresolved dependencies."_ This skill strings together the flow `CLAUDE.md` already defines for one story — it adds no new rules and relaxes none.

**This thread coordinates; each story runs in its own fresh-context subagent** (owner, 2026-11-04: "All 3", to running each story in a fresh-context subagent among the token cuts). Before this, one context carried every story: 92% of a run's input tokens, a median of 200–300k tokens re-sent on every request, because whatever one story read stayed for all the later ones. Here the coordinator keeps only what it needs to choose and check stories: the gate scripts, `docs/v3/INDEX.md`'s story list, `git`, and each worker's short report. **Don't read story notes, code, skills or ledger entries in this thread** beyond the frontmatter eligibility needs; the workers and review subagents read them.

**Argument:** `N`, the number of stories to **start** (default 10). Count starts, not finishes, so a run of parked stories can't stretch the loop past what the owner expected. Resuming a story that was already `doing` or `blocked` (step 1) does not count.

## 0. Before the first story

- `git status`: if a finished story is uncommitted, commit it first (rule 6). If uncommitted work you can't attribute to a story is in the tree, stop and ask. (`docs/v3/.obsidian/workspace.json` is editor state — leave it out of commits, ignore it.)
- A story already `doing` that waits on the owner (e.g. a design match): park it as in step 4 before moving on. One that is mid-build: finish it first, as step 3.
- `git fetch origin`: the run's first story branches from `origin/stage` (step 3).

## 1. Owner answers first

If the owner has, **in this session**, answered a parked story's question (a design match "Yes", a ratification go-ahead, a fence or scope decision), finish that story before starting new ones: hand it to a worker (step 3) with the owner's words quoted **verbatim** in the brief, to apply (e.g. `scripts/audit.sh story <ID> --design-match -` with those words) and then finish the story. Never infer an answer — no explicit owner words in this session, no change.

## 2. Gates, before every story

Check in this order:

1. **Backlog review due?** `scripts/review-debt.sh` counts `done` flips since the last review (6 triggers it) and the drift events git records; add any it can't see (`CLAUDE.md` → Agent / loop rules). Don't read `docs/v3/AUDIT.md` to count — it is ~1 MB. If due, run `.claude/skills/backlog-review/SKILL.md` in a **fresh-context subagent** (the Agent tool; this skill is the owner's explicit request for it — the agent that built the stories must not review them). Give it the skill's path and the script's output and let it read the skill; **don't read the skill into this thread** (it is ~12 KB and was being pasted into the coordinator's context on every review). It makes its edits, logs them with `scripts/audit.sh review` and commits; check the commit landed. A design intake (the script says when) is two reviewer subagents, each given `.claude/skills/design-intake-review/SKILL.md`'s path; then one more subagent, given both reports and the skill's path, merges, applies, logs and commits, so the merge also happens outside this thread.
2. **Doc parity due?** `pnpm parity:debt`. If due, run `.claude/skills/doc-parity-review/SKILL.md` the same way.
3. A review verdict of **`blocked` stops the whole loop** — go to step 5. Questions from a `continue` / `amended` review don't stop it; collect them for the summary.

## 3. Pick and run the next story

**Eligible** = the lowest-`priority` story with `status: todo` whose:

- every `depends_on` story is `done` (a dependency that is `doing`, `blocked` or `todo` is unresolved — e.g. S67 waits while S66 waits on a design match);
- every `design:` story is `done` (rule 18).

Read both lists from the note's frontmatter in `docs/v3/backlog/stories/S<N>.md`. The generated **Next** line in `BACKLOG.md` checks designs only, not `depends_on`, so don't rely on it alone. `superseded` stories are skipped.

Find it from the **Stories** section of `docs/v3/INDEX.md` (open stories with their `depends_on` and design lists, then the `done` ones) or the notes' frontmatter; nothing else is needed to choose.

**Give it its own branch first** (S121; owner, 2026-11-07: "I want a release to be a set of PRs basically"): `git switch -c story/S<N>` from `origin/stage` for the run's first story, and from the previous story's branch for each later one, so a run's stories stack and each branch holds its story and the ones before it. The worker commits there; nothing is committed on `stage` itself.

**Hand the story to a worker:** one fresh-context `general-purpose` subagent per story (the Agent tool, `run_in_background: false`: the next story waits on this one's commit). Workers run one at a time, never in parallel: they share the working tree. The brief is self-contained, since the worker starts with none of this thread's context:

> Run `/goal S<N> done` exactly as `CLAUDE.md` → "`/goal <ID> done` shorthand" defines it, as one step of `/run-stories` (`.claude/skills/run-stories/SKILL.md`, steps 3–4): quote the `/goal` line and ACs word for word, `status: doing` + `pnpm backlog:build`, the reuse check, grader written and shown red on HEAD before product code, build inside the fence, grader green, `pnpm verify` 0, `status: done`, `CHANGELOG.md`, the baseline table (rule 17), `scripts/audit.sh story S<N>`, one commit. Start from `docs/v3/INDEX.md`. Do not push, start another story, or run a review. If the story is blocked (step 4's list), park it as step 4 says and stop. [Owner's answers for this story, quoted verbatim, if any.]
>
> Reply with only: **outcome** (`done` or `parked`); the **commit** sha; a **one-line impact**; your `Goal for S<N>:` quote and your `S<N> verified:` section exactly as you wrote them; and, if parked, **each question for the owner**, written as step 5 asks (bold direct question first, then self-contained context), plus any drift event (turn cap, fence).

When it returns, check rather than trust: `git status` is clean, `git log -1` is the commit it named, and the note's `status` is `done` or `blocked`. If not, finish or park the story yourself from what is committed, and say so. Relay the worker's `Goal for S<N>:` quote and `S<N> verified:` section to the owner as they are (the `/goal` rule asks for both); keep any questions for the summary. Don't push per story: the run pushes once, at the end (step 5), as one pull request per story.

Give the owner a one-line progress note when each story starts and ends.

## 4. Blocked → park and move on

A story is **blocked** when it needs something only the owner can give, or the rules forbid going further:

- a design match (rule 22) or ratification (rule 18) waiting on the owner;
- an AC that can't be met inside the fence (rule 10) — never widen it;
- a missing input the story says to stop and ask for;
- the turn cap reached;
- an owner decision the story can't make (a pillar citation, an `Open:` source, a new ADR).

The worker parks it (and the coordinator, if a worker stops without doing so):

1. Commit everything done so far, on the story's `story/S<N>` branch, as a **checkpoint** (grader, code, captures), worded like earlier checkpoints: `S<N> checkpoint (parked for …): …`. `pnpm verify` must exit 0 at the checkpoint. If it doesn't and can't be made to inside the fence, revert the story's product changes, keep the grader, and say so.
2. Set `status: blocked` in its note, `pnpm backlog:build`, include it in that commit. A committed checkpoint satisfies rule 6, so other stories may run.
3. Record the question for the summary (what it needs, with the evidence). For a design match, run `pnpm design:review <ID>` and name `.designreview/<ID>/`; run `pnpm design:review <ID> --done` once the owner gives the verdict.
4. A turn-cap hit or a fence problem is a **drift event**: the next step 2 makes a backlog review due.

Then go back to step 2.

## 5. Stop

Stop when `N` stories have been started, nothing is eligible, a review returns `blocked`, `pnpm verify` breaks in a way no story owns, or the owner interrupts. Then push once, for the whole run (owner, 2026-11-02: "if we're using run-stories, we don't have to push until they are all done"), as one pull request per story into `stage` (S121; owner, 2026-11-07: "I think releases to main probably should use GitHub releases, if that's actually possible. I want a release to be a set of PRs basically", and on who merges them: "1. You automatically"):

1. Check GitHub Actions on `stage` first (`gh run list --branch stage --limit 1`), as `CLAUDE.md` → Agent / loop rules says.
2. In story order, for each `story/S<N>` branch (done or parked checkpoint): `git push -u origin story/S<N>`, `gh pr create --base stage --head story/S<N> --title "S<N>: <one-line impact>" --fill`, then turn on auto-merge with `gh pr merge --auto --merge story/S<N>`. Auto-merge merges each pull request once its required checks (`ci-passed`) pass. Because the branches stack, a later pull request also carries the earlier stories until those merge; GitHub marks an earlier one merged if a later one lands first.
3. Watch the pull requests' checks (`gh pr checks <number> --watch`, in the background) and report each one's result in the summary; a failure is the next thing to fix, committed on that story's branch.
4. Once they merge, bring the local `stage` up to date (`git fetch origin && git switch stage && git merge --ff-only origin/stage`).

A run never pushes directly to `stage` or `main`, never merges into `main`, and never publishes releases: publishing a GitHub Release is the owner's release step, which deploys production and fast-forwards `main` to mirror it. Never deploy.

End with one summary:

- **Done:** each story with its commit and a one-line impact.
- **Parked:** each `blocked` story, what it waits on.
- **Questions for the owner**, every one from stories and reviews, numbered, each a **bold direct question first**, then self-contained context (no "see above"). The context never stops at an ID or an AC number (owner, 2026-10-30: "you need to tell me more than just the label for the AC or the Story"): say what the story builds, what the AC or change says in plain words, what went wrong or changed, and what each answer would lead to.
- **Not eligible:** stories skipped, and the unresolved dependency or design for each.
- **Next run:** what `/run-stories` would pick up first.
