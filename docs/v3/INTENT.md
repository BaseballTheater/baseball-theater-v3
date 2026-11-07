# Baseball Theater v3 — Intent

**Status:** Living — edited as the vision changes  
**Origin story:** [ORIGIN.md](./ORIGIN.md) — the goals, clean-slate framing, and planning process v3 started from. Kept for provenance; where it disagrees with this doc, this doc wins.

This document says what Baseball Theater is trying to be **now**. [FEATURES](./FEATURES.md) says what users get; this says how the product is run.

---

## Pillars

Goals were the reasons v3 started. Pillars are how it is run, every day, by everyone working on it.

- **Delightful** — The experience is outstanding — good enough that people wonder how a tool this good exists. It applies to developers as well: a local development experience that requires serious setup is a pain.
- **Inventive** — Baseball Theater offers value found nowhere else in the world.
- **Dependable** — Fans can count on it, especially during games. When something upstream fails, they see slightly older data and keep going.
- **Secure** — Nobody can see or change another person's data or membership, and secrets never reach the browser or the repo.
- **Cost-conscious** — Every recurring cost has to earn its place. The juice must be worth the squeeze.
- **Flexible** — Keep options open: prefer decisions that can be undone, avoid lock-in, keep vendors and data sources swappable.

---

## Document set

| Doc | Purpose |
|-----|---------|
| [INTENT.md](./INTENT.md) (this file) | What BT is trying to be now: pillars, decision index |
| [ORIGIN.md](./ORIGIN.md) | Origin story: starting goals G1–G5, clean-slate framing, planning process (historical) |
| [FEATURES.md](./FEATURES.md) | What v3 *is* for users (keep / cut / add) |
| [VISUAL-DESIGN.md](./VISUAL-DESIGN.md) | How v3 looks and behaves (color, layout, interaction) |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | How v3 is built (greenfield) |
| [BACKLOG.md](./BACKLOG.md) | Checkable implementation stories (command-mapped AC) |
| [LOOP.md](./LOOP.md) | Loop/goal automation readiness + process |

---

## Open decisions (fill as we go)

Record durable choices here once made; details live in FEATURES / ARCHITECTURE.

