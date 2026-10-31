# Baseball Theater v3

Clean-slate rewrite of [baseball.theater](https://baseball.theater). Planning docs live in [`docs/`](./docs/).

## Stack (locked)

- **React + Vite SPA** + **Mantine**
- **pnpm** workspaces · **Vitest** · ESLint · Prettier · Husky
- **Cloudflare Workers + Durable Objects**, **Neon Postgres** (via Hyperdrive), and **Logto** for prod (ADR-017–021)
- **Local-first:** fixture MLB data + in-memory repos — **no cloud project required**

## Quick start

```bash
nvm use          # Node 24 LTS (.nvmrc)
pnpm install
pnpm dev         # API :8787 (Worker on workerd) + web :5173
```

`pnpm dev` runs the API as the Cloudflare Worker it ships as (`wrangler.jsonc`,
`functions/src/worker.ts`) on the local Workers runtime, workerd, through `wrangler dev`.
No Cloudflare account or login is needed: the Worker serves the bundled fixtures from
in-memory repos. Set `BT_USE_LIVE_MLB=1` (or `BT_INGEST_TICK=1` to let the cron ingest
tick run) with `--var`, or in a git-ignored `functions/.dev.vars`. The Node server
(`pnpm --filter @bt/functions start`) still exists for the Node-only tools.

Open http://localhost:5173 — scoreboard for `2024-07-04` loads from fixtures.

Useful routes:

- `/games/2024-07-04` — scoreboard
- `/game/744834` — game (impact-sorted videos)
- `/standings`, `/search`, `/settings` — stubs

## Scripts

| Command              | What                                             |
| -------------------- | ------------------------------------------------ |
| `pnpm verify`        | **Single health gate** (lint + coverage + build) |
| `pnpm dev`           | Local API (Worker on workerd) + Vite             |
| `pnpm test`          | Vitest (all packages)                            |
| `pnpm test:coverage` | Coverage + thresholds                            |
| `pnpm lint`          | ESLint                                           |
| `pnpm build`         | lint → typecheck → build                         |
| `pnpm api:spec`      | Regenerate the OpenAPI spec (see below)          |
| `pnpm api:breaking`  | Breaking-change gate against the baseline        |

Loop / agent automation: [docs/v3/LOOP.md](./docs/v3/LOOP.md) · backlog [docs/v3/BACKLOG.md](./docs/v3/BACKLOG.md) · conventions `CLAUDE.md`.

## Packages

```
packages/domain   # pure types + logic (coordinates, impact, entitlements)
packages/ports    # repository / MLB / auth interfaces
functions         # ingest + HTTP API (a Cloudflare Worker; Node tools beside it)
web               # Mantine SPA
fixtures/         # schedule + game JSON for local/CI
```

## Recording fixtures

The committed corpus under `fixtures/` is regenerated from live MLB by one
command. It is the only network-touching entrypoint in the repo:

```bash
pnpm --filter @bt/functions record-fixtures -- \
  --date=2026-09-05 --game=823823 --players=592450,605141
```

It has two recording paths, because the `MlbStatsClient` port returns domain
types and never surfaces upstream JSON:

- **raw** — verbatim upstream payloads into `fixtures/raw/<endpoint>-<key>.json`
  (`schedule-<date>`, `live-<gamePk>`, `content-<gamePk>`, `timestamps-<gamePk>`,
  `standings-<date>`, `people-<gamePk>`). Bytes are written exactly as received,
  so the `packages/mlb-api` coverage gate keeps working; `fixtures/raw` is in
  `.prettierignore` — do not reformat these.
- **normalized** — `fixtures/`-shaped JSON read back by `FixtureMlbStatsClient`
  (`schedule-<date>`, `game-<gamePk>`, `plays-<gamePk>`, `standings-<date>`,
  `players-<gamePk>`). Plays are written as their own file: `fetchGame`
  overwrites inlined plays with `plays-<gamePk>.json`.

**CI and `pnpm verify` never require network.** Both stay on
`FixtureMlbStatsClient`; the live client is opt-in via `BT_USE_LIVE_MLB=1`.
Running the recorder against live MLB and committing the result is a deliberate
human step — review the diff first.

## API spec and breaking-change gate

`openapi/bt-api.v1.json` describes the BT API (`/api/v1/…`) for anyone who
doesn't read the TypeScript. It is **generated** from the typed route table in
`packages/domain/src/api-routes.ts` — never hand-edit it. After changing a route
or a response type, regenerate it and commit the result:

```bash
pnpm api:spec            # rewrite openapi/bt-api.v1.json
pnpm api:spec --check    # CI: fail if the committed spec is stale
pnpm api:breaking        # CI: fail on a backward-incompatible change
```

**`v1` is additive-only** ([ADR-015](./docs/v3/ARCHITECTURE.md#adr-015--api-versioning--compatibility-accepted)):
new routes, new optional fields, and new optional parameters are fine; removing
or renaming a field, tightening a type, or changing a response shape is a
breaking change, and a breaking change means a **new version** (`/api/v2/…`),
not an edit to `v1`.

`pnpm api:breaking` runs [oasdiff](https://github.com/oasdiff/oasdiff) with
`--fail-on ERR`, diffing a freshly generated spec against the committed
**baseline**, `openapi/bt-api.v1.baseline.json` — a separate file, so the gate
is never the spec compared with itself. The baseline is the last contract we
promised clients. **Advance it only as a deliberate, reviewed edit** that
accompanies an additive change: regenerate, confirm `pnpm api:breaking` passes,
then copy the new spec over the baseline in the same commit and call it out in
review. Never automate that copy — a baseline that follows the generated spec on
its own is a disabled gate. The gate checks shape only; a field whose _meaning_
changes while its shape doesn't is invisible to it.

## Capturing a post-game replay

```bash
pnpm --filter @bt/functions capture-replay <gamePk>
```

Walks a **finished** game's timecode diff log once
(`/feed/live/timestamps` → adjacent `/feed/live/diffPatch` pairs), collapses the
idle steps, and stores one replay artifact (base timecode + ordered retained
patches). Any point in the game can then be reconstructed from that artifact plus
the base feed — no live pipeline, no per-viewer MLB egress (ADR-002).

Run it **after the game is final**, and leave a grace window for post-game stat
revisions before capturing. Like the recorder it is network-touching and
**never** run by `pnpm verify` or CI — those exercise only the offline fixture
path (`fixtures/raw/diffpatch-823823.json`).

## Edge cache

Schedule and game responses carry a `Cache-Control` header from ADR-021's ladder (S47,
`functions/src/handlers/cache-control.ts`): outside a game's live window the edge keeps a
response for `cacheLifetimeMs(now − lastChangedAt)` — five minutes after a change, up to 48
hours for a game long unchanged — with `stale-while-revalidate` so nobody waits on a refresh;
inside the window, `no-store`. Refresh-on-read uses the same ladder before asking MLB again.

The cache is **Workers Cache** (`"cache": { "enabled": true }` in `wrangler.jsonc`): Cloudflare
answers from its edge cache, tiered by default, before the Worker runs. Every request, static
assets included, is then billed at the Workers request rate (ADR-017). The 48-hour cap is the
guarantee that a late MLB scoring correction shows up; the intent is also to purge a game from
the cache when ingest knows it changed, which isn't built yet.

## Docs

- [INTENT](./docs/v3/INTENT.md) · [FEATURES](./docs/v3/FEATURES.md) · [ARCHITECTURE](./docs/v3/ARCHITECTURE.md)
- [CHANGELOG](./CHANGELOG.md) — what shipped, in plain language, grouped by effort
- [BACKLOG](./docs/v3/BACKLOG.md) — what's next
