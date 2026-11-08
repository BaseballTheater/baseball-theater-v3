# Baseball Theater v3 — Features

**Status:** Drafting (goals in place)  
**Depends on:** [INTENT.md](./INTENT.md) (pillars); the `G1`–`G5` tags below trace to the origin goals in [ORIGIN.md](./ORIGIN.md#goals-accepted)  
**Visual / UX:** [VISUAL-DESIGN.md](./VISUAL-DESIGN.md)  
**v2 reference (menu only):** [`../v2/FEATURES.md`](../v2/FEATURES.md)

This document defines **what users get** in v3. It does not describe frameworks, repos, or deploy targets. How those surfaces look and behave lives in VISUAL-DESIGN.

---

## North star

> Baseball Theater is where fans go for **highlights, live game context, and insight you can’t get from a raw MLB feed**—analysis, summarization, and richer tools—run efficiently and funded by supporters (Patreon), without using Patreon as your login.

(Trace: G2, G3, G4, G5; cost/efficiency is G1 / platform.)

---

## Principles (product)

_Edit as we agree._

1. **Highlights and game understanding first** — video + context beat generic scoreboard clones.
2. **Above the baseline** — MLB (and similar) data is an input; **differentiation** comes from other sources, derived analysis, and AI (G2, G4).
3. **Opinionated, not exhaustive** — prefer a sharp, robust experience over mirroring every MLB.com surface (G5 ≠ “clone everything”).
4. **Supporters unlock depth** — patronage should feel like power, not a paywall on the homepage; **pay via Patreon, sign in via BT auth** (G3).
5. **New capabilities are first-class** — v3 exists to grow the product; legacy parity is optional (G5).
6. **Honest about data** — we don’t pretend to be MLB or offer broadcast streams we don’t have.
7. **Live schedule/game UX is BT-backed** — freshness comes from Baseball Theater’s data layer around game time (see [ARCHITECTURE §1](./ARCHITECTURE.md#1-foundational-data-topology-accepted-direction)).
8. **AI is visible product value** — analysis, stats commentary, and summaries should show up in the UX, not only as internal tooling (G4).

---

## Scope legend

| Tag | Meaning |
|-----|---------|
| **MVP** | Ships in first public v3 |
| **v3** | In scope for the rearchitecture era, not necessarily day one |
| **Later** | Explicitly deferred |
| **Drop** | Will not bring from v2 / will not build |
| **New** | Did not exist (or only stubbed) in v2 |

---

## Carry / cut from v2 (working table)

**Decision (accepted):** Carry the v2 product loop except the explicit drops below. Carried surfaces may still be redesigned (BT-backed data, new auth, AI, etc.).

| v2 capability | Verdict | Notes |
|---------------|---------|-------|
| ApiTest / swagger explorer | **Carry** | Can be internal/dev-only |
| Daily scoreboard by date | **Carry** | BT-backed (ADR-002). Opens on today; between the last postseason game and the next spring training game it opens on that final day (owner, 2026-11-02: "Show the final day of the season by default, rather than \"today\" if today is between the final day of the season and the next spring training first game"; "final day" is the last postseason game) |
| Game → Box score | **Carry** | A full line score with each inning boxed, the batting / pitching tables, and the game's details — venue is one line of them (owner, 2026-10-14: "Plays and Box Score should have a full line score with boxes for the innings"; "The box score page will have all kinds of details and stats and that's just one of them") |
| Game → Editorial recap | **Carry** | May coexist with **AI summaries** (New). No line score and no score (owner, 2026-10-14: "Recap should have nothing") |
| Game → Live play / linescore context | **Carry** | Live *is* the pitch theater: diamond, BSO pips, win-probability chart (left out at launch until the owner picks a data source — owner, 2026-10-19; back from MLB's play metrics, owner, 2026-10-30: *"Bring back win probability charts"*), zone, trajectory, accordion pitch list. The score sits beside the diamond, never in the game header, and Live has no line score (owner, 2026-10-14: "Live should have the score, but not in the header"; "In a small status near the diamond status") |
| Game → Plays + pitch detail | **Carry** | Every at-bat of the game, inning by inning, each opening to the same pitch-by-pitch view as Live; plus all the game's scoring plays, and a full line score with each inning boxed (owner, 2026-10-14: "Plays is basically like browsing a list of the individual batters in Live - it shows each pitch, the strike zone, etc. All of that should exist in Plays, and you need to be able to select the inning you're looking at. By default, it should show the most recent inning that has any actual information to show. … It also needs an option to show all scoring plays, which is not inning-specific; it shows all the scoring plays for the entire game."). Still a natural home for AI/analysis later |
| Game → Videos / highlights | **Carry** | No score (owner, 2026-10-14: "Videos should have nothing"). The player opens as a dialog or a persistent stage — "Configurable by the user, defaulting to the dialog overlay" (owner, 2026-10-13). First filters: **Featured team** and **Stat / viz** clips (owner, 2026-10-13); Featured team is *"One of the game's two teams and the default filter value should be none"* (owner, 2026-10-30). Videos show in **groups** (owner, 2026-10-30: *"More like groups than categories (i.e. a reflection of what is there, not a set of boxes to put things in). The groups are: Pre-game, Game highlights, Statcast, Post-Game"*), an empty group is hidden, and *"the groups should be collapsible"*; a sort control sits left of the Grid / List icons (*"Add a sort option to the left of the grid/list option. Replace Grid and List with icons."*). No video thumbnail has a play icon (owner, 2026-11-04: *"No thumbnails should have a play icon"*; game-shell [A5](./visual/game-shell/amendments/A5.md)); a clip of a play links to it (see [Video play links](#new-product-themes)) |
| Highlight search (date + tag) | **Carry** | Scoreboard day-tag shortcuts can remain; not the Featured Videos area |
| Highlight search (free-text) | **Carry** | Highlights only at launch (owner, 2026-10-19), searched across MLB's whole highlight library by asking MLB's own search on every query, as the current site does (owner, 2026-11-02: *"MLB's own search on every query, for now. It can match the existing site (repo is called baseball-theater)."*). A result plays in a dialog over the results page, with a link to its game (owner, 2026-10-21: *"a video search result should play in a modal from the results page, and a link to the game should be on the modal"*; ratified standings-search-settings [A2](./visual/standings-search-settings/amendments/A2.md)), superseding the 2026-10-19 answer that it opens the game's Videos room |
| Savant deep links (delayed, gated) | **Carry** → **expand** | Phase 1 multi-source links; Phase 3+ Savant video/statcast inline (see Multi-source knowledge) |
| Settings (favorites, hide scores, playback prefs) | **Carry** | **Signed-in only** (owner, 2026-10-19: *"Hide settings for signed out users. Settings aren't available without signin"*): signed-out visitors see no Settings and get house defaults; settings live on the account (ADR-027). Favorites still useful for scoreboard sort without team pages. Also: **game-row slot** occupant (its Win Probability choice shows a game's odds while it is live and after it ends, not before — owner, 2026-10-30: *"It is actually least useful before the game. During and after is definitely useful."*) and **collapse non-favorites** (VISUAL-DESIGN §5 / §5a). Favorites are a Favorite Teams dropdown (owner, 2026-10-14: "It's just a dropdown in settings, not a big deal"); playback prefs include the **Video Player** choice, dialog by default (see Videos). **Opens First** (Videos / Live / Box) picks which room a game opens on (ratified Settings frame, S34). **Hide Scores** (owner, 2026-10-21: *"the point of this is to avoid spoilers for people who want to experience the game their own way, but if they’re looking at game details they clearly want the info"*): Live, the Plays linescore and the Runs view's score after each scoring play hide the score (play descriptions stay), Box is unchanged, the recap stays readable under the heading "Recap", and on the game page only the recap video is retitled "Recap (score hidden)" — other titles are not rewritten (*"there are probably too many ways to detect this to make a reliable detector beyond the recap"*) and *"Search is unaffected by hide scores"*; no text anywhere says scores are hidden (*"No, remove that from the footer"*). Ratified as S57 (game-rooms A3/A4, game-shell A2/A3) |
| Settings sync for patrons | **Carry** | Via **new** accounts (G3), not Patreon OAuth. **Now free for every signed-in user** (owner, 2026-10-19) — settings live on the account and are the same on every device (ADR-027) |
| Standings | **Carry** | Every division's table: each team's color, name, W, L, PCT and GB ("—" for the leader), as drawn in the ratified Standings frames; each table only as wide as it needs, scrolling when wider than the screen, and on mobile each team shortens to its abbreviation (owner, 2026-11-02: *"The table should not be 100% width; it should only be as wide as it needs to be, and should scroll if it's wider than the viewport. On mobile, the names should shorten to just the abbreviated name (NYY, DET, etc)"*; standings-search-settings [A7](./visual/standings-search-settings/amendments/A7.md)) — S4 |
| Update / changelist UX | **Carry** | Delivered by the PWA's update flow — a new build waits and the app shows an "update available" notice ([Installable app](#installable-app-pwa)). An app built for an API version that has been retired shows the same notice instead of failing, and what is already on screen stays readable behind it (S28). The notice floats at the bottom of the screen with **Snooze** (back in an hour) and **Update Now** (owner, 2026-11-02: *"The reload notice should be a floating notification-style box at the bottom, fixed. Replace the X with Snooze, and make it an hour-long snooze before it comes back. Change Reload to Update Now."*; shell-scoreboard [A6](./visual/shell-scoreboard/amendments/A6.md)) |
| Chromecast | **Drop** | |
| Featured / tagged video feeds | **Drop** | `/videos/...` browse experience |
| Public playback-style catalog APIs | **Drop** | `/api/team`, compilations, recaps, singleplays, nonplays-style catalog |
| PWA / installability | **Carry (at launch)** | Reversed 2026-10-19 (was Drop for MVP). Owner: *"I'm interested in having it be a PWA though"* — installable, fast shell, offline reading of what you've seen. See [Installable app](#installable-app-pwa) and ADR-023 |
| Reddit / no-hitter bot | **Drop** | |
| Schedule route (unwired in v2) | **Drop** | Do not build the `/schedule/...` surface |
| Team pages (highlights + schedule) | **Drop** | Entire `/team/...` area |
| Patreon login + tier gates | **Replace** | Login ≠ Patreon; **payments/tiers still Patreon-driven** (G3) |

### Dropped (summary)

Featured/tagged video feeds · Team pages · Chromecast · Public playback catalog APIs · No-hitter bot · Schedule route

---

## New product themes

Themes map to goals. Detail below as they firm up.

| Theme | One-line idea | Goals | Priority |
|-------|---------------|-------|----------|
| **Derived insight** | Layers on top of MLB: external sources + our analysis | G2, G5 | High |
| **Multi-source knowledge** | Link to—and eventually aggregate—MLB, FanGraphs, BBRef, Savant, etc. | G2, G4, G5 | High |
| **AI game companion** | Analysis, summarization, and **intelligent curation** (impact-ranked videos, day’s best across the league) | G4, G5 | High |
| **Impact curation** | Rank what most people would want to see—per game and league-wide for a day | G2, G4, G5 | High |
| **Inning / game insight pipeline** | End-of-inning live feed + finished **game package** feeding day digests | G2, G4, G5 | High |
| **Modern membership** | BT accounts + entitlements; Patreon continues to collect support | G3 | High |
| **Delete your data** | A signed-in user can download all of their data, and can delete it from every place BT keeps it; the two are separate and neither needs the other, and someone who wants both downloads first (owner, 2026-10-27). A download is kept 14 days, can be requested twice in 24 hours, is linked in Settings and by email, and is deleted with the account; personal data can't be stored without automation to delete it, and where that can't be enforced in code a review or scan catches it; copies BT can't delete on demand age out where legal (owner, 2026-10-23) | G3 | High |
| **Robust core** | Deeper, more reliable scoreboard → game → video/search loop than v2 | G5 | High |
| **Push notifications** | Game start/end, highlights, smart score digests (favorite teams) | G5 | **Later** (post-MVP; Web Push, received by the PWA's service worker — ADR-023) |
| **Next-pitch prediction** | Use pitch data to train a model to predict the next pitch during games (owner, 2026-10-29: *"I want to make a story to use pitch data to train a model or a fine tune to predict the next pitch during games"*): before each pitch, the Live room shows the odds by pitch type and the likely location (no right/wrong result or hit rate: owner, 2026-10-29, *"No, I don’t want to show that"*); it ships only if it predicts well (*"I won’t even ship the prediction thing unless it’s pretty good"*); a small model BT trains itself, not an LLM fine-tune; paid tier only (owner, 2026-10-29, choosing those options) | G2, G5 | — |
| **Video play links** | A video of a play links to that play (owner, 2026-10-30: *"The ones with plays associated should havea link to the play in question. And yes, we should associate the ABS ones."*): MLB's own link where it gives one (the content feed's `guid`, the GraphQL feed's `playIdRef`), and for an ABS challenge clip without one, the challenge it shows (owner, 2026-10-30, "yes" to associating the ABS clips). A video card, list row and the player show a link to the play (`Play · Top 6th →`); clips with no play show none. The link opens the Plays room on that play, its at-bat open and marked by a bar (owner, 2026-11-04, asked whether to keep the bar: "Keep"), and every at-bat that has a video shows `Video: <clip title>` above it (owner, 2026-11-04: "It should show this for any play that has a video, even if you didn’t get there from the video"). A video played from Search's floating player links to its play too (owner, 2026-11-05, asked whether it should: "Yes"); S127 designs it, and no story builds it yet. Ratified as S96 (game-shell [A5](./visual/game-shell/amendments/A5.md), game-rooms [A6](./visual/game-rooms/amendments/A6.md)) | G5 | — |
| **More MLB game data** | Ingest the further MLB feeds the owner found for a game (owner, 2026-10-30: *"I also found a bunch more URLs we can get data from"*; then *"Also add stories to ingest all of this extra data."*): per-play metrics (win probability and what each play added, key moments, lead changes, hard hits, ABS challenges, hit data), the GraphQL game content (video play links, recap and related articles), the player of the game, the game's ABS strike-zone rule settings, the uniforms worn, and division names on the standings; and Baseball Savant's game feed (owner, 2026-10-30: *"oh, I forgot, there's also this: https://baseballsavant.mlb.com/gf?game_pk=823823"*) — only what MLB's own feeds lack, per pitch: expected batting average, barrels, spray position, home-run ballpark count, bat speed, sword swings, Savant's in-zone call, times through the order, the exact challenged pitch, and the front-of-plate location (owner, 2026-10-30, asked whether to ingest only the Savant fields BT doesn't already have: *"Yes re: S103"*; the list is what the 823823 recording holds beyond MLB's feeds). Savant's fields may arrive later than the live feed's (owner, 2026-10-30: *"Something that needs to be accounted for is the potential difference in arrival time for the baseball savant details"*). Also from Savant, for a game: each pitcher's season averages per pitch type, and the ballpark's field drawing by venue id (owner, 2026-10-30, asked whether these two should join More MLB game data: *"1. Yes"*); Savant's terms of use are checked before any live Savant call ships (*"Sure"*). Savant's player-season data is recorded for future ideas in [SAVANT-DATA](./SAVANT-DATA.md), not ingested (owner, 2026-10-30: *"Just record the example URLS for the seasonal data and describe what they contain in a document we can use for future ideas."*). mlb.com's Gameday config feed is not ingested; only its player-of-the-game window is used, to decide when to fetch the player of the game (owner, 2026-10-30: *"Ok, agreed"*) | G2, G5 | — |
| **Every game since 1901** | BT holds every game MLB has, back to the first day of the 1901 season, filled by a backfill that can be run for any date range and run again safely (owner, 2026-11-07: *"I want idempotent functionality that hydrates every game between two dates, defaulting to “today” as the end date, and 1 year prior as the start date. It should always skip days between Nov 15 and Feb 15. This goes all the way back to 1901/04/18."*). It is gentle on MLB (*"I think I would keep it to something like 2 request threads per domain? Running until all the data is hydrated."*; *"I don't want to be a bad citizen, don't hit the API too hard"*), and stops asking for a kind of data once it has failed for 14 days of games, since some data exists only for recent games (*"there should be logic in there to stop trying that kind of data if more than x days worth of games for a type of data fail"*; *"14 days should be plenty"*). It runs locally first, to see how much room the data takes before it goes anywhere else, and a stopped run resumes without starting over (*"Let's do it locally and then see how big it actually is. This means it needs to allow resuming without starting over."*) | — | — |
| **Calendar date picker** | The scoreboard's date opens a calendar (owner, 2026-11-07: *"I also want a calendar picker UI that makes it easy to switch the year, lets you pick with the calendar visible and the day of the week showing in the calendar grid, and the date display should let you type the date in yourself. If we could also show the number of games on each day in that view that would be great."*). Days with no games stay pickable but dimmed, and future dates can be picked (owner, 2026-11-07, asked both: *"dimmed"*; *"allow future"*) | — | — |
| **Whole-game record** | We have the data for the entire game — every moment, not only the final state — which can be used for a lot of things (owner, 2026-10-09) | — | — |
| **Visual design** | Baseball Theater has a design: the basic design setup (brand colors, type, dark-only color scheme) every surface is built on — how it looks lives in [VISUAL-DESIGN](./VISUAL-DESIGN.md) (owner, 2026-10-09). Built screens are photographed paired with their ratified designs in the ledger (owner, 2026-10-28: *"Yes, reword"*) and count as done only when the owner says they match (owner, 2026-10-28: *"I also want to modify the acceptance critera for the UI stories as you suggested, to compare screenshots to the designs. At least for now. If we have major mismatches consistently, I'll have to revisit."*; ADR-026) | — | — |

### Theme detail

#### Derived insight (G2)

- **Intent:** Show fans something that isn’t “the same JSON MLB already shows,” via other datasets and/or BT-computed analysis.
- **Examples (brainstorm, not committed):** Savant/Statcast-style context, pitch quality framing, win-probability style narratives, cross-source linking, day/season digests.
- **Non-goals (initial):** Replacing MLB.TV; claiming official stats authority.

#### Multi-source knowledge (G2, G4)

**Problem today:** MLB Stats API is the spine—we get `playerId`, `teamId`, `gamePk`, etc. Fans live on **mlb.com**, **FanGraphs**, **Baseball-Reference**, and **Baseball Savant**, each with different IDs, URL shapes, and unique metrics (bWAR, fWAR, Statcast, Savant video, etc.). v2 only deep-linked Savant in a few gated places; there is no general cross-site story.

**Intent:** Build a path from “we only know MLB” to “we understand the baseball data ecosystem” — first as **links**, later as **selected aggregation**, eventually with **agent-assisted** fetch/normalize/explain.

**Phased product (extent TBD — ship incrementally):**

| Phase | User value | Example |
|-------|------------|---------|
| **1 — Deep links** | One tap to the same player/game on another site | Player name → MLB · FanGraphs · BBRef · Savant profile URLs |
| **2 — Understand sources** | BT knows what each site *is good for* | UI copy / tooltips; “fWAR lives on FanGraphs”; agent can cite where a stat came from |
| **3 — Cached snapshots** | Show a few **foreign** metrics inline without leaving BT | e.g. season bWAR + fWAR next to a box score line; Statcast EV/LA on a play when Savant has it |
| **4 — Agent aggregation** | On-demand or scheduled **multi-source** answers | “Compare these two pitchers’ stuff+plate discipline across sources”; summarize a game using BT game doc + external pulls |

**Simplest must-have (likely early):** Phase 1 for **players** (and eventually teams/games where mappings exist). This alone is high value and bounded scope.

**Complex stretch (later):** Phase 3–4 — unique metrics and Savant video/play data merged into game/player context; requires ingestion policy, caching, cost, and legal/ToS care (see architecture §3). Savant's per-pitch game feed comes earlier, as ingest under **More MLB game data** (owner, 2026-10-30: *"Yes re: S103"*); the same ToS care applies before it is called outside a recording (S103's note).

**Relationship to other themes:** Feeds **AI game companion** (grounding + tools); overlaps **Derived insight** but is specifically about **external sites as first-class citizens**, not only BT-computed stats.

**Non-goals (initial):** Becoming a full FanGraphs/BBRef mirror; scraping entire sites; user-triggered open relay to arbitrary URLs (v2 anti-pattern).

#### AI game companion (G4)

- **Intent:** In-product AI for **game analysis**, **statistical analysis**, **summarization**, Q&A, and related help—grounded on BT-owned game data plus multi-source tools (ADR-009).
- **Surfaces (brainstorm):** per-game recap alternate to/alongside editorial wrap; play/inning explainers; Q&A over a game BT already stores.
- **Constraints to design later:** cost per user, grounding rules, entitlement tiering, latency vs cadence windows.
- **Feeds / shares pipeline with:** [Impact curation](#impact-curation-g2-g4-g5) (same agent/data plane; curation is the first high-visibility application).

#### Impact curation (G2, G4, G5)

**Problem today:** Game highlight lists are mostly **MLB’s order** (or chronological / tag-based). Fans often want “show me the stuff that **mattered**” or “what was **interesting** today across baseball?”—not twenty equally weighted clips.

**Intent:** Use BT’s owned game/play/media state (and later multi-source signals) so an **AI / ranking layer** can:

1. **Per game — impact-sort videos** — Order (or tier) highlights by how **impactful** they are to the game outcome and narrative—what most people would want to watch first (go-ahead HR, walk-off, huge defensive play that saved runs, etc.), not only “first clip in the feed.”
2. **Per game — interesting besides impact** — Surface clips/plays that are **notable** even if low leverage (bizarre play, milestone, filthy pitch, Statcast outlier).
3. **League-day digest** — Across **all games on a date**, surface the most interesting **videos**, **plays**, **stats**, and **accomplishments** (e.g. cycle, no-hitter progress, career firsts, league-leading performances that day).

**Ideal end state:** One intelligent consumer (agent / ranking pipeline) that can **read all approved data sources** BT has (live feed, media items, Savant/cross-source snapshots when available) and **derive** these rankings and digests—not a pile of one-off hardcoded sort rules forever (rules may bootstrap Phase A).

**User-facing surfaces (brainstorm):**

| Surface | Where it shows up |
|---------|-------------------|
| “Watch these first” / impact-ordered Videos tab | Game → Highlights |
| “Also interesting” rail | Same game, secondary list or badges |
| “Best of [date]” / league digest | Scoreboard day, or dedicated day digest (replaces some of the dropped Featured Videos *browse* with something smarter). **Committed for launch** on the scoreboard day, ranked by the existing per-game impact rule applied across the day (owner, 2026-10-19; drawn on the ratified scoreboard frames); it shows the day's top **five** clips (owner, 2026-11-02, asked at S71's design match whether the digest should show five: *"Yes"*) |
| Digests feeding search / home | Optional later |

**Phased approach (extent TBD):**

| Phase | Behavior | Inputs (typical) |
|-------|----------|------------------|
| **A — Heuristic rank** | Deterministic score: a clip of a play ranks by how much that play changed the odds of winning (MLB's win probability added; key moments and lead changes first among ties — owner, 2026-10-30, "Yes" to ranking by it); clips with no play, or games without play metrics, keep the media-keyword score, after them | BT live feed + MLB play metrics ([More MLB game data](#new-product-themes)) + media metadata |
| **B — Model-assisted rank** | LLM or classifier re-ranks / labels using structured play+clip features; caches result per `gamePk` | Same + optional Statcast |
| **C — League-day digest** | After (or near) day’s games settle, produce ranked slate of videos / plays / stats / accomplishments | All day’s BT game docs + media |
| **D — Multi-source enrich** | Digests/ranks incorporate foreign signals (Savant rarity, WAR context, etc.) | ADR-009 Phase 3+ |

**Non-goals (initial):** Replacing MLB’s own editorial recap feed wholesale; claiming “official” highlight priority; ranking that requires per-viewer personalization on day one (global “most people would want” is enough).

**Relationship to dropped Featured Videos:** v2’s tag-browse area is **dropped**; Impact curation is the **replacement philosophy**—curated “what mattered” instead of static tag grids.

**Feeds from:** [Inning / game insight pipeline](#inning--game-insight-pipeline-g2-g4-g5) — day digests should prefer finished **game packages**, not raw MLB dumps.

#### Inning / game insight pipeline (G2, G4, G5)

**Intent:** A server-side consumer runs on a **game clock** (not a user click):

1. **End of every inning** (every in-window game) — Read current game statistics / play state from BT’s store and emit **in-game insight items**: interesting snippets, notable stats, things to note. These form a **live feed** users can follow during the game (and afterward as a timeline).
2. **Game final** — Produce a finished **game package**: durable summary of what mattered (impactful plays/videos, standout lines, accomplishments, narrative beats). This package is the **canonical input** for league-day digests and other postgame surfaces.
3. **Day rollup** — Per-day producers **reference game packages** (plus any still-live inning feeds if needed), rather than re-scanning every raw play from scratch.

```text
Inning N ends  →  insight items → live “in-game feed”
     … 
Game final     →  game package  →  day digest / Best of [date]
                                    impact video order (can refine here too)
```

**User-facing (brainstorm):**

| Surface | Content |
|---------|---------|
| Game → live insight / “notes” feed | Append-only cards as innings complete |
| Game → postgame package view | One-shot “what mattered” after final |
| Scoreboard / Best of day | Built from packages, not only raw highlights |

**Why this shape**

- **Bounded AI cost** — ~9–12 insight passes per game + 1 package, not per user or per pitch
- **Natural cadence** — aligns with baseball structure; easier than guessing “every 30s re-summarize”
- **Composable** — day/league features stand on packages; live UX stands on inning feed
- Works with heuristic first, model later (same as impact curation phases)

**Relationship to ADR-002:** Detection of “inning ended” / “game final” comes from BT’s ingested live state (cadence polls). Insight jobs are **triggered by state transitions**, not by inventing a second MLB poller.

**Non-goals (initial):** Pitch-by-pitch AI commentary; personalizing the feed per user on day one.

#### Installable app (PWA)

- **Intent:** BT installs to the home screen and opens instantly, like an app. Owner, 2026-10-19: *"definitely install + fast shell, but if it can fetch in the background, offline might be nice"*; ships **at launch**.
- **User-visible:** a quiet install message in Settings (owner: *"Quiet prompt in Settings"*) plus the browser's own prompt — no banners or pop-ups. It sits at the very top of Settings, outside the Settings and Account frames, as a tip that can be dismissed for good in this browser (owner, 2026-11-02: *"The App section should be at the very top outside of those frames with a little "tip" indicator, and it should be dismissable at a browser level via localStorage"*; ratified standings-search-settings [A8](./visual/standings-search-settings/amendments/A8.md)); the app opens straight into its cached shell; games and scoreboards you've already viewed stay readable offline, marked with their age, and still respect Hide Scores; an "update available" notice when a new version is ready.
- **Background:** refresh while closed is opportunistic (some browsers only); the app fetches fresh data whenever it opens.
- **Enables notifications:** push needs a service worker, and on iPhone/iPad only an installed app receives push. Owner: *"Notifications can be later but IIRC it has to be a PWA for them to work in the background."*
- **Design:** the installed (no browser bar) layout, install tip, offline state and update notice are amendments to the ratified surfaces, ratified before they are built.

#### Push notifications (Later)

- **Intent:** Notify fans about games they care about—driven by **server-side** ingest transitions (ADR-002), not client polling.
- **Examples (phased):** game start / final for favorite teams; new highlight on a followed game; **smart** score updates (inning digest, lead change, close game)—not every run.
- **Stack:** standard **Web Push** (VAPID) sent from a Worker, received by the PWA's service worker ([Installable app](#installable-app-pwa); ADR-017, ADR-023; owner, 2026-10-18: *"Keep push notifications"*). iOS delivers push only to the installed app.
- **Relationship:** Ingest should emit transition events early (also feeds inning feed / game package); user `notifyPrefs` + Web Push subscriptions on the user record.
- **Non-goals (MVP):** Any push UI or notification permission prompts (the service worker itself ships at launch with the PWA).

#### Modern membership (G3)

- **Intent:** Users **authenticate with Baseball Theater** via **Logto** — **email sign-in** at launch: a **one-time code**, plus a link in the same email if Logto supports it (owner, 2026-10-18: *"Code if I have to choose, both if possible in a single email"*); **no passkeys at launch** (owner, 2026-10-18: *"No passkeys at launch"*) (ADR-004 as amended by ADR-019). **Paying / membership status** continues to flow from **Patreon**.
- **User-visible:** Sign in with a one-time code sent by email; optionally **Connect Patreon** (OAuth) to unlock supporter tiers. Manage pledges on Patreon; BT maps pledge → entitlements.
- **Unlinking:** a linked user can **unlink Patreon from BT**, not only manage the pledge on Patreon (owner, 2026-10-22: *"Unlink from bt"* — ratified design standings-search-settings [A3](./visual/standings-search-settings/amendments/A3.md)). What unlinking does to entitlements is settled when the Patreon link is sliced.
- **Every account has an email** (owner, 2026-10-28, asked what the data download's "we emailed you the link too" should say for an account with no email: *"It should be impossible for an account to have no email."*).
- **Replace:** v2 “Log in with Patreon” as the **session** IdP. Patreon OAuth remains only as **account linking** for tier.
- **Entitlements:** Carry v2 free/patron gates for carried features (see [Patronage](#patronage--access-product-level)).

#### Delete your data (G3)

- **Intent (owner, 2026-10-23):** *"I need tools to allow a user to delete all of their data, and it needs to include every single user data source. Ideally, said data would either be tagged somewhere, or something - basically I don't want it to be possible to store PII anywhere without having automation to delete it supported. If it isn't programmatically enforceable it needs to be part of some kind of review or scan. If the data lives in multiple places (eg logto and other dbs) this could become a growing problem without a plan set up first."*
- **Download and delete are separate** (owner, 2026-10-27, replacing 2026-10-23's *"Yes, but only if download happens before delete"* and 2026-10-25's *"On its own"*): *"Deleting and downloading aren't connected. If someone wants to delete their data, they can do it without downloading. If they want to download, they can do it without deleting. If they want to do both, they have to download first, then delete. There is no support for "download and delete in one action" unless that's a legal requirement."*
- **Downloads are kept 14 days** (owner, 2026-10-27): *"The download should be hosted in R2 with an expiration (ideally a bucket age-out policy of 14 days). If the account is deleted after that, the data is lost. If not, they can request a new download. They can request a download twice per day."* "Twice per day" counts any rolling 24 hours (owner, 2026-10-27: *"Rolling 24 hours"*). The user gets the download from a link in Settings and from an email sent when it's ready (owner, 2026-10-27, asked how the file reaches them: *"Both"*).
- **Deleting removes the download too** (owner, 2026-10-27, asked whether an unexpired download is deleted with the account: *"Delete them together with a warning shown and a link to the download."*).
- **A failed deletion can be retried** (owner, 2026-10-27, asked how a failed deletion looks: *"Try Again, contact support is failed repeatedly"*): an error with "Try again" and a message, shown all the time, to contact support if it keeps failing (owner, 2026-10-28: *"I want a message to the user to show all the time, which tells them "Contact support if it fails repeatedly" (but with better wording)"*); support is email (owner, 2026-10-28: *"mailto: support@baseball.theater"*).
- **After deleting, a blank Settings page says so, once** (owner, 2026-10-29, replacing A4's dismissible notice over the scoreboard): *"the deletion message should be on an otherwise blank page. Not dismissable. It should be the settings page, and it should be triggered by visiting the settings page with a server-only cookie that is only sent to users after deletion."* Asked how long it shows: *"Until seen once"*. Drawn in standings-search-settings A5 (S86); the cookie is S87; S79 builds the page.
- **Immediate, heavily confirmed:** deletion happens at once, after the strongest confirmation BT can ask for, including typing a phrase (owner, 2026-10-23: *"Immediately, but with maximal verification including typing a phrase"*).
- **What can only age out:** copies BT can't delete on demand — database backups, Patreon's own records (BT deletes its copy and its access), and service logs — are documented with how long they last and left to age out, where that is legal (owner, 2026-10-23: *"If that's legal, then yes"*). See ADR-028.
- **Where it sits:** ahead of account settings (owner, 2026-10-23: *"Yes"* when asked whether to build it ahead of S6, account settings). As the owner ordered it (48c7472), the inventory and the export/delete API (S76, S77) came first; S80 separates download from delete and stores downloads (owner, 2026-10-27), ahead of the Settings flow; the Settings flow (S78 design, S79 build) follows S6 because it lives on the Settings page S6 built.

#### Robust core (G5)

- **Intent:** Broader, sturdier product than v2—not only AI bolted onto a thin scoreboard.
- **From v2:** Carry scoreboard → game tabs → search → standings → settings (see carry/cut table); drop featured videos, teams, Cast, playback APIs, bot, schedule.
- **Still TBD:** concrete MVP checklist and how AI/insight land inside carried surfaces.

---

## Build checklist (working — not a “feel” gate)

v3 is a **rewrite**, not a port. Ship carried surfaces + platform; new themes when ready. No separate “must feel like v3” bar.

- [ ] Core carried loop: **scoreboard → game (videos / live / plays / box / recap) → search → standings → settings**
- [ ] BT-backed schedule/game data (ADR-002)
- [ ] Logto sign-in (email one-time code; no passkeys at launch) + Patreon entitlements (G3)
- [ ] Cloudflare + Neon serverless cost shape (G1)
- [ ] Download and delete your data from Settings (ADR-028) — a launch requirement (owner, 2026-10-26: "Yes")
- [ ] New themes (deep links, impact sort, inning feed, …) — **when chosen**, not blockers

**Explicitly out of product (dropped)**

- Featured/tagged video feeds, team pages, Chromecast, public playback catalog APIs, no-hitter bot, schedule route

---

## Patronage & access (product-level)

**Decision (accepted):** Keep **v2 entitlement shape**, minus gates tied to **dropped** features. Payments stay Patreon; login is Logto (email one-time code at launch; no passkeys at launch). **Server-enforced** (unlike v2’s client-only checks).

| Aspect | Direction |
|--------|-----------|
| **Payments / pledges** | Remain **Patreon** (G3) |
| **Login / session** | **Logto** — email **one-time code** at launch (plus a link in the same email if Logto supports it), **no passkeys at launch**; BT-owned session (ADR-004, ADR-019) |
| **Patreon connection** | **OAuth as linked account** (after BT login) so BT can read **subscription tier** — **not** an auth method |
| **Entitlements** | Linked Patreon pledge/tier → BT user; enforced on server |
| **Free vs paid** | Same relative split as v2 for **carried** surfaces |

### Tiers (carry from v2)

`Backer` → `Pro Backer` → `Star Backer` → `Premium Sponsor` (cumulative; owner/admin bypass)

| Capability | Minimum (v2) | v3 |
|------------|--------------|-----|
| Faster live refresh | Backer | **Carry** (interval TBD) |
| Cloud-synced settings | Backer | **Free** for every signed-in user (owner, 2026-10-19; ADR-027) — no longer gated |
| Savant play/pitch video links (+ delay) | Pro Backer | **Carry** (expand to multi-source links per ADR-009) |
| Chromecast | Pro Backer | **Drop** (feature dropped) |
| Team pages / team APIs | Star / Pro | **Drop** (feature dropped) |
| Next-pitch prediction | — | **Paid tier** (owner, 2026-10-29; minimum tier set when it ships) |

New gated surfaces (AI depth, push, play theater, etc.) get tiers when those features ship — not a pre-build decision.

---

## Success signals

| Signal | Goals | Target / note |
|--------|-------|----------------|
| Infra / hosting cost vs v2 EB | G1 | Lower steady-state cost; _quant TBD_ |
| Differentiation users notice | G2, G4 | Insight/AI surfaces used, not just visited |
| Auth conversion / support friction | G3 | Can pay on Patreon and use BT login without Patreon-as-IdP pain |
| Breadth of weekly-active surfaces | G5 | More than scoreboard + one game tab |

---

## Open product questions

_Owner decides when ready — none of these block scaffolding or the carried rewrite._

1. ~~Cutover shape~~ → the new app goes live at a temporary address, and the owner later moves `baseball.theater` off the current site by hand, with a written way back (owner, 2026-11-07: *"Do the temporary address"*; S119); cutover timing — when ready
2. Which new theme to build first (deep links, impact sort, inning feed, …; the play theater is no longer a separate theme — Live *is* the pitch theater, see the carry table) — when ready
3. ~~Patreon link~~ → **OAuth linked account** after BT login (ADR-004); migration UX for existing patrons still TBD
4. ~~PWA~~ → **PWA at launch** (owner, 2026-10-19 — [Installable app](#installable-app-pwa)); push **Later** (see [Push notifications](#push-notifications-later))