| Decision | Status | Notes |
|----------|--------|-------|
| Product goals G1–G5 | **Accepted** (origin) | [ORIGIN](./ORIGIN.md#goals-accepted) — why v3 began; not re-evaluated as current |
| Pillars | **Accepted** | This doc |
| Product north star (one sentence) | Draft | See [FEATURES](./FEATURES.md#north-star) |
| Feature carry/cut | **Accepted** | [FEATURES](./FEATURES.md#carry--cut-from-v2-working-table); new themes ship when ready — no “MVP wow” gate |
| Data-access topology (schedule & game details) | **Accepted** | [ARCHITECTURE ADR-002](./ARCHITECTURE.md#adr-002--data-access-topology-for-schedule--game-details-accepted) |
| Hosting / runtime | **Accepted** | Leave EB; **Cloudflare Workers + Neon Postgres** (2026-10-18, superseding Firebase) — [ARCHITECTURE §2](./ARCHITECTURE.md#2-serverless-platform-choice), [ADR-017](./ARCHITECTURE.md#adr-017--platform-cloudflare-workers--neon-postgres-accepted-2026-10-18). Production is `baseball.theater`, shipped first to `stage.baseball.theater` (owner, 2026-11-02: *"baseball.theater (though we will first ship to stage.baseball.theater)"*). Until the owner moves `baseball.theater`'s DNS off the Elastic Beanstalk (v2) site by hand, production runs at `next.baseball.theater`, and that DNS cutover is the real release gate (owner, 2026-11-07: *"changing the DNS away from the elastic beanstalk destination"*; *"Do the temporary address"*; asked whether `next.baseball.theater` is okay: *"Agreed and yes"*) — S119. Each story lands as its own pull request into the `stage` branch, merged automatically once its checks pass, and `stage` deploys `stage.baseball.theater`; the owner releases by publishing a GitHub Release, which deploys production and lists the pull requests it ships, and `main` is kept as a mirror of production (owner, 2026-11-07: *"I think releases to main probably should use GitHub releases, if that's actually possible. I want a release to be a set of PRs basically"*; asked who merges each story into `stage` and whether `main` is kept as a mirror or retired: *"1. You automatically 2. Mirror"*) — S114, S118, S119, S121. (Earlier: every merge to `main` deployed staging with production behind the owner's approval, owner 2026-11-02: *"Yes, agreed."*; then S118 had agents push to `stage` and the owner release by merging `stage` into `main`, owner 2026-11-06: *"we commit to stage, and the stage branch pushes to the stage site. ... main would deploy to production when it gets an update"*; *"we don't need that approval step. We can just deploy when we merge into main"*; S121 superseded both.) |
| Auth vs payments | **Accepted** | Logto for sign-in, BT-owned session ([ADR-019](./ARCHITECTURE.md#adr-019--identity-logto-behind-identity-ports-accepted-2026-10-18)); Patreon OAuth = **linked account** for tier — [ADR-004](./ARCHITECTURE.md#adr-004--identity--patronage-accepted) |
| Auth sign-in methods | **Accepted** | **Email one-time code** at launch, plus a link in the same email if Logto supports it (owner, 2026-10-18: *"Code if I have to choose, both if possible in a single email"*); **no passkeys at launch** (owner, 2026-10-18: *"No passkeys at launch"*) — [ADR-019](./ARCHITECTURE.md#adr-019--identity-logto-behind-identity-ports-accepted-2026-10-18), [ADR-004](./ARCHITECTURE.md#adr-004--identity--patronage-accepted) |
| Patreon account link | **Accepted** | OAuth link after BT login (tier sync); not a login method — [ADR-004](./ARCHITECTURE.md#adr-004--identity--patronage-accepted) |
| Free vs patron entitlements | **Accepted (carry)** | Same v2 gates minus dropped features; server-enforced — [FEATURES](./FEATURES.md#patronage--access-product-level) |
| AI provider(s), grounding, cost controls | Open | Serves G4 |
| Primary client paradigm | **Accepted** | **React + Vite SPA** (no SSR) — [ADR-003](./ARCHITECTURE.md#adr-003--client-delivery-accepted) |
| UI framework | **Accepted** | **Mantine** — [ARCHITECTURE ADR-008](./ARCHITECTURE.md#adr-008--ui-framework-accepted) |
| Package manager / monorepo | **Accepted** | **pnpm** workspaces — [ADR-003](./ARCHITECTURE.md#adr-003--client-delivery-accepted), [ADR-013](./ARCHITECTURE.md#adr-013--local-dev-testing-lint--cicd-accepted) |
| Test runner | **Accepted** | **Vitest** (+ React Testing Library, MSW as needed) — [ADR-013](./ARCHITECTURE.md#adr-013--local-dev-testing-lint--cicd-accepted) |
| External data sources (beyond MLB) | **Direction accepted** | Phased multi-source knowledge — [ARCHITECTURE §3](./ARCHITECTURE.md#3-external-sources--knowledge-layer-direction-accepted), ADR-009 |
| Impact curation / league digests | **Direction accepted** | Per-game impact-sort + day digests — [ARCHITECTURE §4](./ARCHITECTURE.md#4-impact-curation-pipeline), ADR-010 |
| Inning feed + game packages | **Direction accepted** | End-of-inning insights → final package → day rollup — [ARCHITECTURE §5](./ARCHITECTURE.md#5-inning-insight-feed--game-package), ADR-011 |
| Ports & adapters (platform isolation) | **Accepted** | [ADR-012](./ARCHITECTURE.md#adr-012--ports--adapters-accepted) |
| Local dev, testing, lint, CI/CD | **Accepted** | Local Workers runtime + fixtures + **Postgres in Docker** (Neon's major version; ADR-017 amends; S51 — owner, 2026-10-18: *"I want whatever is the most standard in the industry that will work locally and be representative"*); Vitest coverage gates; Husky; GitHub Actions — [ADR-013](./ARCHITECTURE.md#adr-013--local-dev-testing-lint--cicd-accepted) |
| PWA / installability | **At launch** | Reversed 2026-10-19 (was Drop for MVP); owner: *"I'm interested in having it be a PWA though"* — installable, fast shell, offline reading — [FEATURES](./FEATURES.md#installable-app-pwa), [ADR-023](./ARCHITECTURE.md#adr-023--web-client-spa--installable-pwa-accepted-2026-10-19) |
| Settings storage | **Accepted** | On the account, signed-in only; same on every device and free for everyone (owner, 2026-10-19: *"Hide settings for signed out users. Settings aren’t available without signin"*) — [ADR-027](./ARCHITECTURE.md#adr-027--settings-live-on-the-account-accepted-2026-10-19) |
| Personal data deletion | **Accepted** | One inventory of every place BT keeps personal data; a signed-in user can download it and, separately, delete it everywhere at once after typing a phrase; neither needs the other, and someone who wants both downloads first (owner, 2026-10-23: *"I need tools to allow a user to delete all of their data, and it needs to include every single user data source"*; 2026-10-27, replacing download-then-delete: *"Deleting and downloading aren't connected."*). A download is stored for 14 days, can be requested twice in any rolling 24 hours, is linked in Settings and by email, and is deleted with the account (owner, 2026-10-27) — [FEATURES](./FEATURES.md#delete-your-data-g3), [ADR-028](./ARCHITECTURE.md#adr-028--personal-data-one-inventory-and-deletion-reaches-all-of-it-accepted-2026-10-23) |
| Push notifications | **Later** | **Web Push** (VAPID) sent from a Worker (owner, 2026-10-18: *"Keep push notifications"*); received by the PWA's service worker (iOS: installed app only) — [ADR-017](./ARCHITECTURE.md#adr-017--platform-cloudflare-workers--neon-postgres-accepted-2026-10-18), [FEATURES](./FEATURES.md#push-notifications-later) |
| Visual design / brand | **Ratified** (all four surfaces, owner 2026-10-14 — `docs/v3/visual/*/RATIFIED.md`) | 2026 tactile UI; Primary `#CE0F0F` + Dark/Light/Accents; no logos / marketing photo chrome / ads / headlines — Live headshots + Videos highlight thumbnails OK — [VISUAL-DESIGN](./VISUAL-DESIGN.md) |
