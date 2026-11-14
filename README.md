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

### The dev seed (end of season + postseason)

The committed fixtures are a handful of games. For real, complete data, record the dev seed once:

```bash
pnpm seed:refresh                                       # last finished season's final month + its postseason
pnpm seed:refresh --start=2026-09-01 --end=2026-09-30   # or any date range (both dates, inclusive)
```

It asks live MLB (through the same HTTP client ingest uses) for every day in the range and each
game those days list, hydrated with plays, video content and play metrics, and writes one
gzipped file to `.dev-seed/seed.json.gz` (git-ignored; `--out=<file>` writes elsewhere). With no
dates it takes the most recent season whose postseason is over: 30 days before its regular
season's last day through its last postseason game. That default is about 450 games: expect
roughly 45 MB gzipped (around 300 MB of JSON) and several minutes to record, depending on MLB;
games MLB won't serve are left out and listed. The next `pnpm dev` loads the file into the local
Postgres after the fixtures (`pnpm db:seed`; loading it again writes nothing), and without one it
prints the command above. Once loaded, the local Worker answers seeded days and games from the
database without asking MLB again, so it needs no network. Re-run the command to refresh the
file. CI and `pnpm verify` never use the seed: they run on the committed fixtures, and the
seed's tests record through a stand-in for MLB into a temporary directory.

### Every game since 1901 (backfill)

To fill a database with every game between two dates, newest first:

```bash
pnpm mlb:backfill                                        # one year before MLB's today through today
pnpm mlb:backfill --from 1901-04-18                      # everything, back to 1901's opening day
pnpm mlb:backfill --from 2024-03-20 --to 2024-11-02      # any range, both dates inclusive
```

- **Defaults.** `--to` is MLB's today (the day the scoreboard shows, New York time) and `--from` one year before
  `--to`. Nothing before `1901-04-18` is ever asked for: an earlier `--from` is clamped to it.
- **The off-season is skipped.** Every day from November 15 through February 15 is skipped without a request.
- **What is stored.** Each day's schedule, and each final game hydrated like the live ingest stores it (live feed,
  videos and recap, play metrics, the GraphQL game content) into the same Postgres tables the app reads
  (`schedule_days`, `games`, `game_projections`). A game already stored unchanged is not rewritten.
