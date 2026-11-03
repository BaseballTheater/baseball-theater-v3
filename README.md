# Baseball Theater v3

Clean-slate rewrite of [baseball.theater](https://baseball.theater). Planning docs live in [`docs/`](./docs/).

## Stack (locked)

- **React + Vite SPA** + **Mantine**
- **pnpm** workspaces · **Vitest** · ESLint · Prettier · Husky
- **Cloudflare Workers + Durable Objects**, **Neon Postgres** (via Hyperdrive), and **Logto** for prod (ADR-017–021)
- **Local-first:** fixture MLB data + Postgres in Docker — **no cloud project required**

## Quick start

**Docker is the one prerequisite** beyond Node and pnpm: local development runs on Postgres
in Docker, the same engine and major version production runs on Neon (Postgres 18).

```bash
nvm use          # Node 24 LTS (.nvmrc)
pnpm install
pnpm dev         # Postgres in Docker, seeded; API :8787 (Worker on workerd) + web :5173
```

`pnpm dev` starts `compose.yaml`'s Postgres and waits until it is healthy, runs `pnpm db:seed`
(applies the migrations and ingests every committed fixture day; running it again changes
nothing), then runs the API as the Cloudflare Worker it ships as (`wrangler.jsonc`,
`functions/src/worker.ts`) on the local Workers runtime, workerd, through `wrangler dev`. The
Worker reaches Postgres through its `HYPERDRIVE` binding, whose `localConnectionString` points at
the Docker database — the same code path as deployed, where it points at Neon. No Cloudflare
account or login is needed. Set `BT_USE_LIVE_MLB=1` (or `BT_INGEST_TICK=1` to let the cron ingest
tick run) with `--var`, or in a git-ignored `functions/.dev.vars`. The data lives in the
`bt-postgres` volume; `docker compose down -v` starts it over. The Node server
(`pnpm --filter @bt/functions start`, used by Lighthouse CI) runs on PGlite in-process instead,
so it needs no Docker; tests run on PGlite too.

### What local can't represent

Local runs the deployed code on the same database engine, but some things exist only on
Cloudflare and Neon:

- **Hyperdrive pooling and caching** — locally the binding connects straight to Docker's
  Postgres, with no connection pool or query cache in between.
- **Neon wake-up delay** — a Neon compute that scaled to zero takes a moment to wake; the local
  database is always up.
- **Edge cache distribution** — Workers Cache across Cloudflare's edge, tiered, isn't there
  locally; `Cache-Control` headers are set but nothing far away honors them.
- **Durable Object placement and eviction** — locally every object lives in one workerd process
  that never moves or evicts one; deployed, objects are placed near their first caller and
  evicted when idle.

Those are checked on a **preview deploy against a Neon branch**, never production.

Open http://localhost:5173 — scoreboard for `2024-07-04` loads from fixtures.

Useful routes:

- `/games/2024-07-04` — scoreboard
- `/game/744834` — game (impact-sorted videos)
- `/standings`, `/search`, `/settings` — stubs

## Scripts

| Command              | What                                             |
| -------------------- | ------------------------------------------------ |
| `pnpm verify`        | **Single health gate** (lint + coverage + build) |
| `pnpm dev`           | Postgres in Docker + Worker on workerd + Vite    |
| `pnpm db:seed`       | Migrate and seed the local Postgres (idempotent) |
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

## API versions

Every API path carries its version (`/api/v1/…`, ADR-015), and each version's lifecycle lives in one table, `API_VERSIONS` in `packages/domain/src/api-versions.ts` (S28). A version is in one of three states:

- **supported** — served normally. v1 is the only version and is supported.
- **deprecated** — still served, but every answer carries `Deprecation` (when it was deprecated) and `Sunset` (when it will stop) headers, so clients and their logs see it coming.
- **sunset** — retired: every request gets **426** with `{"error": "version_unsupported"}` and no data. The web app's API client turns a 426 into the "An update to Baseball Theater is ready." notice with Reload, and keeps whatever is already on screen readable behind it.

The handler writes one log line per versioned request, `{"event":"api_usage","version":"v1","route":"GET /api/v1/schedule"}` (version and route only, never who asked; ADR-028). **Retire a version only once that usage log shows no traffic to it** for the length of the sunset window (the window itself is still open in ADR-015, to be set after a real deploy).

None of this needs a network: `pnpm verify` and the tests drive the lifecycle with their own tables over the committed fixtures, and the usage log goes to the platform's own logs, not a telemetry service.

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

## Live updates

A game in its live window streams over a WebSocket: `GET /api/v1/games/:gamePk/live` (S18;
ADR-020). The Worker hands the upgrade to the game's hub, the `game-hub:<gamePk>` Durable
Object, which holds viewers' sockets through the Hibernation API and passes on what the game's
ingest object (`game-ingest:<gamePk>`, S48) publishes after each write — newer versions only,
with the full current state on connect for a viewer behind (`?since=<version>`). It is one-way:
anything a viewer sends is ignored. A game out of its window gets a `409` pointing at
`GET /api/v1/games/:gamePk`, its cached HTTP form.

Streaming routes sit deliberately outside `ApiRoutes` and the OpenAPI spec: they have no JSON
response type, so the route-table check lets them through only by name
(`STREAMING_ROUTE_EXCEPTIONS` in `functions/src/handlers/api.ts`, S44). Short-poll of the cached
GET remains the fallback wherever a socket can't be had, including the Node server
(`local-server.ts`), which has no hubs and answers the live route with `501`.

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
