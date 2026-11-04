---
name: design-intake-review
description: Treat ratified designs as undocumented UI features and amend the backlog to build them — inventory every screen, component, state, layout and data need in the ratified surfaces (DESIGN.md, PNGs, Figma), plan the shared frontend component layer against the accepted frontend ADRs, map it to existing stories, and slice what no story owns. Use when a surface is newly ratified or a ratified amendment lands, when frontend ADRs change, or when asked whether the backlog actually builds the designs.
---

# Design intake review

A [backlog review](../backlog-review/SKILL.md) asks whether the plan still holds against the repo. This review asks whether the plan **builds what the ratified designs draw**. Ratified frames carry product decisions — screens, states, settings, data shown — that no story may own yet. Treat each one exactly as if the owner had added a new feature: find it, map it, and amend the plan so something builds it.

It is a backlog review with a wider input. It shares the backlog review's write scope, verdicts, evidence rule and ledger entry, so everything in [backlog-review](../backlog-review/SKILL.md) applies unless this file says otherwise.

## When it is due

- A surface's `RATIFIED.md` is added, or a ratified amendment lands in `docs/v3/visual/<surface>/`.
- A frontend ADR is accepted or materially changed (ADR-003, 008, 014, 016, 023–026, or a new one).
- The owner asks whether the backlog builds the designs.

It counts as the backlog review for that drift event; log it with `scripts/audit.sh review`.

## Fresh context, two reviewers

Run it **without** the transcript that wrote the stories or the designs. For a full intake (several surfaces, or new frontend ADRs), run **two independent reviewers** that do not see each other's work, each producing a report. The coordinating agent merges them: union the findings (coverage), and for every disagreement state both positions and the resolution, or put it to the owner. Reviewers report; they do not edit. The coordinator applies the merged result.

## Inputs — read all of them

| Source                                                                                                                                                                                                       | What to take from it                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `docs/v3/visual/<surface>/DESIGN.md`, `RATIFIED.md`, `REVISIONS.md`                                                                                                                                          | The ratified frames, their states and variants, and decisions recorded on them                                             |
| `docs/v3/visual/<surface>/*.png`                                                                                                                                                                             | What is actually drawn — read the images, do not trust the prose alone                                                     |
| Figma file `wqGKEFlvyxq0ObWZhRJdPF` (Figma MCP: `get_metadata`, `get_screenshot`; `get_design_context` only after loading the `/figma-design-to-code` skill)                                                 | Component structure, variants and instances the PNGs flatten — the evidence for what is one shared component vs. a one-off |
| `docs/v3/VISUAL-DESIGN.md`                                                                                                                                                                                   | Tokens, host pairings (mobile / medium / desktop), §5a settings that change presentation, §9 decisions                     |
| `docs/v3/FEATURES.md`, `docs/v3/INTENT.md`                                                                                                                                                                   | What each drawn thing is for                                                                                               |
| `docs/v3/ARCHITECTURE.md` — ADR-003, 008, 014, 016, 020–026, each by its line range in `docs/v3/INDEX.md`                                                                                                    | The frontend rules the stories must be sliced against                                                                      |
| The backlog through `docs/v3/INDEX.md`: the Gap map and Later themes frame notes, every UI story's note (`grep -l "^design:" docs/v3/backlog/stories/*.md`), and `web/src/` at HEAD — not `BACKLOG.md` whole | What is already owned or built                                                                                             |
| `packages/domain`, `openapi/bt-api.v1.json`                                                                                                                                                                  | What data exists today, to find what the frames need that the API lacks                                                    |

Never treat an unratified frame as a decision. A frame in Figma that is not in a ratified surface is an open question for the owner, not work.

## The checks

Each produces findings with cited evidence (file, line, frame or node id), never a bare "looks fine".

### 1. Inventory — what the designs contain

Per surface, list:

