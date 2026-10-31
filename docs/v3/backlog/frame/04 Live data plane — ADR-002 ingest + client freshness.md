## Live data plane — ADR-002 ingest + client freshness

Aligned with [ARCHITECTURE §1 / ADR-002](./ARCHITECTURE.md#1-foundational-data-topology-accepted-direction): MLB egress is **backend-only** and scales with **game windows**, not viewer count. Clients read **BT**. Live feel comes from **BT freshness + delivery**—**not** per-tab MLB. Per [ADR-020](./ARCHITECTURE.md#adr-020--live-delivery--cadence-durable-objects-accepted-2026-10-18) / [ADR-022](./ARCHITECTURE.md#adr-022--idempotent-updates-accepted-2026-10-18) (2026-10-18): a per-game **ingest** Durable Object writes Postgres, then publishes versioned updates to **hub** object(s) that push one-way over hibernated WebSockets, in-window games only; everything else is cached HTTP with graduated freshness ([ADR-021](./ARCHITECTURE.md#adr-021--graduated-cache-freshness-accepted-2026-10-18)).

```text
MLB  →  typed fetch (S11–S13)  →  project to BT store shapes (S21)
                                      │
            cron → ingest object per game (S48, from S16) / refresh-on-read (S17 → S47)
                                      │  apply-if-newer, versioned (S43, S46)
                                      ├─ write Postgres (S46 ports → S50 adapter)
                                      │
                                      └─ then publish  →  hub object(s) (S18)  →  one-way WebSocket  →  watched UI (S19; S20 polls the cached schedule)
```

![[S21]]

---

![[S16]]

---

![[S17]]

---

![[S43]]

---

![[S47]]

---

![[S48]]

---

![[S18]]

---

![[S19]]

---

![[S20]]

---

![[S28]]

---

### Later themes (not yet story-sliced)

Keep as themes until promoted; still architecture-aligned when sliced:

| Theme | Arch hook | Note |
|-------|-----------|------|
| Patreon OAuth link + entitlement refresh | ADR-004 / ADR-019 | After S8. Refresh tokens encrypted in Postgres (ADR-018); webhooks deduped on Patreon's event ID and set the tier rather than adjust it (ADR-022). **Carries the ratified Patreon rows** (standings-search-settings A3, 2026-10-22): not linked — "Patreon: not linked. Link your Patreon to unlock supporter features." + "Connect Patreon" (`settings-patreon-unlinked-mobile.png`); linked — "Patreon: linked · {tier}" (`PatronTier`, `packages/domain/src/entitlements.ts`), "Manage on Patreon", "Unlink Patreon" (`settings-patreon-linked-mobile.png`). Owner, 2026-10-22: "Unlink from bt" — so it needs the link state and tier on the account read plus an unlink route; what unlink does to entitlements is settled when sliced. Until then S6 renders no Patreon row. When slicing, ask which frame governs not linked: `settings-account-mobile.png` shows only "Connect Patreon", `settings-patreon-unlinked-mobile.png` adds the line **ADR-028 (2026-10-23 backlog review):** registers a `PersonalDataStore` named `BT database: Patreon link` in the same change (encrypted refresh token, Patreon user ID; `deleteFor` revokes BT's Patreon access, then deletes), labels its tables in S76's manifest, and logs no Patreon email or pledge amount. |
| ~~Cloud-synced settings (patron)~~ | FEATURES patronage | **Owned by S6** (2026-10-19): settings live on the account for every signed-in user (ADR-027) |
| ~~AppShell pairing chrome~~ | VISUAL-DESIGN §5 | **Owned by S60** (2026-10-19) |
| Extra host pairings beyond mobile / medium / desktop | VISUAL-DESIGN §5 | Not wanted — three pairings are accepted |
| ~~Team colors on scoreboard/standings modules~~ | VISUAL-DESIGN §3 | **Owned by S61** (2026-10-19) |
| No-spoilers for free-text titles (video/recap strings) | VISUAL-DESIGN §5a | Decided by **S57** (ratified 2026-10-21, `game-shell/amendments/A2.md`): only the recap video is retitled, "Recap (score hidden)", on the game page; other titles and Search are unchanged. Built by **S75** |
| Win probability (Live chart, scoreboard slot option) | VISUAL-DESIGN ratified frames | Live chart: **S106** from MLB's play metrics (**S93**) (owner, 2026-10-30: "Bring back win probability charts"). Scoreboard slot: on live and final games, not before first pitch (owner, 2026-10-30) — design **S107**, build **S108** |
| Cloudflare deploy (`wrangler deploy` via GitHub Actions; preview against a Neon branch) + environments + IaC | ADR-017 / ADR-013 | Unassigned until the owner is ready to deploy (owner, 2026-10-18). Changing CI/deploy needs the owner's go-ahead. Must exist before S28's "first public deploy" **ADR-028 (2026-10-23 backlog review):** the restore runbook runs S77's `reapplyDeletions` after any Neon restore, and Worker log settings carry no personal fields (ADR-028's inventory: "Server and email logs"). **Legal check (2026-10-24 backlog review, from the 2026-10-23 parity review):** ADR-028 accepts ageing-out copies only *"If that's legal"* ("This is not legal advice; confirm before launch"); this theme owns that confirmation, recorded before the first public deploy, covering the Neon restore window, Patreon's records and provider log retention. **ADR-028 amended (2026-10-27 backlog review):** this theme also builds (1) the R2 `ExportStore` adapter behind S80's port, with the 14-day bucket lifecycle rule as config. R2 lifecycle deletion can run up to about a day late, so BT still refuses an expired download itself (S80 AC 3). (2) The Cloudflare Email `Mailer` adapter. First confirm it can send to any user's address: Email Routing's `send_email` binding sends only to verified destinations, so transactional mail needs Cloudflare's Email Service or an equivalent. (3) Manifest labels for both adapter directories, and the Cloudflare Email row's retention. (4) Wherever download-request times live in production: in R2 they stay under the `Cloud storage: data downloads` row; a Postgres table would be a new `BT database:` row, an ADR-028 amendment. R2 is settled: the owner amended ADR-018 on 2026-10-28 (*"Yes, amend ADR-018"*, `f889213`), allowing R2 for the stored download file only. **Support mailbox (2026-10-28 backlog review, from the 2026-10-28 doc parity review):** (5) `support@baseball.theater` must receive mail before the first public deploy, because S79's failed-deletion message links to it (`mailto:`); this theme sets up its routing to the owner's inbox and records a test message received. |
| Replay artifact retention in Postgres JSONB + post-final trigger | ADR-018 (retention still open) | Prod target for S22; ADR-018 rules out R2/object storage for BT data (ADR-028's 2026-10-27 amendment puts data downloads in R2; ADR-018 isn't amended yet, owner question in the 2026-10-27 backlog review) |
| Cadence parameter tuning (lead/trail/interval) | ADR-002 open knobs | Config once S48 exists; out-of-window lifetimes are ADR-021's tunable ladder |
| Logto adapter + web `AuthClient` + hand-off to Logto's sign-in experience | ADR-019 | After S8 and S59. No BT sign-in screen to design: owner, 2026-10-22: "S58 sign in design can be placeholder for the actual sign in screen. I will use the logto features for that." The header's "Sign in" calls `useSession().signIn()` (S59 AC 1, S60 AC 8), whose body this theme swaps for the Logto redirect; S58 designs only the signed-in Account section and Patreon states. Logto email: code, plus link in the same email if Logto supports both (owner, 2026-10-18) — configured in Logto, not drawn **ADR-028 (2026-10-23 backlog review):** the Logto `IdentityAdmin` adapter is labeled in S76's manifest and is what S77's deletion calls (`DELETE /api/users/{id}`); the recent-sign-in check for deletion becomes a fresh emailed code through Logto (S77's out-of-scope hand-off), and the session's `issuedAt` must reflect that fresh sign-in. |
| Regional live hubs | ADR-020 | Only if speed calls for it — a Worker routing-rule change on top of S18 |
| Multi-source deep links Phase 1 | ADR-009 | |
| Impact Phase B / day digest | ADR-010 | S71 ships the launch digest on the per-game impact rule applied across the day (owner, 2026-10-19); rebuilding it from finished game packages (FEATURES *Inning / game insight pipeline*) and model-assisted ranking is this theme |
| Inning insight feed + game package | ADR-011 | AI enrichment keyed by `(gamePk, version)` so a retry reuses its result (ADR-022) |
| Web Push notifications (VAPID, from a Worker) | FEATURES Later · ADR-017 | Server transitions, not a substitute for S18 watched-game UX. Dedupe record `(gamePk, event, userId)` under a unique constraint before sending (ADR-022) **ADR-028 (2026-10-23 backlog review):** the subscription endpoint and the `(gamePk, event, userId)` dedupe record are personal: register `Push subscriptions` (ADR-028's inventory row) with `deleteFor`, label both in S76's manifest, and keep endpoints out of logs. |
| ~~**Generated DAL adoption**~~ **Sliced into S49 by the 2026-10-18 review.** (`openapi-fetch` as the fetch layer; drop hand-written route-path literals from `web/src/api/client.ts`) | ADR-016 | Split out of **S29** by the 2026-09-16 review. S29 keeps the fidelity guard (generated types + mutual-assignability gate), which is ADR-016's stated value; this is the rest. **Owner, 2026-10-14: no trigger — "No, our own client should use it."** ADR-016 stands unamended; the next backlog review slices this into a story. (Former triggers T1 external consumer / T2 fidelity gate red or a second route family are retired.) **Carry these two when it is sliced:** (a) `web/src/api/client.ts` builds its URLs in backtick template literals (`` `/api/v1/games/${gamePk}` ``) independently of the route key it passes to `getJson`, so route and response type can disagree with nothing to catch it — a cheap non-codegen fix is to derive the path from the route key; (b) the old S29 AC 5 grep was written as `"/api/v1/` (double-quote-prefixed) and would have matched only the two assertions in `web/src/api/client.test.ts`, missing the real literals in `client.ts` — any grep here must cover backticks |
| Internal API explorer (Swagger UI / redoc over `openapi/bt-api.v1.json`) | ADR-015 "Still open" · FEATURES carry | FEATURES carries "ApiTest / swagger explorer" as internal/dev-only, but **no story owns it** and S27 put publishing the spec explicitly out of scope. Found by the 2026-09-16 review. Slicing it is also trigger T1 for the Generated DAL adoption row above — the moment a human reads the spec as documentation, its fidelity stops being hypothetical |

---