- **Pacing.** At most 2 requests in flight per host (statsapi.mlb.com, bdfed.stitch.mlbinfra.com and
  data-graph.mlb.com counted separately), at least 1 s between request starts to a host, and 3 s for games more
  than 10 years old (`--gap-ms N` and `--old-gap-ms N` change them). A `429` or `5xx` backs off exponentially for
  that host (waiting at least as long as `Retry-After` asks). A `429` is retried for as long as it takes, so
  throttling never makes it give up on a day; a `5xx` or a dropped connection is tried 6 times and then counts as
  that request failing (an extra source's failure, or for a schedule or live feed a day left for the next run).
- **Giving up on old-game extras.** Videos, play metrics and the GraphQL content exist only for recent games. Each
  is tracked on its own and given up once it fails (or comes back empty) for 14 consecutive days of games; after
  that it isn't asked for any older date. A run over dates that don't touch an earlier run's counts its own 14 days;
  a run that carries on where another stopped (from the same `--to`, from the day below where it stopped, from a
  later `--to` whose walk reaches the days it counted, or a newer run ending the day above it) carries on its count
  (unless that run gave up: then the newer days count their own 14). Days with no games aren't remembered, so a run
  that starts below a game-less gap (an All-Star break, an off day between one-day runs) starts its count again
  there: that can ask a few more days, but never gives up before 14 failed days of games in a row, except after
  resuming from a resume file saved before this was changed: in one narrow case (a resume that asks again 14 or more
  incomplete days among answered ones, and they all fail), and when that file's streak or give-up was already
  counted across runs that didn't touch, which is kept as it was. The live feed itself is never given up: a game
  whose feed fails leaves its day for the next run.
- **Stopping and resuming.** Stop it any time (Ctrl-C finishes the day in progress; a kill is fine too) and run
  the same command again to resume: a day already complete in the database (its schedule stored, every game
  settled, every final game stored) asks MLB nothing and writes nothing, so it picks up at the first incomplete
  day. Days with games not yet settled (today's, say) are checked again on every run. Each extra source's
  failure streaks and give-up dates are kept in `.backfill/<host>--<database>.json` (git-ignored), so a resumed
  run doesn't re-probe a source it gave up, and a different database starts fresh. To ask a given-up source again
  (or if the command says the file is unreadable), delete that file: every source's streak starts over.
- **Which database.** It writes the database `BT_DATABASE_URL` names, else the local Docker Postgres (as
  `pnpm db:seed` does), and migrates it first. It refuses production: any host that isn't local is refused
  unless `NEON_API_KEY` and `NEON_PROJECT_ID` show it is a Neon branch other than the default (production)
  branch, or you pass `--allow-production`. Logs name the host and database only, never the connection string.
- **How big it is.** It prints progress per day (games stored, sources given up) and, at the end, the row count
  and on-disk size (`pg_total_relation_size`: table, indexes and TOAST) of each game table.
- **Moving it to Neon.** The data is ordinary rows in the app's own tables on the same Postgres version Neon
  runs, so it can be copied table by table into a Neon branch. Migrate the branch first
  (`BT_DATABASE_URL="$NEON" pnpm db:migrate`), then copy the rows in Postgres's custom format, which
  `pg_restore` reads:
  `pg_dump -Fc --data-only -t schedule_days -t games -t game_projections "$LOCAL" | pg_restore --data-only --no-owner -d "$NEON"`.
  This only adds rows: a row already in the branch (the same date or game) makes that table's restore fail on its
  primary key, so restore into a branch without those rows, or empty those three tables first. Alternatively,
  point the backfill at the branch itself (`BT_DATABASE_URL`). Whether it ever goes to production is the owner's
  call.

It asks live MLB, so like `pnpm seed:refresh` it is never run by CI or `pnpm verify`; its tests use fake MLB
clients and the committed recordings.

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

## Production database (Neon)

Production keeps its data in Neon Postgres (ADR-018), which the Worker reaches through
Hyperdrive: `wrangler.jsonc`'s `production` env binds `HYPERDRIVE` to the `bt-production`
config. Every bootstrapping step is safe to repeat (owner, 2026-11-05: "It should be idempotent so it
can happen with every deployment. All the bootstrapping should be like that."), so deploys run them
each time rather than anyone remembering to. **Agents never touch production**: no migrations,
restores or deploys against it, and no production connection string in the repo (CLAUDE.md);
production changes go out only through a published GitHub Release, which the coordinator publishes
when the owner says so (S114, S121).

**One-time setup** (done by the owner 2026-11-02; repeat it only to rebuild from scratch):

1. Create the Neon project (Postgres 18, the major version `compose.yaml` runs) and keep its
   default branch as the production branch. Copy that branch's connection string from the Neon
   console (`sslmode=require`). It stays in your shell and in Cloudflare only.
2. Nothing else by hand. Every deploy (S114) finds the Hyperdrive config `bt-production` by name, and
   creates it on that branch's connection string only if it is missing, so its id is resolved at
   deploy time and never pasted into `wrangler.jsonc` (today it is `db27b03ce9734c3f928241ce8ee855f6`,
   made by hand on 2026-11-02 with `npx wrangler hyperdrive create bt-production`). The tables come
   from `pnpm db:migrate`, which every deploy runs against its own database before the new Worker
   takes traffic. It applies every committed migration the database hasn't had, and running it again
   changes nothing, so the first deploy creates the tables and later ones apply only what's new. To
   run it yourself (to check a database, say): `BT_DATABASE_URL="<connection string>" pnpm db:migrate`.

**Restoring a backup** (a Neon point-in-time restore or branch reset): restore, then deploy
again (re-run the last production deploy in GitHub Actions). Every deploy runs
`pnpm db:reapply-deletions` after migrating and before the new Worker takes traffic, so no one has
to remember it; to run it by hand, `BT_DATABASE_URL="<connection string>" pnpm db:reapply-deletions`.
The deletion log survives the restore, since its entries are only ever added and they hold just a
uid and a time. This step deletes every logged account again from every personal-data store
(ADR-028, S77), so a restore never brings back a fan who deleted their account. The production tables are exactly the ones the data classification manifest labels
(`functions/src/services/data-classification.ts`).

## Deploying (Cloudflare Workers)

`.github/workflows/deploy.yml` deploys the app as a Cloudflare Worker (ADR-017, S114). Agents never
deploy: it runs only on GitHub, with keys only GitHub holds.

**Pull requests into `stage`, releases to production** (S121; owner, 2026-11-07: "I think releases to
main probably should use GitHub releases, if that's actually possible. I want a release to be a set
of PRs basically"; asked who merges a story's pull request and whether `main` stays: "1. You
automatically 2. Mirror"):

- Every story arrives as its own pull request from a `story/S<N>` branch into `stage`. The agent
  opens it, handles Claude's review, then turns on auto-merge, so it merges once `ci-passed` is green; each merge deploys
  staging, `stage.baseball.theater`. Every pull request that changes code also gets a preview (below); a docs-only change runs only the docs checks, and a docs-only merge doesn't deploy staging at all.
- Production, at `next.baseball.theater` until the owner's cutover (below), deploys only when a
  GitHub Release is published (by the coordinator, on the owner's word), and deploys exactly that release's tag, with no approval wait
  (S118). A push to `main` deploys nothing.
- After production is live, the workflow fast-forwards `main` to the released commit, so `main`
  always shows what production runs. It never forces `main`.
- Agents never push directly to `stage` or `main` and never merge into `main`. The coordinator
  publishes a release only when the owner says so; each release has a milestone, and every pull
  request into `stage` is assigned to the next one; CI's `milestone` job fails `ci-passed` until it
  is (#47; owner, 2026-11-13: "Yes, build it that way"). The DNS cutover stays the owner's.
- **The version line.** The foot of the nav rail reads `<release> (<commit>)`, e.g. `v3.2.0 (40767e9)`: the
  milestone of the pull request whose merge commit was built (`scripts/build-release.sh`), so staging
  and production read the same for the same code (#47). A deployed commit that no pull request merged
  reads `unreleased (…)`; a preview reads its own pull request's milestone and head commit; local and
  CI builds read `dev (…)`. A release may target a docs-only `stage` commit newer than the one staging
  serves, and then the commits differ between the two sites though the code is the same (owner,
  2026-11-13: releasing only the served commit "would prevent iterating on stage while waiting to
  push a release to prod"). The label is fixed when the build runs: if a merged pull request's
  milestone is changed after staging built it, staging keeps the old label until its next deploy. Both
  sites serve `bt-commit.txt`, the full commit they run.

- **Previews.** Every pull request that changes code gets its own Worker, `baseball-theater-pr-<number>` on workers.dev,
  once `pnpm verify` passes, and the workflow posts its address on the pull request. Each preview runs on
  its own Neon branch, `preview-pr-<number>`, a copy of the `staging` branch, through its own Hyperdrive
  config, `bt-preview-pr-<number>` (query caching off) (issue #42; owner, 2026-11-13: "Yes, do that.").
  Every deploy resets the branch from `staging` and then runs the pull request's migrations on it, so
  the preview is staging as it is now plus that pull request's changes, and staging's database only
  ever runs `stage`'s migrations. Previews run no cron (they read MLB on request only). Closing the pull
  request deletes its Worker, config and branch (`pnpm deploy:teardown`); a run that finds its pull
  request closed tears it down instead of deploying, and a teardown that finds it reopened deletes
  nothing. **Preview cleanup** (`.github/workflows/preview-cleanup.yml`, weekly and by hand from
  Actions) deletes any preview whose pull request is closed and leaves every open one alone. A preview
  copies staging, which never holds a fan's data, so it holds none either. Limits: Neon allows 10
  branches per project on Free and Launch (25 on Scale; paid plans charge for more), counting
  production and `staging`, and `staging`, being schema-only, also uses one of the plan's root branches;
  Cloudflare allows 25 Hyperdrive configs per account on Workers Paid (10 on Free), counting
  `bt-staging` and `bt-production`. A preview past either limit fails its bootstrap step, saying so;
  staging and production are unaffected.
- **Staging.** Every push to `stage` that changes code deploys `stage.baseball.theater` (a docs-only push deploys nothing) on the Neon `staging` branch.
  The branch is created schema-only from production the first time (production's tables, none of its
  rows) and filled only by `pnpm db:migrate`, so it never holds a fan's data. Copying production's
  baseball data into it is a separate step the owner runs by hand (S117, **Copy baseball data**
  below); no deploy copies data.
- **Releasing.** On GitHub, Releases → Draft a new release: choose a new tag `v*` (e.g. `v3.0.0`)
  with its target the exact `stage` commit that passed the release checks (not the moving branch), then press
  **Generate release notes**: `.github/release.yml` makes the notes the list of pull requests merged
  into `stage` since the last release, which is the stories the release ships. Publishing it
  (`gh release create v3.0.0 --target <checked stage sha> --generate-notes` does the same) runs the deploy workflow
  on that tag: `pnpm verify`, then production's steps (below), then `main` fast-forwards to the
  tagged commit. A release ships everything on `stage` up to its target; there is no picking single
  stories out of the middle, and releasing is no longer done by merging `stage` into `main`. The
  first release must target a commit that has S121's workflow (a release runs the workflow as it is at
  its tag). The owner decides when to release; the coordinator publishes it, on the owner's word (CLAUDE.md).
- **Rolling back.** Three ways, quickest first. (1) `npx wrangler rollback --env production` (from
  `functions/`, with `--config ../wrangler.jsonc`) returns production's Worker to its previous version
  in seconds; add a version id to pick an older one (`npx wrangler deployments list --env production`
  lists them). (2) Re-run the previous release's run of the Deploy workflow (Actions → Deploy → that
  release's run → Re-run all jobs): it deploys that release's tag again, with the workflow as it was at
  that tag. GitHub re-runs a run only within 30 days of it. (3) Otherwise publish a new release with a
  new tag (e.g. `v0.1.1`) whose target is the older release's commit: tag it with
  `git tag v0.1.1 'v0.1.0^{}'` and `git push origin v0.1.1`, then publish a release from that tag.
  This works only if that commit has S121's workflow. In (2) and (3) production goes back but `main` does not: the mirror job fails red on purpose
  ("main … is not an ancestor"), because `main` never moves backwards; the next forward release
  fast-forwards it again. No rollback undoes a migration, which is another reason they stay additive.
- **Production's address until the cutover** (S119; owner, 2026-11-07: "Do the temporary address").
  `baseball.theater` still points at the Elastic Beanstalk (v2) site, and that DNS change, not
  publishing a release, is the real release gate. So production's Worker serves at
  `next.baseball.theater` (its custom domain in `wrangler.jsonc`, with `BT_APP_ORIGIN`
  `https://next.baseball.theater`); its first deploy creates that DNS record itself, and the v2 site
  keeps serving fans untouched.
- **The DNS cutover from Elastic Beanstalk is the owner's deliberate step**, never an agent's. In
  `wrangler.jsonc` env `production`, change the route's custom domain from `next.baseball.theater`
  to `baseball.theater` and `BT_APP_ORIGIN` to `https://baseball.theater` (and the production job's
  environment `url` in `deploy.yml`), then release as usual. Know what that deploy does: wrangler, run
  without a prompt in CI, **replaces the existing apex DNS record** pointing at Elastic Beanstalk with
  the Worker's custom domain, so `baseball.theater` moves to v3 the moment the deploy finishes. Note
  the Elastic Beanstalk record (its CNAME/alias target) before you do it. **Rolling the cutover back:**
  point the `baseball.theater` DNS record back at Elastic Beanstalk in the Cloudflare dashboard
  (remove the Worker's custom domain for `baseball.theater` first, or the next deploy re-claims it),
  and revert the `wrangler.jsonc` change; `npx wrangler rollback --env production` returns the Worker
  itself to its previous version, but does not move DNS.

**What every deploy does**, in order, each step safe to repeat: `pnpm deploy:bootstrap <env>` finds
the env's Neon branch (production's default branch, or `staging`, created schema-only if missing, or
a preview's `preview-pr-<number>`, made from `staging` or reset from it), finds its Hyperdrive config
by name (`bt-production`, `bt-staging`, or a preview's `bt-preview-pr-<number>`, whose origin is
rewritten every deploy) or creates it, and writes the Worker config with that config's id; then `pnpm db:migrate` and
`pnpm db:reapply-deletions` run on that database; then `wrangler deploy` pushes the Worker and every
Worker secret from GitHub secrets (`--secrets-file`), so none is ever set by hand with
`wrangler secret put`. Every deployed env serves live MLB, names its own address as `BT_APP_ORIGIN`,
and refuses `dev:` sign-in (no `BT_LOCAL`); production signs in through Logto (S116, below), and
production's deploy then registers its Logto sign-in addresses (`pnpm deploy:logto production`).

**What the workflow reads from GitHub** (the owner sets these up once; the automation never does):

| Name                        | Kind        | What                                                                                                               |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`      | secret      | Workers Scripts edit, Hyperdrive edit, Workers custom domains / routes and DNS edit on the `baseball.theater` zone |
| `CLOUDFLARE_ACCOUNT_ID`     | variable    | the Cloudflare account                                                                                             |
| `NEON_API_KEY`              | secret      | creates, reads, resets and deletes branches, and reads connection strings, in the project                          |
| `NEON_PROJECT_ID`           | variable    | `old-sun-72319473`                                                                                                 |
| `BT_SESSION_KEY_STAGING`    | secret      | signs sessions on staging and previews                                                                             |
| `BT_SESSION_KEY_PRODUCTION` | secret      | signs sessions on production                                                                                       |
| `LOGTO_S2S_APP_ID`          | secret      | production's Logto machine-to-machine app ID (the `production` job only; a Worker secret too)                      |
| `LOGTO_S2S_SECRET`          | secret      | that app's secret: deletes fans' Logto accounts and sets production's sign-in addresses (`production` job only)    |
| `production`                | environment | no required reviewers; deployments only from `v*` tags, so only a release reaches production's secrets             |

**GitHub settings the owner sets** (S118, S121; agents never change repo settings), in this order:

1. Settings → General → Pull Requests: turn on **Allow auto-merge** (and keep "Allow merge commits" on:
   a story's commit then reaches `stage` with the sha its ledger entry names). Without it
   `gh pr merge --auto` fails.
2. Settings → Rules → Rulesets → New branch ruleset for `stage`: **Require a pull request before
   merging** (0 required approvals, so auto-merge doesn't wait for a review), **Require status checks
   to pass** with the check `ci-passed` (CI's one job that stands for all of them), and **Block force
   pushes**. Leave "Require linear history" off (stories merge as merge commits). Design captures then
   run on the story's branch (`gh workflow run design-capture.yml --ref story/S<N> …`), or add GitHub
   Actions to this ruleset's bypass list too, if they are to commit straight to `stage`.
3. The `main` mirror's deploy key: a write **deploy key** on the repo (Settings → Deploy keys, "Allow
   write access"), its private half stored as the `production` environment secret `MAIN_MIRROR_KEY`,
   and **Deploy keys** added to the `main` ruleset's **bypass list**, so the mirror job can
   fast-forward `main` after a release (a ruleset that requires pull requests would refuse that push).
   A personal-account repo's rulesets don't offer GitHub Actions as a bypass actor, which is why it's a
   deploy key. Without it the mirror job fails after production is already live. With no
   ruleset or branch protection on `main` nothing blocks the push, but one that blocks force pushes and
   deletions keeps `main` a faithful mirror.
4. Settings → Environments → `production` → Deployment branches and tags: **Selected branches and
   tags**, with the tag rule `v*` (remove the old `main` branch rule). A release's run has the tag as
   its ref (`refs/tags/v…`), so a `main`-only policy would refuse it. Keep no required reviewers.
5. Default branch: `stage` (S118), so pull requests, `gh workflow run` and new clones start there.

### Copy baseball data (production → staging, by hand)

`pnpm db:copy-baseball` (S117) gives staging production's baseball data, so testing on
`stage.baseball.theater` starts from every game, schedule and video production has (owner,
2026-11-06: "Delightful, bc it makes testing much faster in stage").

- **What it copies:** only the Postgres tables the data classification manifest
  (`functions/src/services/data-classification.ts`) labels `none`: `schedule_days`, `games`,
  `game_projections` and `replay_artifacts`. It never reads or writes a fan's account, settings,
  sign-in links or entitlements, or the deletion log, so none of them ever reaches staging, not even
  for a moment. A new table is copied only once the manifest labels it `none` and the copy's
  `COPY_RULES` (`functions/src/services/baseball-copy.ts`) says how its rows are compared; a `none`
  table with no rule stops the copy before it touches anything.
- **It only adds.** It never deletes, truncates or drops anything in the target, and rows only
  staging has stay as they are. It copies only the columns both sides have: a column only staging
  has is left untouched, and a column only production has is skipped. A column staging generates
  itself is left to staging. A column only staging has that is required with no default (`NOT NULL`,
  nothing to fill it) makes that table be skipped: it gets none of production's rows, the log says
  why, and the other tables are still copied.
- **Which copy of a row wins** (owner, 2026-11-13: "option A"). Each database counts its own
  versions, so they are never compared between the two. A schedule day or game both sides have is
  replaced only when production's content changed later (`lastChangedAt`). The replaced row gets
  staging's version + 1, so staging's live updates and open pages keep taking only what is newer
  (ADR-022). A row staging changed later, the same content, a change time that can't be read, or a
  game staging is still ingesting (in its active window and changed within the window's trail plus
  an hour) keeps staging's copy, and running the copy again changes nothing. Projections are never
  copied: those of every game it writes, and any a stopped copy left behind, are rebuilt with
  staging's code. A game that can't be projected is named in the log. Games and their projections
  are skipped together (when the target has a `game_projections` table). Replay recordings keep
  whichever has more patches.
- **Tables staging has reshaped are left alone** (owner, 2026-11-13: "I think option b is better").
  It compares the migrations each database has run. A table that a migration production hasn't run
  touches gets none of production's rows, and the log names the migration. If staging's database
  has run a migration this checkout doesn't have, the copy refuses and copies nothing. If production
  has run one staging hasn't, every table is skipped.
- **Migrations:** it migrates the target first (with the checked-out code's migrations; the workflow
  checks out `stage`) and never migrates or changes production. Every read of production runs in a
  read-only transaction of its own, which holds through Neon's pooler too; nothing is set on
  production's session.
- **Never production:** the target can't be production, by name (`production`, `bt-production`), by
  Neon branch (the project's default branch) or by host (the same guard as `pnpm mlb:backfill`, with
  no override), and can't be the database it reads from.
- **No deploy runs it.** No deploy, pull request or push workflow runs it; it runs only when someone
  asks (owner, 2026-11-13: "I want it to be a manual thing for now"). From GitHub: Actions → **Copy
  baseball data** → Run workflow (target `staging`). It reads both connection strings from Neon's
  API with the `NEON_API_KEY` secret, masks them, and logs hosts, tables and row counts only. From a
  terminal, with both connection strings:

```bash
BT_SOURCE_DATABASE_URL="<production>" BT_DATABASE_URL="<target>" pnpm db:copy-baseball
NEON_API_KEY=… NEON_PROJECT_ID=… pnpm db:copy-baseball --neon staging   # both from Neon, as the workflow does
```

`--neon staging` writes only the `staging` branch that deploys already made: with none yet it
refuses and says to deploy staging first, and never creates a branch itself.
A local target (`localhost`, compose.yaml's `postgres`) is always allowed; a hosted one only when
`NEON_API_KEY` and `NEON_PROJECT_ID` show it is a Neon branch other than production's.

### Sign-in (Logto)

Fans sign in with Logto (ADR-019, S116): Logto's hosted page emails a one-time code, and Baseball
Theater has no sign-in screen of its own. The web app reads each env's tenant and app from the
Worker (`GET /api/v1/sign-in`), which reads them from that env's `vars` in `wrangler.jsonc`
(`LOGTO_ENDPOINT`, `LOGTO_APP_ID`). Each env is on its own:

- **Production** signs in through the owner's tenant at `auth.baseball.theater` (tenant ID `rnrngs`,
  in `env.production` as `LOGTO_TENANT_ID`). Its one machine-to-machine app reaches Logto's
  Management API at `https://rnrngs.logto.app` (Logto Cloud serves the Management API on no custom
  domain): account deletion (S77) deletes the fan's Logto account through it, and every production
  deploy uses it to set the single-page app's redirect URI (`<origin>/sign-in/callback`) and sign-out
  URIs (`<origin>/` and `<origin>/settings`) from production's `BT_APP_ORIGIN`, and the sign-in
  experience (email with a one-time code, no password). Each is read first and written only when it
  differs, so a repeat deploy changes nothing, and the DNS cutover (above) moves the addresses with
  the origin. Its ID and secret are the GitHub secrets `LOGTO_S2S_APP_ID` and `LOGTO_S2S_SECRET`,
  which only the `production` job reads and pushes as Worker secrets.
- **Staging** has no sign-in until it has a staging tenant of its own (owner, 2026-11-06: "We will use
  a staging one or a fake shim"); it never uses production's tenant, so a fan's real account never
  works there. Its accounts are test accounts in staging's own database.
- **Previews** offer no sign-in (owner, 2026-11-07: "Yes", to previews without sign-in); staging is
  where sign-in is tested.

**What stays manual, in Logto's console** (the owner's, once):

1. Production's tenant with the custom domain `auth.baseball.theater` (done), and in it a
   **single-page** app (done: `1b1sc2uclfqak0swrahef`, in `env.production`). Leave its redirect and
   sign-out URIs to the deploy.
2. Email sign-in with a one-time code: an email connector (Logto Cloud's built-in one will do) and
   the verification-code email's wording and branding. The deploy turns on email-with-code sign-up and
   sign-in itself; whether the same email can also carry a sign-in link (FEATURES, Modern membership:
   "Code if I have to choose, both if possible in a single email") is the owner's to check in Logto's
   email templates. The code works either way.
3. Production's one **machine-to-machine** app, assigned a role with **Management API** access
   (Logto's "Logto Management API access" role, scope `all`); copy its app ID and secret into the
   GitHub secrets `LOGTO_S2S_APP_ID` and `LOGTO_S2S_SECRET` (repository or `production` environment).
4. The hosted page's branding (logo, colors), if wanted.
5. **When a staging tenant exists:** its own single-page app; add its `LOGTO_ENDPOINT` and
   `LOGTO_APP_ID` to `env.staging`'s `vars` (never production's values). Staging has no
   machine-to-machine app (the plan includes one, production's), so enter its redirect URI
   `https://stage.baseball.theater/sign-in/callback` and sign-out URIs `https://stage.baseball.theater/`
   and `https://stage.baseball.theater/settings` once by hand in its console. Without an admin there, a
   staging account deleted in BT leaves its test account in staging's tenant.

### Launch checklist

Still to finish before a public launch (the _Cloudflare deploy_ Later theme):

- [ ] A legal check of the copies ADR-028 lets age out (the Neon restore window, Patreon's records, provider log
      retention): it accepts them only "If that's legal", to be confirmed and recorded before launch.
- [ ] `support@baseball.theater` routed to the owner's inbox, with a test message received (the failed-deletion
      message links to it).
- [ ] The R2 `ExportStore` adapter (with its 14-day lifecycle rule), so data downloads outlive an isolate.
- [ ] The Cloudflare Email `Mailer` adapter, so download links are actually emailed.
- [ ] Worker log settings that carry no personal fields.
- [ ] Logto's manual setup (Sign-in, above): the email connector and the machine-to-machine app's GitHub secrets,
      before the DNS cutover (the release that matters: owner, 2026-11-06, "the actual production release gate
      is changing the DNS away from the elastic beanstalk destination").
- [ ] DNS cutover from Elastic Beanstalk: the owner points `baseball.theater` at production's Worker (S119, above),
      once `next.baseball.theater` has been checked.

## Scripts

| Command                 | What                                             |
| ----------------------- | ------------------------------------------------ |
| `pnpm verify`           | **Single health gate** (lint + coverage + build) |
| `pnpm dev`              | Postgres in Docker + Worker on workerd + Vite    |
| `pnpm db:seed`          | Migrate and seed the local Postgres (idempotent) |
| `pnpm seed:refresh`     | Record the dev seed from live MLB (see above)    |
| `pnpm mlb:backfill`     | Every game between two dates (see above)         |
| `pnpm db:migrate`       | Migrate the database `BT_DATABASE_URL` names     |
| `pnpm db:copy-baseball` | Copy production's baseball data (by hand only)   |
| `pnpm deploy:bootstrap` | A deploy's bootstrapping (GitHub Actions only)   |
| `pnpm test`             | Vitest (all packages)                            |
| `pnpm test:coverage`    | Coverage + thresholds                            |
| `pnpm lint`             | ESLint                                           |
| `pnpm build`            | lint → typecheck → build                         |
| `pnpm api:spec`         | Regenerate the OpenAPI spec (see below)          |
| `pnpm api:breaking`     | Breaking-change gate against the baseline        |

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