- **Screens and rooms**, per host pairing (mobile / medium / desktop).
- **Components**, marking which recur across surfaces (team-color module, linescore, at-bat accordion, tab bar, notice, empty/loading/error room …). Recurrence is judged from Figma instances and the PNGs, not names.
- **States** each component is drawn in: loading, empty, error, hidden score, live/final/pregame phase, offline, collapsed, selected.
- **Interactions**: navigation, toggles, dialogs, menus, keyboard paths where drawn.
- **Settings** that change presentation (VISUAL-DESIGN §5a) and where each is read.
- **Data** each element shows, traced to a `@bt/domain` type and an API route — or marked **missing**.

### 2. Ownership — map every inventory item

For each item: the story that builds it, or **unowned**. Also flag:

- A UI story whose ACs miss a drawn state or pairing of its own surface.
- Two stories that would each build the same recurring component (ADR-025: one implementation).
- A drawn value that a story would compute in a view instead of a `packages/domain` function (ADR-025).
- Data a frame needs that no backend story provides.
- Anything the accepted frontend ADRs require with no story: PWA shell + manifest + service worker + update flow + offline reading (ADR-023); the Zustand settings store and removing `experimentalDecorators` (ADR-024); the comment-staleness check, the domain-arithmetic lint rule, `jscpd`, the reuse-check line in the story template (ADR-025); `size-limit`, Lighthouse CI, render-count assertions, raised coverage floors, Playwright (ADR-026).
- Design amendments the ADRs make necessary (ADR-023: installed/standalone layout, install row, offline state, update notice) — these need **design stories** before any UI story builds them (rule 18).

### 3. Frontend architecture — plan the shared layer

Propose, as backlog amendments, not prose:

- The **shared component layer**: which components are built once, where they live under `web/src/`, and which story builds each **before** the first story that uses it.
- The **derivation layer**: every derived value the frames show, named as a `packages/domain` function and assigned to the earliest story that needs it.
- Folder layout and conventions only where an ADR leaves them open; anything that is a real choice goes to the owner.
- Order: foundations (state store, shared components, budgets, test harness) before the screens that depend on them, without delaying visible progress more than needed — argue the trade-off.

### 4. Slice and re-prioritize

- Slice every unowned item into stories that follow `docs/v3/BACKLOG.md`'s rules: Gap, Impact, Source, Design line, Depends on, scope fence, ACs that map to commands/tests, `/goal` line, turn cap, verify-script work item 0. A story should be the smallest thing that moves the loop (rule 4).
- **Source lines (rule 19):** cite a feature FEATURES already names (most ratified frames are carried features — scoreboard, game rooms, standings, search, settings). If none fits, write `Open:` with the question. Never edit FEATURES or INTENT here — that is the [doc parity review](../doc-parity-review/SKILL.md)'s scope; queue the gap under **For the parity review** in the findings instead.
- Re-scope existing UI stories whose ACs miss drawn states, rather than adding a parallel story.
- Run the backlog review's checks 2 (ground truth for the next 3 stories) and 3 (argue against the whole order) on the amended backlog.

### 5. Verdict

`continue` / `amended` / `blocked`, as in the backlog review. Owner decisions (an unratified frame, a real architecture choice, a data source nobody has) are questions, listed verbatim.

## Write scope

Same as the backlog review: story notes, frame notes, `pnpm backlog:build`, the ledger via `scripts/audit.sh review`. Never INTENT, FEATURES, existing `**Source:**` lines, ratified design files, `RATIFIED.md`, or ADRs. A new ADR-level choice goes to the owner as a question.

## Log it

```bash
scripts/audit.sh review --trigger "design intake: <surfaces / ADRs>" --since "<done stories since last review>" --verdict amended --findings -
```

The findings body records the inventory summary per surface, the ownership map (counts of owned / unowned / re-scoped), each new or re-scoped story with the evidence that motivated it, the merged reviewers' disagreements and their resolution, items queued for the parity review, and the owner questions. Inserting stories makes a parity review due; run it after.
