# Changelog

What shipped and why it matters — written for anyone, not just engineers. Each entry
leads with the **impact**: what was true before, what's different now. A **Details** line
underneath gives the technical trail (story ID, ADR, commit) for anyone who wants to go
deeper. Related stories that are clearly part of one larger effort are nested under a
bold section header; a change that stands on its own gets its own bullet.

This project is pre-launch — there's no public release yet, so entries are grouped by
theme rather than version number. **Most of what's below is backend work you can't see
yet** in the running app; it's the pipe that later screens will read from. Entries say so
explicitly where that's the case. For what's still ahead, see
[`docs/v3/BACKLOG.md`](docs/v3/BACKLOG.md).

---

## The site answers your pointer, and the video player does more

- **Before, little on the site reacted when you hovered it, only part of a game card opened the game, the logo did
  nothing on a game page, "Sign in" gave no sign it was working, and the video player was a small window with play
  and pause. Now everything clickable reacts to the pointer with a quick, smooth change (cards lift, video stills
  zoom), the whole game card opens the game, the logo always goes home, "Sign in" shows it's signing you in, and
  your account icon opens a menu with Settings and Sign out. The player is larger on big screens, lets you pick
  the video quality MLB offers, and can copy, open, download or share the clip.** Also: the day's top highlights
  drop their gold background and read down each column, the game's tabs are equal widths and centered, the Plays
  room opens with every play closed, desktop shows one logo instead of two, and Favorite Teams lists "Chicago
  Cubs" in the dropdown and "Cubs" once chosen. Details: fixes #38 (the owner's list of 2026-11-12, built without
  backlog stories at the owner's direction). Hover timing is Material's standard curve over 0.3–0.4s, keyboard
  focus shows the same colours, and nothing moves with reduced motion on. Copy, open, download and share use the
  clip's MP4 file (`fileQuality` in `@bt/domain`), never an HLS playlist, when MLB gives one. Qualities come from the renditions MLB's content API lists for each clip, now
  stored on each highlight (`renditions`, optional in the API; `videoQualities` in `@bt/domain`); clips stored
  before this play their one URL until they are fetched again.

## Staging and the live site show the same version for the same build

- **Before, the version at the foot of the menu was a deploy counter, so the same code read v3.0.191 on staging
  and v3.0.193 on the live site, and its "3.0" never matched the release. Now it names the release the change
  ships in and its commit, like `v3.2.0 (40767e9)`, the same wherever that code runs.** Details: fixes #47 —
  each deploy looks up the milestone of the pull request whose merge commit it builds
  (`scripts/build-release.sh`); CI's new `milestone` job makes every pull request into `stage` carry one
  (`ci-passed` needs it; `milestone-recheck.yml` re-checks when one is added); production now writes
  `bt-commit.txt` too. A commit no pull request merged reads `unreleased`, a local build `dev`. Two
  caveats: a release may target a docs-only commit newer than the one staging serves, so the commits shown can
  differ though the code is the same; and the label is fixed at build time, so if a merged pull request's milestone
  changes after staging built it, staging keeps the old label until its next deploy.

## Test previews no longer change the staging site's database

- **Before, every pull request's test preview ran its database changes on the staging site's database, and they stayed
  there even after the pull request was closed or rewritten, which could leave staging's database out of step with
  staging's code and make it skip later changes. Now each preview gets its own copy of staging's database, refreshed
  from staging on every update and deleted when the pull request closes (with a weekly sweep for any left behind), so
  staging's database only ever gets the changes that actually merged.** Details: fixes #42 —
  `pnpm deploy:bootstrap preview --pr N` makes or resets the Neon branch `preview-pr-<N>` from `staging` and writes
  the Hyperdrive config `bt-preview-pr-<N>`; `preview-teardown` and the new Preview cleanup workflow delete both with
  the preview's Worker (`pnpm deploy:teardown`, `pnpm deploy:cleanup-previews`). Replaces "Previews share staging db"
  (S114) on the owner's word, 2026-11-13.

## Copying production's games into staging keeps the newest one

- **Before, copying production's games into staging could keep a game staging had caught halfway through instead of
  production's finished one, or replace a game staging had updated more recently with production's older copy,
  because it compared counters each database keeps on its own. Now it keeps whichever changed last, staging's live
  updates keep working on a copied game, and it leaves alone any table staging has reshaped that production hasn't
  caught up with.** Details: follow-up to S117. `copyBaseballData` adopts a row only when production's
  `lastChangedAt` is later (`adoptAcrossStores` in `@bt/domain`, ADR-025) and moves staging's `version` past its own
  (ADR-022). It rebuilds copied games' projections with `projectGame`, still compares replay artifacts by patch
  count, and skips every table a migration production hasn't run touches (owner, 2026-11-13: "option A" and "I
  think option b is better"). It refuses when staging has run a migration the checkout lacks. It still runs by hand
  only. Found by Claude's review of PR #21. Fixes #53.

## The game backfill stops asking for missing extras in later runs too

- **Before, once the game backfill had counted anything for a game's extras (videos and recap, play metrics, the
  extra game content), a later run over newer dates didn't count them at all: it asked for them for every game there
  and never gave up, so ten seasons could mean tens of thousands of requests bound to fail. A run over older dates
  that didn't touch the last one could give up too early, carrying on a count from years away. Now each run counts
  the days it walks, joining the count of a run it continues: a newer range gives up on its own instead of asking
  forever, and no extra is given up before it has been missing for 14 days of games in a row (except when resuming
  from a resume file saved before this change: in one narrow case, or when that file already counted a streak across
  runs that didn't touch).** This is a tool for filling Baseball Theater's game store; fans don't see it directly. Details: follow-up to S122 from Claude's after-the-fact review of PR #20 —
  `recordSourceDay` (`packages/domain`) keeps each source's counted stretches and joins the ones a walk connects;
  the resume file stores them (`functions/src/services/backfill-state.ts`, which still reads a file saved in the old
  shape).

## Deleting your account works on the live site

- **Before, deleting your account on the live site always failed with "Couldn't finish deleting your account", and
  nothing was deleted. Now it deletes your Baseball Theater account and your sign-in account, as it was meant to.**
  Details: follow-up to S116 — `LogtoManagementApi` called the global `fetch` as a method (`this.fetch(...)`), which
  the Workers runtime refuses ("Illegal invocation"); it now wraps it, and a test stubs `fetch` the way workerd checks
  it. Found from production's logs, 2026-11-11.

## How many games each day has, a month at a time

- **Before, a calendar wanting to show how many games each day has would have needed a separate request for every
  day of the month. Now one request answers the whole month, straight from what Baseball Theater has stored, and
  days of this season or later, through next year, that it hasn't seen yet are fetched from MLB in a single go.** A
  day it can't know yet says so, rather than
  pretending it has no games. Nothing on screen uses it yet: the calendar date picker that shows these counts comes
  next. Details: **S124** — `GET /api/v1/schedule/month/:month` (`monthGameCounts`, `isCalendarMonth`,
  `ScheduleRepository.listGameCounts`), filled through one `MlbStatsClient.fetchScheduleRange` request and
  `storeSchedule` with no game hydrated, cached by the month's last change (ADR-021); months after December of next
  year are refused (`month_too_late`).

## Testing on staging

- **Before, staging started empty and filled in only as people browsed it. Now, when the owner asks, it gets every
  game, schedule and video production has, with no fan's account or settings, and nothing overwrites it in between.**
  The copy only ever adds: anything being tried on staging ahead of production, new data or new columns, stays as it
  is, and it can never write to production. Details: **S117** — `pnpm db:copy-baseball`
  (`functions/src/services/baseball-copy.ts`: the manifest's `none` tables, matching columns, version-guarded
  upserts, no delete/truncate/drop), `checkCopyTarget` refuses production, run by hand from the `Copy baseball data`
  workflow (`workflow_dispatch` only).

## Every game since 1901

- **Before, BT knew only the few days someone had looked at. Now one command fills it with every game between two
  dates, as far back as 1901, gently enough not to burden MLB; a stopped run picks up where it left off, and at the
  end it says how much room the data takes.** It runs on a developer's machine into the local database first, so the
  owner can see the real size before anything goes near production. Details: **S122** — `pnpm mlb:backfill`
  (`functions/src/services/backfill.ts`), `isOffSeasonDay` / `recordSourceDay` (`packages/domain`), `PoliteFetch`
  (2 requests in flight per host, backoff on 429/5xx), resume state in `.backfill/`, the table-size report.

## Standings all year round

- **Before, the Standings page was empty for half the year: MLB has no standings for any day outside the regular
  season. Now, after the regular season ends, Standings shows how the season finished until spring training starts,
  and during spring training it shows the spring standings.** On the morning a new phase starts, before any of its
  games is final, it keeps showing the previous table. Details: **S128** — `standingsPhase` (`packages/domain`), the
  final and spring-training standings requests, `phase` and `season` on `GET /api/v1/standings`, divisions in one order.

## Standings load again

- **Before, the Standings page showed an error on staging and production, because MLB began refusing standings
  requests that give a date without a season. Now each request names the season too, so standings for any date in
  the regular season load again.** Outside the regular season MLB has no standings for the date, and the page says so. Details:
  found smoke-testing v3.0.0 (2026-11-07); `standingsUrl` (`functions/src/adapters/http/mlb.ts`) adds `season=` (the
  date's year), and the recorder asks the same URL.

## Baseball Theater installs like an app

- **Before, Baseball Theater could only be used in a browser tab, and it loaded from scratch on every visit. Now it
  installs to your home screen or desktop and opens in its own window, comes back instantly on return visits, and
  when a new version is out it floats a quiet "An update to Baseball Theater is ready." notice with Update Now and
  Snooze (snoozing hides it for an hour).** Settings offers the install at the top, or on iPhone and iPad shows
  the Share → Add to Home Screen steps, and stops offering once it's installed; installed on a phone, the app keeps
  clear of the notch and the home indicator. Details: S73 (ADR-023) — `vite-plugin-pwa` manifest and service worker
  at scope `/` (shell precached, never `/api/`; `web/public/_headers` keeps `sw.js` and `index.html` revalidating),
  the update notice in `web/src/layout/NoticeSlot.tsx` shared with S28, the Settings install tip, standalone
  safe-area insets; design matched by the owner (shell-scoreboard A6, standings-search-settings A8); its browser
  flows pass in GitHub CI. _(2026-11-07)_

## An outdated app asks to update instead of breaking

- **Before, nothing covered the day an old version of the app is retired: it would simply start failing with no
  explanation. Now the API can mark a version deprecated (it keeps working, with a warning in every answer) or
  retired, and a retired app floats the same "An update to Baseball Theater is ready." notice as a new release,
  with Update Now and Snooze, while the scores, standings or game already on screen stay readable behind it.**
  Update Now fetches and installs the new version before reloading, so the old saved copy of the app can't answer
  the reload and fail again. Details: S28 — one lifecycle table (`API_VERSIONS` in `packages/domain`),
  `Deprecation`/`Sunset` headers and `426 version_unsupported` in the API, a per-version usage log, the web
  client's 426 middleware (`markVersionUnsupported` → `updateToNewVersion`), and one "keep what's on screen"
  rule (`queryScreen`) shared by the Scoreboard, Standings and Game pages; design matched by the owner
  (shell-scoreboard A6). _(2026-11-07)_
- **Before, if fetching the new version stalled or failed, Update Now could hang forever or reload straight back into
  the retired app, losing the readable screen. Now it gives up after a short wait and keeps the page and the notice
  so Update Now can be tried again, reloading only once the new version has taken over.** Details: follow-up to
  S28 (GitHub Copilot's review of PR #4) — `updateToNewVersion` bounds `registration.update()` and reloads a
  controlled page only after `controllerchange`. _(2026-11-07)_

## Standings show every division's race

- **Before, the Standings page was an empty placeholder. Now it shows every division's standings: each team's
  color, name, wins, losses, winning percentage and games behind the leader, matching the approved design on
  phones, tablets and desktops.** On a phone each team is shown by its short abbreviation so the table fits;
  a wide table scrolls on its own instead of the whole page. Details: S4 — `GET /api/v1/standings`
  (`fixtures/standings-2026-09-05.json`), `web/src/api/standings.ts`, `StandingsPage`, `DivisionTable`;
  design matched by the owner (standings-search-settings A7). _(2026-11-07)_

## Baseball Theater can go live

- **Before, finished work went straight onto the test site's branch, and the live site changed whenever the
  `main` branch did, with no record of what each release contained. Now every finished story arrives as its own
  pull request that merges itself once its checks pass, and the live site changes only when the owner publishes
  a GitHub Release, whose notes list the pull requests it ships; `main` then follows to show what is live.**
  Details: S121 — `.github/workflows/deploy.yml` deploys production on `release: published` from the release's
  tag (same bootstrap → migrate → reapply-deletions → deploy → Logto steps), a `mirror-main` job fast-forwards
  `main` (never forced), `.github/release.yml` for generated notes; CLAUDE.md, the run-stories skill and
  `docs/v3/LOOP.md` move agents to `story/S<N>` branches and auto-merged pull requests into `stage`; README lists
  the owner's GitHub settings (auto-merge, a `stage` ruleset with `ci-passed`, GitHub Actions bypassing `main`'s
  ruleset, `v*` tags for the `production` environment) and how to release and roll back. _(2026-11-07)_
- **Before, nobody could sign in on the real site: accounts and settings only worked on a developer's machine. Now
  fans sign in on production with a one-time code emailed to them, deleting an account also deletes it at the
  sign-in service, and every release sets up the sign-in service's addresses itself.** The test site
  (`stage.baseball.theater`) has no sign-in until it gets its own sign-in service, so it still never holds a fan's
  account; pull-request previews have none. Details: S116 — `LogtoIdentityProvider` / `LogtoIdentityAdmin`
  (`functions/src/adapters/logto/`), `GET`/`POST /api/v1/sign-in`, the web `AuthClient` and `/sign-in/callback`,
  production-only `LOGTO_*` vars in `wrangler.jsonc` and `LOGTO_S2S_*` secrets in the `production` job,
  `pnpm deploy:logto`; README lists the owner's remaining Logto console steps. _(2026-11-07)_
- **Before, someone holding a fan's sign-in for up to an hour could delete their account without a fresh emailed
  code, a second sign-in could carry one fan's settings into another's account, sign-in outages looked like refused
  sign-ins, and signing in from two tabs at once could fail. Now deleting an account really needs a sign-in from
  the last ten minutes, settings always belong to whoever is signed in, outages are reported as outages, and each
  tab signs in on its own.** Details: S120 (fixes from GitHub Copilot's review of S116) — the ID token's `auth_time`
  (asked for with `max_age=0`) carried into BT's session and checked by `deleteAccount`; `hydrateSettings(uid)`
  resets on an account change and drops stale answers; a one-minute JWKS refetch cooldown with one shared fetch;
  `POST /api/v1/sign-in` answers `503 sign_in_failed` for BT's own failures; Logto's keys and the sign-in's return
  path in per-tab `sessionStorage`; session loads for a replaced token are ignored. _(2026-11-07)_
- **Before, the owner's first release would have instantly replaced the current baseball.theater site with the new
  app. Now the new app goes live at `next.baseball.theater` while the current site keeps serving fans, and moving
  baseball.theater over is a separate step the owner takes on purpose, with written steps to undo it.** Details:
  S119 — `wrangler.jsonc` env `production` routes to the custom domain `next.baseball.theater` with `BT_APP_ORIGIN`
  `https://next.baseball.theater`; `deploy.yml`'s production `url` and test constants follow; README documents the
  DNS cutover from Elastic Beanstalk and its rollback, and the launch checklist gains it. _(2026-11-07)_
- **Before, every change went straight to the branch that becomes the live site, and releasing meant clicking an
  approval. Now changes land on a `stage` branch and go live at `stage.baseball.theater` first; the owner puts
  them on `baseball.theater` simply by merging `stage` into `main`, and nothing reaches the live site any other
  way.** Details: S118 — `.github/workflows/deploy.yml` deploys staging on a push to `stage` and production on a
  push to `main` (no longer gated on staging or an approval); `ci.yml` runs on both branches; CLAUDE.md, the
  run-stories skill, `docs/v3/LOOP.md` and README say agents push only to `stage`. The owner sets the default
  branch to `stage` and removes the `production` environment's required reviewers in GitHub. _(2026-11-06)_
- **Before, the app ran only on a developer's machine. Now every proposed change can be tried at its own web
  address before it's merged, every merged change goes live at `stage.baseball.theater` for a final look, and
  the owner releases to `baseball.theater` with one approval (and can roll back in one command). The test sites
  never hold fans' accounts or settings, and none of them accepts the developer's pretend sign-in.** Details:
  S114 — `.github/workflows/deploy.yml` (preview Worker per pull request, staging on every push to `main`,
  production behind the GitHub environment `production`), `wrangler.jsonc` envs `preview` / `staging` /
  `production`, `pnpm deploy:bootstrap` (`functions/src/deploy/bootstrap.ts`: the schema-only Neon `staging`
  branch and the `bt-staging` / `bt-production` Hyperdrive configs found or created by name, Worker secrets from
  GitHub secrets), `pnpm db:migrate` + `pnpm db:reapply-deletions` before every deploy, `dev:` sign-in only when
  `BT_LOCAL` is `"1"`. Not yet run on GitHub. _(2026-11-06)_

## The scoreboard opens on the right day

- **Before, Baseball Theater always opened on a fixed sample day from 2024. Now it opens on today during the
  season — spring training through the World Series — and, once the season is over, on the day of the World
  Series final until the next spring begins, so the off-season shows the last games played instead of an empty
  day.** Details: S111 — `defaultScoreboardDate` / `mlbToday` (America/New_York) in `packages/domain`, MLB's
  season calendar and World Series schedule through `MlbStatsClient.fetchSeasonCalendar`,
  `GET /api/v1/scoreboard/default-date`; design matched by the owner. _(2026-11-03)_

## The app opens faster, and has room to grow

- **Before, everything in Baseball Theater downloaded up front, even pages you might never open, and the first
  download had reached its size limit, so the next feature would have failed the size check. Now the
  scoreboard loads first, and the game, standings, search and settings pages download only when you open
  them, each as its own file. The first download shrinks by about a quarter, from 199.9 KB to 150.4 KB, and
  while a page arrives you see the usual loading spinner.** Details: S110 — `React.lazy` routes in
  `web/src/routes.tsx` behind `ViewState`'s loader; entry chunk 150,405 / 200,000 bytes gzipped (ADR-026).
  _(2026-11-02)_

## A game's videos are easy to browse

- **Before, a video didn't say which play it showed. Now a clip with a play carries a small "Play · Top 6th →" link, on its card, in the list and in the player, and following it opens the Plays room right on that at-bat, marked. Every play that has a clip says so with a "Video:" line, and thumbnails no longer show a play icon.** Details: S97 — `videoPlayLink` from S95's links, the `?play=` arrival in `PlaysPanel`; built to game-shell A5 and game-rooms A6; design matched by the owner. _(2026-11-04)_
- **Before, nothing showed how a video should lead to the play it shows. Now there's an approved design for it, ready to build: a small "Play · Top 6th →" link on each clip that has a play, the Plays room opening right on that at-bat, and a "Video:" line on every play that has a clip. Video thumbnails also lose their play icon.** Details: S96 — game-shell A5 and game-rooms A6, ratified by the owner; built by S97. _(2026-11-04)_
- **Before, "biggest moments first" was a guess from each clip's title, so any home run beat a game-saving
  catch or a big two-out single. Now the clips are ordered by how much their play actually changed each team's
  chance of winning, by MLB's own numbers: in the Cubs–Marlins sample game, Griffin Conine's two-run homer
  (which swung the odds almost 20 points) leads, ahead of solo homers that mattered less. Clips with no single
  play, like graphics and the recap, follow in the old order.** Details: S98 — `rankHighlightsByImpact` in
  `packages/domain` ranks by the absolute win probability added (S93), key moments and lead changes first among
  ties, through the one pitch-to-at-bat lookup `atBatIndexByPitch`; run in `withGameExtras` with the play
  metrics; keyword order when there are none. _(2026-11-04)_
- **Before, a highlight couldn't be watched inside Baseball Theater. Now tapping a clip plays it right there,
  floating over the dimmed page with a Close button (and, from Search, a link to its game). Or, if you prefer,
  it plays in a fixed player above the clips. The required MLB notice always shows under it, and on iPhone it
  stays in the page instead of jumping to fullscreen.** Details: S70 — `VideoPlayer`, `PlayerDialog`
  (game-shell A4), `PlayerStage`, `PlayerHost`; Settings → Game Detail → Video Player; `clipClock` in
  `packages/domain`; Space plays / pauses, Esc closes; design matched by the owner. _(2026-10-31)_
- **Before, a game's highlights were a plain list of titles. Now they show as a grid of video stills (or a
  list, if you prefer), grouped into Pre-game, Game highlights, Statcast and Post-game, each group folding
  away with a tap. You can search them, sort by biggest moments or by time, and narrow them to one team's
  clips or the stat-and-chart clips.** Details: S69 — `VideosRoom`, `VideoCard`, `QuickFilters` with a
  Filters drawer; `filterHighlights`, `sortHighlights`, `groupHighlights` in `packages/domain`; video
  kind, date, teams and tags mapped from MLB's content keywords; design matched by the owner. _(2026-10-30)_

## Each scoreboard game shows what you care about at a glance

- **Before, tapping a folded-up game on the scoreboard only unfolded it, and a second tap was needed to open it.
  Now tapping a folded-up game opens that game straight away, the same as tapping a full one.** Details: S126 —
  `CollapsedBar` links to `/game/<gamePk>` like `ScoreboardModule`, and the scoreboard no longer tracks expanded
  bars; the bar looks the same. _(2026-11-08)_
- **Before, every game on the scoreboard took the same space and every score was always visible. Now games
  without your favorite teams can fold into slim bars (`CHC ● 1–0 ● MIA`, the inning and count underneath) that
  open with a tap, and one switch hides every score, record and pitcher of record for fans catching up later.**
  Details: S68 — `scoreboardRows`, `collapsedBarState`, `shouldHideScores` in `packages/domain`;
  `useScoresHidden`, `HiddenValue`, `CollapsedBar`; Settings → Game List switches; design matched by the
  owner. _(2026-10-30)_
- **Before, Hide Scores protected only the scoreboard: opening a game's Live or Plays tab, or its videos, gave the
  result away. Now, with Hide Scores on, the game page keeps the score out of sight too — Live masks the score,
  a pitch that drove in a run reads "IN PLAY", Plays masks the line score and the score after each scoring play,
  the recap is headed just "Recap", and the recap video reads "Recap (score hidden)". The pitches, plays and
  batters' lines stay, and the box score is unchanged for anyone who opens it.** Details: S75 — `pitchCallLabel`,
  `recapHeading`, `isGameRecapHighlight`, `highlightTitle` in `packages/domain`; `Linescore`'s hidden mode; every
  room asks `useScoresHidden(game)`; design matched by the owner. _(2026-11-03)_
- **Before, the right side of each game on the scoreboard was empty. Now it shows the winning and losing
  pitchers once a game ends, the bases, count and who's batting and pitching while it's live, and tonight's
  starters before first pitch — or, if you choose Room Menu in Settings, quick links straight into the game's
  Videos, Live, Plays, Box and Recap.** Details: S67 — `GameRowSlot`, `slotOccupant` / `countShorthand` /
  `probableLine` in `packages/domain`, the Game-Row Slot setting; design matched by the owner. _(2026-10-30)_

## The backend runs the way it will in production

- **Before, Baseball Theater had nowhere real to keep its data once it's online. Now the production database is wired up: the deployed app points at it, one command creates or updates its tables and is safe to run on every release, and there's a written runbook for restoring a backup without bringing back anyone who deleted their account.** Details: S113 — `pnpm db:migrate` (`migrateDatabaseAt`), `pnpm db:reapply-deletions`, `wrangler.jsonc` `env.production` on the `bt-production` Hyperdrive config for Neon, README's Production database section. _(2026-11-05)_
- **Before, a developer running Baseball Theater locally saw a handful of recorded games. Now one command records the end of last season and the whole postseason from MLB, real and complete, and the local app loads it on start and serves it without going back to MLB; the same command records any date range.** Details: S112 — `pnpm seed:refresh` (`recordDevSeed` through `HttpMlbStatsClient`, default range from S111's season calendar) into the git-ignored `.dev-seed/seed.json.gz`; `pnpm db:seed` loads it (`loadDevSeed`, idempotent); the local Worker answers stored days and games from Postgres (`overlayMlbClient` / `storeOverlay`). _(2026-11-04)_
- **Before, running Baseball Theater on a developer's machine kept its data in memory, which doesn't behave like the real database. Now `pnpm dev` starts the same database engine and version production uses, fills it with the recorded games, and runs the app against it, with Docker as the one thing to install.** Details: S51 — Postgres 18 in Docker (`compose.yaml`), `pnpm db:seed`, the Worker on Hyperdrive's `localConnectionString`; checked coming up for real on a GitHub runner (design-capture run 41934225471), accepted by the owner. _(2026-11-04)_
- **Before, Baseball Theater could only guess which plays mattered from the words in a clip's title. Now it
  keeps MLB's own measure of every at-bat: how much it swung each team's chance of winning, and whether MLB counts
  it as a key moment, a lead change, a home run, a hard hit, a high-leverage spot or an ABS challenge. Nothing on
  screen uses it yet; the win-probability chart and better video ranking build on it.** Details: S93 — MLB's
  play-metrics feed recorded for 823823, typed and parsed in `packages/mlb-api`, `MlbStatsClient.fetchPlayMetrics`,
  `GameSnapshot.playMetrics` (optional: absent when the feed fails). _(2026-11-02)_
- **Before, Baseball Theater couldn't tell which play an ABS challenge video shows: MLB's usual video feed links
  those clips to nothing. Now it keeps MLB's own link from each video to the exact pitch it shows, for 18 of a
  game's 25 videos on the sample game (three ABS challenges among them), plus MLB's related news stories about the
  game. Nothing on screen uses it yet; linking videos to their plays builds on it.** Details: S94 — MLB's GraphQL
  game content (`data-graph.mlb.com`, persisted query `getGamesByGamePks`) recorded for 823823, typed and parsed in
  `packages/mlb-api`, `MlbStatsClient.fetchGameGraphContent`, `GameSnapshot.videoPlayRefs` / `relatedArticles`
  (optional: absent when MLB's call fails). _(2026-11-02)_
- **Before, Baseball Theater didn't know which play a video shows: every video carried the id of its video file,
  which matches no play. Now every video of a single play knows its play — 20 of the sample game's 40, including
  all five ABS challenge clips, two of which MLB links to nothing and BT matches to the one challenge that fits.
  Graphics, the recap and the condensed game stay unlinked rather than guessed. Nothing on screen uses it yet; the
  video-to-play link in the app builds on it.** Details: S95 — the content mapper reads MLB's `guid`;
  `videoPlayLinks` in `packages/domain` adds S94's `playIdRef` and matches ABS clips to S93's challenges by team
  and outcome (from the live feed's `reviewDetails`, now `AtBat.challenge`); each video carries `playId` and
  `playLink: "mlb" | "challenge"`. _(2026-11-03)_
- **Before, Baseball Theater could only keep its data in memory, which empties whenever the server restarts.
  Now it has a real Postgres database layer, checked against exactly the same rules as the test stores: an
  older update can never overwrite a newer one, and deleting your account removes your rows. It isn't
  switched on yet; the next step runs local development on it.** Details: S50 — Drizzle schema and migration
  in `functions/src/adapters/postgres/`; the shared storage contract on PGlite; Hyperdrive binding declared
  (ADR-018). _(2026-11-02)_
- **Before, a game in progress only changed on your screen when the page refetched it. Now the game page
  follows it live: each new pitch arrives within moments, nothing you have open (an at-bat, a pitch, a video)
  closes or jumps, and if the connection drops it reconnects by itself, falling back to checking every 15
  seconds until it can.** Details: S19 — `useLiveGame` / `LiveGameStream` (`web/src/api/live.ts`,
  `live-stream.ts`, loaded on demand) over S18's WebSocket; newer versions only through `writeGame`, a
  refetch on a skipped version, backoff with jitter and `?since=`; design matched by the owner. Under
  `pnpm dev` the Vite proxy doesn't carry WebSockets yet, so local runs poll. _(2026-10-31)_
- **Before, there was no way for the backend to tell a browser "this game you're watching just changed". Now
  each live game has a hub that pushes every saved change to everyone watching it, sends a viewer who fell
  behind the whole current state first, never sends the same update twice, and recovers on its own after a
  restart.** Details: S18 — `GET /api/v1/games/:gamePk/live` (a WebSocket for in-window games, a `409`
  pointing at the cached GET otherwise), the `game-hub:<gamePk>` Durable Object on the Hibernation API,
  `LiveGameHub` port with an in-memory adapter; S48's ingest objects now publish to it. The app doesn't
  open the socket yet (S19). _(2026-10-30)_
- **Before, live games were only polled while a developer's laptop server was running. Now each game in
  progress gets its own always-recovering poller on Cloudflare: it checks MLB on the game's cadence, saves
  every change before telling anyone about it, and stops by itself once the game is over.** Details: S48 —
  `GameIngestObject` (`game-ingest:<gamePk>` Durable Object) over `GameIngest` and `HubLeases`, the cron
  ensuring one per in-window game; a game-over game is now stored like a final one; the Node server shares
  the Worker's composition. Hubs that deliver to viewers are S18. _(2026-10-30)_
- **Before, every finished game was re-fetched from MLB every few minutes for as long as anyone looked at it.
  Now the longer a game goes unchanged, the longer Cloudflare's edge serves it straight from its cache (up to
  two days), and the backend asks MLB again less and less often — while a scoring change still resets it to
  five minutes, and a late correction shows up within two days at most.** Details: S47 — `edgeCacheControl`
  (`Cache-Control` from `cacheLifetimeMs`, `stale-while-revalidate`; `no-store` in the live window),
  refresh-on-read on the same ladder, Workers Cache on in `wrangler.jsonc` (every request billed at the
  Workers rate, ADR-017). _(2026-10-30)_
- **Before, the API only ran as a laptop-style Node server, unlike anything it would be deployed on. Now
  `pnpm dev` runs it as the Cloudflare Worker it will ship as, on Cloudflare's own local runtime, still with one
  command and no cloud account — and the test suite checks it there too.** Details: S45 — `wrangler.jsonc`,
  `functions/src/worker.ts` / `worker-app.ts`, fixtures bundled into the Worker, a workerd test via
  `@cloudflare/vitest-pool-workers`; ADR-017. _(2026-10-30)_

## A scoreboard you can read at a glance

- **Before, finding the day's best moments meant opening each game. Now the scoreboard ends with "Best of"
  the day: the top five clips across every game, ranked, with the one to watch first marked, each playable right
  there with a link to its game.** Details: S71 — `dayDigest` in `packages/domain` (the per-game impact rule
  across the day), `GET /api/v1/digest`, `DayDigest` on the scoreboard, one shared lazy `PlayerDialog`; design
  matched by the owner, five clips confirmed. _(2026-11-02)_
- **Before, the scoreboard showed scores as of the moment the page loaded, so a game in progress looked frozen
  until you refreshed. Now games in progress update on their own every 15 seconds, and refreshing pauses while
  the tab is hidden, so it isn't wasted effort.** Details: S20 — `LIVE_REFRESH_MS` and `whileVisible` in
  `web/src/api/freshness.ts`, applied by the schedule hook; design matched by the owner. _(2026-11-02)_
- **Before, the scoreboard was a rough grid of score cards with the ballpark on every game and raw error
  text. Now each game is a clean card with its team colors down the edge and each team's record: finished and
  live games show runs, hits and errors, a live game shows a blinking dot with the inning, and a game that
  hasn't started shows its start time in your own time zone and the ballpark.** Arrows step to the day before
  or after, and loading, no-games and error screens match the approved design. Details: S66 —
  `ScoreboardModule`, `DateControl`, `teamRecordLabel` / `addDays` in `packages/domain`, one date formatter
  (`formatDate`); design matched by the owner. _(2026-10-30)_

## Browsing a game's plays inning by inning

- **Before, the Plays tab was one long list of every at-bat in the game, opening at the first pitch. Now it opens
  on the latest inning with something to show, a sidebar jumps to any inning or to every scoring play of the game
  with the score after each, and opening an at-bat shows the same pitcher and batter cards, strike zone and
  pitch-by-pitch list as Live.** Details: S41 — `PlaysPanel`, `defaultPlaysInning` / `inningHalves` /
  `scoringPlays` in `packages/domain`, `AtBat.result.awayScore` / `homeScore`; design matched by the owner.
  _(2026-10-29)_

## Watching a game live, pitch by pitch

- **Before, the Live room showed the bases, the count and every pitch, but not who was likely to win. Now, on a tablet or computer, a chart beside the field shows how each at-bat swung the home team's chances and where they stand now; with Hide Scores on it stays put but hides the line. Each pitch row also shows an up or down arrow, as the approved design draws it.** Details: S106 — `winProbabilitySeries` in `packages/domain` (S93's play metrics), `WinProbabilityCard` (one SVG, no chart library) in `LiveRoom`; the pitch chevrons in `PitchSequence` (owner, during the design match); design matched by the owner. _(2026-11-04)_
- **Before, the Live page said the outs three times and the count twice: in words beside the dots that already
  showed them, and again on a line underneath. Now the inning shows once, as "Top 3rd", and the count and outs
  show only as the dots, so there is less to read.** Details: S109 — `LiveStatus` reads `inningLabel` alone;
  the mobile matchup line drops `Count: … · … Out`; `outsLabel` removed (game-rooms A5); design matched by the
  owner. _(2026-11-02)_
- **Before, the Live room showed only the score, count and inning. Now it shows the matchup — who's pitching
  and batting, with their lines so far — the bases, every pitch of the at-bat newest first, and a catcher's-eye
  view where each pitch flies in at its real speed along its real path, into the batter's own strike zone.**
  The zone, plate, batter and pitch paths are all drawn to one true scale from MLB's data, so where a pitch
  lands against the zone is where it really crossed. Side and top views are a tap away, and a new pitch
  replays itself as it arrives. Details: S64 — `StrikeZoneChart` on one camera (`packages/domain`
  `catcher-view.ts`), `pitchFlight` / `pitchPlayback`, `field-chart.ts`, `MatchupCards`, `PitchSequence`,
  `BaseDiamond`; design matched by the owner. _(2026-10-29)_
- **Opening an at-bat in Plays now brings it to the top of the screen and replays its pitches in a quick,
  overlapping volley.** Details: S64 (owner-directed, ahead of S41) — `PlaysPanel`, `atBatReplaySchedule`.
  _(2026-10-29)_

## A finished game has its box score and its written recap

- **Before, the Box and Recap rooms of a game were empty. Now Box shows the full linescore with every inning in
  its own box (sized to its content and centred for now), each team's batting line — at-bats, runs, hits,
  RBI, walks, strikeouts and average — behind a team switcher, and the game's facts (venue, first pitch,
  weather, wind, length, attendance).** Details: S2 — `Linescore`, `BoxRoom`; `linescoreCells` in
  `packages/domain`; `GameSnapshot.boxscore`; `fixtures/game-823823.json` rebuilt from MLB's recording; design
  matched by the owner. _(2026-10-29)_
- **Recap shows MLB's written story of the game — headline, then plain paragraphs, marked "Source: MLB" — and
  the Recap tab only appears when there is a recap to read.** MLB's page markup is never shown as-is; it's
  turned into plain text first. Details: S10 — `RecapRoom`; `mapRecap` / `articleParagraphs`;
  `GameSnapshot.recap`; `roomsForPhase(phase, hasRecap)`; design matched by the owner. _(2026-10-29)_

---

## A game in progress shows its score, count and inning at a glance

- **Before, the Live room of a game in progress was blank. Now it opens with the score (`NYY 4 · BOS 3`), lit
  dots for balls, strikes and outs, and the inning (`Top 6th`) — a slim row under the tabs on a phone, a small
  card on a tablet or computer.** Screen readers hear the count in words ("Balls: 2 of 3"). The diamond,
  the pitch view and the pitch list fill the rest of the room next. Details: S3 — `LiveStatus` in
  `web/src/components/game/`; `inningLabel` / `ordinal` in `packages/domain`; design matched by the owner. _(2026-10-29)_

---

## Each game on the scoreboard now carries what the approved rows show

- **Before, the scoreboard had nothing to show beyond the teams and the score. Now every game carries its
  start time (shown in your own time zone, labeled — `4:10 PM EDT`), each team's record, the probable
  starters with their season record and ERA, the winning, losing and saving pitchers, and — while a game
  is on — who's on base, who's batting and pitching, and the count.** A full recorded day (September 5, 2026) and a before-the-game and a mid-game moment are rebuilt from MLB's own recordings rather than
  typed. The scoreboard screen shows them next. Details: S65 — `ScheduleGameSummary.startTime` /
  `teams.*.record` / `probablePitchers` / `decisions` / `live`; `formatGameTime` in `packages/domain`;
  `fixtures/schedule-2026-09-05.json`; `mapLiveFeedSummary`. _(2026-10-29)_

## A game in progress now knows who's on base and who's batting

- **Before, the app had no record of who was on base or who was batting in a game in progress, and no
  real mid-game moment to build the Live screen against. Now a live game carries its runners, its
  current batter and pitcher, and each pitch's movement in inches, and the project keeps a real
  recorded moment — Cubs at Marlins, top of the 3rd, bases loaded, two out, 2–2 — rebuilt from MLB's
  own change log rather than typed by hand.** Nothing shows it yet; the Live screen's next step does.
  Details: S63 — `GameSnapshot.live`, `PitchBreaks.breakHorizontal` / `breakVertical`;
  `fixtures/game-823823-live.json` from `functions/src/services/live-fixture.ts`; `baseRunners`,
  `zoneLabel`, `breakInches` in `packages/domain/src/live.ts`. _(2026-10-29)_

## Every team has its color, readable on the dark background

- **Before, the app had no team colors to show. Now each of the 30 clubs has its official color, lightened
  just enough wherever it would vanish on the dark background (Yankees and Tigers navy, Padres brown,
  White Sox black), and the standings' six divisions have their names.** Nothing shows them yet: the
  scoreboard, box score, standings and search pages use them as they're built. Details: S61 —
  `teamColor`, `contrastSafeTeamColor`, `divisionName` in `packages/domain/src/team-colors.ts`;
  `TeamEdge`, `TeamSwatch`, `MatchupAbbr` in `web/src/components/team/`. _(2026-10-29)_

## Each finished piece of work keeps its own proof; a short list of rules is checked forever

- **Every change is now timed on a mid-range phone and clicked through the main screens before it
  lands.** Before, nobody would learn a page had become slow on a phone until users felt it, and the
  automatic build skipped two of the everyday checks. Now the build opens the scoreboard and a game on a
  throttled phone profile and walks scoreboard → game → every room, standings, search and settings; a
  page that takes over 2.5 s to show its main content gets a warning naming the page and the time, and
  over 5 s fails the build. Today both pages warn (about 2.9–3.2 s) — fixing that is next. Details: S62 —
  `lighthouserc.json`, `e2e/flows/main.spec.ts`, `pnpm e2e`, `pnpm lighthouse`; CI runs `pnpm verify`
  (law P11). _(2026-10-29)_
- **Every story's proof now finds "the change this story shipped in" the same way, from the record of
  what shipped.** Before, there were two lookups that could disagree, and one depended on every commit
  being worded just right forever; now both read the ledger, and every past proof was re-run against
  the code it shipped with. Details: S88 — `story_tip` reads `shipping_commit`,
  `scripts/backlog-vault/story-tip.test.ts`. _(2026-10-29)_
- **Four more rules now hold automatically on every change: screens size themselves in one place,
  the app in your browser never contacts MLB directly, nobody's email or downloaded data ends up in
  a log, and the everyday checks never need to open a browser.** Before, each was only checked when a
  story happened to look; now breaking one fails the build. Details: S85 — laws P1, P3, P5, P8 in
  `docs/v3/LAWS.md`, three rules in `tools/eslint-rules/`, `scripts/backlog-vault/verify-chain.test.ts`.
  _(2026-10-28)_
- **Before, a check written to prove one finished piece of work could start failing later just
  because a different, perfectly valid change touched the same file, and some old checks had been
  quietly loosened to keep passing. Now each story's proof is tied to that story's own work and can
  be re-run exactly as it shipped, while a short, named list of permanent rules (like "browser
  storage lives in one place" and "the app stays under 200 KB") is checked on every change.** Every
  one of the project's 52 past proofs was re-run against the code it shipped with, and all pass; the
  two that had been loosened were put back. Details: S84 — `docs/v3/LAWS.md`, `scripts/lib/checks.sh`
  `story_diff`, `scripts/audit.sh story --reverify` / `design`, `scripts/reverify-all.sh`. _(2026-10-28)_

## New screens are checked against the approved designs

- **Before, a new screen's design screenshots could only be taken on the owner's own computer, so work done in the cloud stalled waiting for it. Now GitHub takes them on request: name the story, and the screenshots come back as a download, or straight into the project if asked.** Details: S115 — `.github/workflows/design-capture.yml` (`workflow_dispatch`, inputs `story` and `commit`), running exactly `e2e/design/<story>.spec.ts`. _(2026-11-04)_
- **Before, every change waited for each automated check in turn, about nine minutes. Now the checks run side by side, so a change learns sooner whether it is safe, and a broken screenshot script still fails the check without taking new pictures.** Details: S89 — `ci.yml` runs verify, the flows (`--workers=4`, `--repeat-each=2`), the design specs (`pnpm e2e:design`) and Lighthouse as parallel jobs, plus one `ci-passed` gate; `pnpm e2e` runs only `e2e/flows/` and the harness. _(2026-11-04)_
- **Before, the app's frame looked close to the approved design but not quite: the logo's letters
  were in the wrong typeface, the highlighted menu item was the wrong red, and the menu text was
  smaller and greyer than drawn. Now the logo uses its real typeface, the menu matches the drawing,
  and the owner compared the screenshots with the designs and said they match.** Details: S83 —
  Adobe Fonts kit in `web/index.html`, `Wordmark`, `NavRail`, `AppHeader`, with values read from
  the Figma file; captures in `docs/v3/design-checks/S83/`. _(2026-10-28)_
- **Before, a new screen was checked only by tests that read its words, so it could pass and still
  look different from the approved drawing. Now every new screen is photographed at phone, tablet
  and desktop size and set beside its drawing, and the owner says whether they match before the
  work counts as done.** The first comparison, of the app frame shipped earlier today, found real
  differences (the logo's typeface and the menu's highlight color), which are next in line to fix.
  Details: S81 — Playwright in `e2e/`, `pnpm design:capture`, `scripts/audit.sh story --design-match`,
  backlog rule 22 enforced by `pnpm backlog:check` (ADR-026 as amended 2026-10-28). _(2026-10-28)_

## Every page now sits in the approved app frame

- **Before, every page sat inside a temporary frame with an old title and a debug label. Now every
  page opens in the approved header, with the side menu on wide screens and a slide-out menu on
  phones and tablets, a quiet "Fetched 12s ago" line at the bottom, and a place for app-wide
  notices.** Signed out, the header offers "Sign in"; signed in, the account icon goes to Settings.
  The browser tab shows BT's flag, and the menu's foot shows the exact build you're running. A
  game's own top bar replaces the header, its tabs stretch across the screen, and the "live" dot
  stops blinking for people who've asked their device for less motion. Each screen now lays itself
  out for phone, tablet or desktop the same way, from one place. Details: S60 —
  `web/src/layout/` (`AppShellLayout`, `NavRail`, `NoticeSlot`, `FooterMeta`, `version.ts`),
  `fetchedAgo` in `packages/domain`, `ViewState`, `LiveIndicator` (ADR-014). _(2026-10-28)_

## Settings work now, and follow you to every device

- **Before, the Settings page was an empty placeholder and there was nowhere to keep a favorite team.
  Now a signed-in fan picks their favorite teams and which tab a game opens on, and those choices are
  saved to their account, so they follow them to every device.** Settings shows who you're signed in
  as and has a "Sign out" link, as the approved design draws it. A game now opens on your chosen tab
  when that tab exists for it (a finished game has no Live tab, so it opens on Videos). Your settings
  are part of the data you can download and delete, and signing out clears the copy kept in your
  browser. Details: S6 — `GET`/`PUT /api/v1/me/settings`, `SettingsRepository`
  (`BT database: settings`), `web/src/settings/store.ts`, `SettingsPage` (ADR-024, ADR-027,
  ADR-028). _(2026-10-24)_

## You can download everything we keep about you, and erase it

- **Before, there was no button anywhere to get your data or erase your account. Now Settings has
  both: "Download your data" makes a copy you can save (kept 14 days, and we email you a link), and
  "Delete account" erases everything once you type a confirmation phrase — with a reminder to grab
  an unexpired download first, a "sign in again" step when it's been a while, a "Try again" plus a
  support email if something fails, and a plain page saying your account is gone.** The owner
  compared every screen with the approved designs and said they match. Details: S79 —
  `web/src/pages/settings/AccountData.tsx`, `DeletedAccountPage.tsx`, captures in
  `docs/v3/design-checks/S79/` (ADR-028; standings-search-settings A4, A5). _(2026-10-29)_
- **Before, nothing could tell a browser that had just deleted its account apart from any other
  signed-out visitor. Now the server remembers a deletion once, privately (a cookie the page can't
  read, carrying no personal information), so Settings can say the account is gone and then forget
  it; and any other cookie fails the build until the owner decides otherwise.** Details: S87 —
  `functions/src/services/cookies.ts`, `account_deleted` on `/api/v1/me`, law P10 in
  `docs/v3/LAWS.md`. _(2026-10-29)_
- **Before, the approved picture of "your account is gone" was a small banner over the scoreboard
  that could be closed. Now the owner has approved a plain page instead: right after deleting, the
  Settings page shows only "Your account and your data are deleted.", once.** Details: S86 —
  `docs/v3/visual/standings-search-settings/amendments/A5.md`. _(2026-10-29)_
- **Before, the system allowed an account with no email address, so some people could never be
  told their data download was ready. Now every account has an email: a sign-in without one is
  refused before anything is stored, and the "your download is ready" email always goes out.**
  Details: S82 — `email` is a required string on the account, `/api/v1/me`, and the identity
  ports; `signIn` refuses with `NoEmailError`. _(2026-10-29)_
- **Before, there was no approved picture of how someone downloads or deletes their data. Now
  the owner has approved every step:** "Download your data" and "Delete account" in Settings, a
  download kept for 14 days with its date shown, what you see if you ask too often, a deletion you
  confirm by typing a phrase (with a reminder to grab an unexpired download first), signing in
  again when it's been a while, what happens if deletion fails (try again, and an email address
  for support every time), and the scoreboard you land on once your account is gone. The next step
  builds it exactly as drawn. Details: S78 — `docs/v3/visual/standings-search-settings/amendments/A4.md`
  (ADR-028). _(2026-10-28)_
- **Before, you had to download your data before you could delete your account, and the download
  only existed in that moment. Now downloading and deleting are separate choices: a download is
  kept for 14 days, you get an email with a link to it in Settings, and deleting your account
  deletes the download too.** You can ask for a download twice a day; a third request says when
  you can ask again. The email only links to Baseball Theater, so the data itself never travels by
  email, and only you, signed in, can open it. Deleting still needs a recent sign-in and the typed
  phrase, but no longer a download first. This is server work; the Settings screens come next.
  Details: S80 — `POST`/`GET /api/v1/me/download`, `GET /api/v1/me/download/:downloadId`,
  `ExportStore` and `Mailer` ports with in-memory adapters, `packages/domain/src/downloads.ts`;
  the deletion token and `GET /api/v1/me/export` are gone (ADR-028). _(2026-10-28)_
- **Before, there was no way for anyone's data to be downloaded or erased. Now the server can hand a
  signed-in user all of their data and then, once they've confirmed every way we can ask, erase it
  from every place it's kept, at once.** Deleting needs three things together: a sign-in from the last
  ten minutes, typing a confirmation phrase exactly, and a download made just before (the download
  hands out a one-time key that expires in fifteen minutes). If something fails partway, trying again
  finishes the job, and if an old backup is ever restored, deleted accounts are erased again. The
  Settings screens that use this come next. Details: S77 — `GET /api/v1/me/export`,
  `POST /api/v1/me/delete`, `functions/src/services/account-deletion.ts` (ADR-028). _(2026-10-24)_

## Every place that keeps your personal information is on one list

- **Before, the app could store someone's personal information anywhere, with no way to erase it,
  and nothing would notice. Now every place that holds personal information is on one list with a
  way to erase it, and the build fails if someone adds a new place that isn't on the list.** This is
  groundwork you can't see yet: it's what the upcoming "download and delete your data" feature walks,
  and signing out now clears every personal item the app keeps in your browser, not just the sign-in.
  Details: S76 — `PersonalDataStore` port, `functions/src/services/personal-data.ts` registry,
  `data-classification.ts` manifest, repository contract case (h), `bt/no-browser-storage` and
  `web/src/storage/` (ADR-028). _(2026-10-24)_

## The app knows when you're signed in, and Settings is for signed-in users

- **Before, the app had no idea who was using it, and the Settings page was open to everyone even
  though settings belong to an account. Now the app knows whether you're signed in and as whom,
  signed-out visitors no longer see Settings (going to it takes you to the scoreboard), and a
  developer can sign in locally with one click.** Real sign-in through Logto comes later; the button
  that will start it is already wired to one place, so it can be swapped in without touching the
  screens that use it. Details: S59 — `web/src/session/`, the session middleware in
  `web/src/api/client.ts` (ADR-014 rule 7, ADR-027). _(2026-10-23)_

## The server can now tell who is asking

- **Before, every request to the server was anonymous: there was no account, no sign-in and no way
  for the server to know who was calling. Now the server has its own user accounts and its own
  signed sign-in pass, so a signed-in request proves who it is from without a database lookup, and
  the app can ask "who am I?" to show "Signed in as {email}". It works locally with a test sign-in,
  and the real sign-in service can be plugged in later without touching the rest of the app.**
  Nothing looks different in the app yet; Settings and the sign-in button build on this.
  Details: S8 — identity ports in `packages/ports/src/auth.ts`, `functions/src/services/session.ts`,
  `functions/src/services/accounts.ts`, `GET /api/v1/me` (ADR-019). _(2026-10-23)_

## Every game and schedule now carries a version, so a late update can't undo a newer one

- **Before, the server's stored games and schedules had no way to tell a fresh update from a stale
  one: a delayed or repeated update could quietly replace newer information, and the test stand-ins
  for the database didn't behave like a real database. Now every game and schedule carries a version
  number that goes up only when something actually changed, every store ignores an update that isn't
  newer than what it holds, and one shared set of checks holds every store — today's stand-ins and
  the real database to come — to the same behavior.** Nothing looks different in the app yet; this
  is groundwork for live updates and the move to Postgres.
  Details: S46 — ports in `packages/ports/src/repositories.ts`, `stampVersion` in
  `packages/domain/src/versioning.ts`, `functions/src/adapters/repository-contract.ts`.
  _(2026-10-23)_

## The app's API calls come straight from the API's published description

- **Before, the web app wrote out each server address by hand, separately from the description of
  what that address returns, so the two could drift apart without anyone noticing until a page
  broke. Now every call goes through a client generated from the API's published description: an
  address the API doesn't offer, a missing piece of the address, or the wrong kind of data is caught
  when the app is built, not by a user.** Nothing looks different in the app.
  Details: S49 — `web/src/api/client.ts` (`openapi-fetch`, `createClient<paths>` over
  `web/src/api/generated/bt-api.v1.ts`).
  _(2026-10-23)_

## The server speaks the standard web language, and its routes can't drift from the contract

- **Before, the API's request handling was written for one kind of server (Node's), and a new
  address could be added to it without anything checking it against the published list of what
  the API offers. Now the handlers use the standard request/response shape that every modern
  hosting platform understands — including Cloudflare, where the API is headed — and a test fails
  the moment the server answers an address the contract doesn't list, or the contract lists one
  the server doesn't answer.** Nothing changes for people using the app; this is groundwork that
  lets the API move to Cloudflare without a rewrite.
  Details: S44 — `functions/src/handlers/api.ts` (`handleApiRequest(request, ctx)`,
  `API_ROUTER`), `functions/src/adapters/node/http.ts`, `functions/src/handlers/route-table.test.ts`.
  _(2026-10-23)_

## Your account page is designed

- **Before, there was no approved picture of your account once you signed in, and the old
  design still offered a "magic link" sign-in that Baseball Theater no longer plans to use. Now
  the account section is approved: it shows who you're signed in as, a plain "Sign out" link,
  and whether your Patreon is linked — with your supporter tier, a way to manage it on Patreon,
  and a way to unlink it from Baseball Theater. Signing in itself will use Logto's own screens,
  so Baseball Theater doesn't build its own.** Nothing changes in the app yet; this unblocks
  building it.
  Details: S58 — `standings-search-settings/amendments/A3.md` and
  `shell-scoreboard/amendments/A5.md` (desktop header re-exported with the ratified version
  line), ratified 2026-10-22.
  _(2026-10-22)_

## What Hide Scores hides is designed

- **Before, turning on Hide Scores masked the scoreboard, but nobody had decided what a game page,
  a recap or a highlight list should show, so the setting couldn't be trusted to keep a game
  unspoiled. Now every screen has an approved answer: browsing shows no scores or winning
  pitchers, collapsed games show only their inning, and the recap video is retitled
  "Recap (score hidden)". Once you open a game's details you get the information you asked for:
  the box score is complete and the recap article is readable under a plain "Recap" heading, with
  only the running score kept back on Live and Plays.** Nothing changes in the app yet; this
  unblocks building it.
  Details: S57 — `amendments/A3.md` in game-rooms and shell-scoreboard, `amendments/A2.md` in
  game-shell, ratified 2026-10-21.
  _(2026-10-21)_
- **Nothing on screen announces that scores are hidden; the dashes and shaded blocks are the
  only sign, so the page stays as quiet as a normal one.**
  Details: owner direction, no story — `game-rooms/amendments/A4.md`, `game-shell/amendments/A3.md`,
  `shell-scoreboard/amendments/A4.md`, ratified 2026-10-21; S60 and S68 updated.
  _(2026-10-21)_

## The menus, signed-out view and loose ends are designed

- **Before, the menu and account buttons on the approved screens led nowhere anyone had agreed on,
  and a few drawn details contradicted later decisions. Now every button has an approved
  destination: the menu slides in on phones and tablets, signed-out visitors see "Sign in" and no
  Settings, a highlight found in Search plays right there with a link to its game, iPhones get
  step-by-step install instructions, and the stray details (a filter button, a subscription link,
  the version label) match what was decided.** Nothing changes in the app yet; this unblocks
  building it.
  Details: S56 — `amendments/A2.md` in shell-scoreboard, game-rooms and standings-search-settings,
  `amendments/A1.md` in game-shell, ratified 2026-10-21.
  _(2026-10-21)_

## The installed app and offline reading are designed

- **Before, nobody had drawn how Baseball Theater looks when it's installed on a phone, when the
  connection drops, or when a new version is ready. Now those screens are approved: the installed
  layout around the phone's notch and home bar, an "offline" marker that says how old the saved
  scores are, what a never-opened tab looks like offline, the wording of the update notice, and a
  quiet "Install app" link in Settings.** Nothing changes in the app yet; this unblocks building it.
  Details: S55 — `amendments/A1.md` in three design surfaces, ratified 2026-10-21 (ADR-023).
  _(2026-10-21)_

## The app can't quietly get heavier or less tested

- **Before, the app's download could grow and the tests could cover less without anyone
  noticing. Now every check run fails if the code that loads before the page is usable passes
  200 KB (it is about 144 KB today), and each part of the code must stay at least as well tested
  as it is now — the bar only goes up.** Tests can also count how often a screen redraws, so a
  slow screen can be caught and pinned. Nothing changes in the app itself. Details: S54 —
  `pnpm size` (`size-limit`, `.size-limit.json`) in `pnpm verify`, coverage floors at measured
  values, `web/src/test/renderCount.tsx`, backlog rule 21 (ADR-026). _(2026-10-20)_

## Copied code and out-of-date comments get caught automatically

- **Before, nothing noticed when a block of code was copy-pasted somewhere new, or when code changed
  and the comment explaining it didn't. Now every check run fails on copy-pasted code, a one-line
  command lists comments that may have gone stale after a change, and every story has to record
  what existing code it reused before writing new code.** Nothing changes in the app itself; this
  keeps the code easier to trust as it grows. Details: S53 — `pnpm dup:check` (`jscpd`,
  `.jscpd.json`) in `pnpm verify`, `pnpm comments:stale` (`tools/comments-stale/`), backlog rule 20
  (ADR-025). _(2026-10-19)_

## "Is this game live?" now has one answer everywhere

- **Before, the app decided whether a game was live in three different ways, so the scoreboard,
  the game page and the data feed could disagree, and nothing stopped the next screen from adding
  a fourth. Now each of those answers — the game's phase, which tabs it shows, what a pitch did —
  is worked out in one tested place, and an automatic check rejects any screen that does its own
  math on game data.** Pitch dots now use the app's own ball / strike / in-play colors, and the
  Live tab shows only while a game is actually being played — not during warm-up or a delay. Details: S52 — `packages/domain/src/game-phase.ts`, `pitch-outcome.ts`,
  `battedBallChartRangeFt` in `coordinates.ts`; ESLint rule `tools/eslint-rules/no-domain-arithmetic.js`
  (ADR-025); `experimentalDecorators` removed from `tsconfig.base.json` (ADR-024). _(2026-10-19)_

## The old Google database code is gone

- **Before, the code still carried a Firebase/Firestore database the project had already decided
  to leave, so anyone reading it could build on a dead path. Now the repo has no Google Cloud
  dependency at all — only the storage the app actually runs on remains, and Postgres takes over
  the durable side.** Nothing visible changes in the app. Details: S42 — deleted
  `functions/src/adapters/firestore/`, `@google-cloud/firestore`, the `BT_USE_FIRESTORE` switch in
  `functions/src/local-server.ts`, `firebase.json` and `.firebaserc` (ADR-017). _(2026-10-19)_

## Repeated updates can't roll a game backward, and quiet games stop being re-checked

- **Before, nothing guaranteed that a duplicated or late update couldn't put an older state of a
  game back on screen, and every finished game was re-checked every five minutes forever. Now one
  tested rule keeps only the newest version of a game whatever order updates arrive in, a
  fingerprint tells a real change from a repeat, and one schedule decides how long an unchanged game
  may be cached — five minutes right after a change, growing to two days for a game that has gone
  quiet.** This is groundwork: nothing uses it yet; the live path and the edge cache build on it.
  Details: S43 — `packages/domain/src/versioning.ts` (`applyIfNewer`, ADR-022),
  `content-hash.ts` (`contentHash`), `cache-lifetime.ts` (`cacheLifetimeMs`, ADR-021), each with
  its colocated test. _(2026-10-19)_

## Game pages open with the approved header and only the tabs that fit

- **Before, every game page showed the score at the top, even where the design says it must
  never appear, and offered all five tabs whether or not they made sense: a Live tab on a
  finished game, a Recap tab before first pitch. Now a game opens with a simple top bar (back to
  that day's scoreboard, the two teams, the date, and a green `LIVE` dot while it's on), only the
  tabs that fit the game's moment, and the same loading, empty and "couldn't load, retry" look
  in every tab.** Details: S40 — `web/src/components/game/` (`GameTopBar`, `gamePhase`,
  `RoomState`, `LiveRoom`), `web/src/pages/GamePage.tsx`, tested in `GamePage.test.tsx` and
  `gamePhase.test.ts`. _(2026-10-15)_

## The app now wears its approved colors

- **Before, the app still used the old reddish-dark background and could flip to a light mode
  the design no longer has. Now every screen sits on the approved near-black, the app is always
  dark (the browser's toolbar matches), and the approved card, highlight, readable-red and
  pitch colors (ball green, strike red, in play blue) are ready for each screen built next.**
  Details: S39 — `web/src/styles.css` tokens, Mantine `colors.dark` + `forceColorScheme="dark"`
  in `web/src/App.tsx`, `theme-color` in `web/index.html`, tested in `web/src/App.test.tsx`.
  _(2026-10-15)_

## Every screen now has an approved design to build from

- **Before, the drawings for the app existed but nobody had signed off on them, so no screen
  could be built. Now the owner has approved all four sets — the scoreboard and app frame, the
  game screen and Videos, the Live / Plays / Box / Recap rooms, and Standings / Search /
  Settings — and the stories that build those screens can start.** Along the way the owner made
  the calls the drawings were waiting on: scores never sit in the game's header; Plays became a
  browsable, inning-by-inning list of every at-bat with each pitch and the strike zone, plus a
  scoring-plays view; pitches are colored ball green, strike red, in play blue; the page is a
  near-black `#10100F` with warm-grey cards; red text is brighter so it reads on dark; the
  day's highlights get a dull-gold card with the clip's thumbnail; Settings gains Favorite
  Teams and a Video Player choice. No visible change in the app yet; this is design work.
  Details: S31, S32, S33, S34 — `docs/v3/visual/*/DESIGN.md` and `RATIFIED.md`; VISUAL-DESIGN
  §3, §5, §5a, §6, §9 updated. _(2026-10-14)_

## The Standings, Search and Settings drawings now cover every screen size

- **Before, Standings, Search and Settings were drawn only for phones, and Settings was
  organized by kind of preference ("How It Looks", "What Is Hidden"), not by the part of the
  site each option changes. Now all three screens are drawn for phones, tablets and desktops,
  and Settings is grouped as Game list, Game detail and Account, with the scoreboard's
  right-hand-block choice and the collapse-other-teams switch both under Game list.** No
  visible change in the app yet; this is design work. Details: S38 — R13, R17b, R18 applied in
  Figma; 9 exports plus `REVISIONS.md` in `docs/v3/visual/standings-search-settings/`, which
  S34 catalogs. By owner decision Hide Scores sits under Game list. _(2026-10-13)_

## The Live, Box and Recap drawings now match what the owner decided

- **Before, the Live drawing hid the pitch that just happened at the bottom of a collapsed
  list and put the pitcher and batter below the action, and every game room showed where the
  game was played. Now the newest pitch is at the top and already open, the pitcher and batter
  sit above the strike zone, and the ballpark appears only on the box score.** No visible
  change in the app yet; this is design work. Details: S37 — R6, R7, R8, R11, R12, R18 applied
  in Figma; 12 exports plus `REVISIONS.md` in `docs/v3/visual/game-rooms/`, which S33 catalogs.
  By owner decision the Live top bar keeps plain team abbreviations (no records). _(2026-10-12)_

## The game screen's design drawings now match what the owner decided

- **Before, the drawings of a game's screen always showed all five tabs, put a red "LIVE"
  sticker on finished games, used a fixed two-column video layout, and had no video player
  (so no place for the required MLB notice). Now they show only the tabs that make sense for
  a game before, during and after play, the video grid widens with the screen and switches to a
  list, and a player carries MLB's disclaimer in every version.** No visible change in the app
  yet; this is design work. Details: S36 — R6, R7, R10, R14b, R15, R18 applied in Figma; 12
  exports plus `REVISIONS.md` in `docs/v3/visual/game-shell/`, which S32 catalogs. The player's
  dialog-vs-stage choice and the first filter fields stay open for S32. _(2026-10-10)_

## The scoreboard's design drawings now match what the owner decided

- **Before, the drawings of the app shell and scoreboard disagreed with decisions the owner
  had already made: city-style records under the scores, error hints in the wrong color, no
  place for an app notice, no room-menu option for a game row, and the empty / loading /
  error / hidden-scores / collapsed screens drawn for phones only. Now the drawings match those
  decisions at every screen size, so the design that gets approved (and later built) is the
  one the owner actually chose.** No visible change in the app yet; this is design work.
  Details: S35 — revisions R6–R18 applied in the Figma file; 22 exports plus `REVISIONS.md`
  in `docs/v3/visual/shell-scoreboard/`, which S31 catalogs for ratification. _(2026-10-10)_

## Pages now share one copy of the data, so updates land everywhere at once

- **Before, each page fetched its own copy of a game or a day's scores, so two parts of the
  screen could disagree and every visit re-fetched from scratch. Now the app keeps one shared
  copy: when it updates, everything showing that game updates together, and nothing you have
  open — a play you expanded, a tab you switched to — gets thrown away and rebuilt.** How often
  the app re-checks is decided by the server, so pages don't poll for news that can't exist yet.
  Details: S25 — TanStack Query v5 with one descriptor, hook and named cache writer per resource
  (`web/src/api/game.ts`, `schedule.ts`); payload types derive from the S26 route contract; a
  type-level test proves a wrong-typed cache write fails the build. Groundwork for live updates
  (S19/S20) — see [ADR-014](docs/v3/ARCHITECTURE.md#adr-014--client-state-management-accepted).
  _(2026-09-15)_

## Under the hood: the app's API now has a public description, and a check that stops it breaking existing clients

- **Before, the only description of how to talk to the app's server was its own source code, and
  nothing stopped a change from quietly breaking an app or tool that relied on it. Now there's a
  standard, machine-readable description of the API that anyone can read, generated automatically
  from the code, and every change is checked against the last published version — anything that
  would break an existing client is blocked before it ships.** No visible change in the app.
  Details: S27 — `openapi/bt-api.v1.json` is generated from the S26 route table (`pnpm api:spec`,
  never hand-edited); `pnpm api:breaking` runs oasdiff against the committed baseline
  `openapi/bt-api.v1.baseline.json`, and CI runs both. See [ADR-015](docs/v3/ARCHITECTURE.md#adr-015--api-versioning--compatibility-accepted).
  _(2026-09-15)_
- **Before, that API description was generated from the code but nothing checked it was actually
  right — a missing field or a wrong "can be empty" marker could sit in it, trusted and wrong.
  Now the app's own build reads the description back and fails if it no longer matches the data
  the server really sends, so it can't quietly drift from reality.** No visible change in the app.
  Details: S29 — `openapi-typescript` renders the spec into committed `web/src/api/generated/`
  (`pnpm api:types`, offline; a Vitest drift test fails when it's stale); a type-level test proves
  each route's generated type and its `*Response` alias are mutually assignable, and
  `api/game.ts` / `api/schedule.ts` now take their payload types from the generated module. See
  [ADR-016](docs/v3/ARCHITECTURE.md#adr-016--generated-client-dal-from-the-openapi-spec-accepted).
  _(2026-09-18)_

## Behind the scenes: the project plan is now browsable and editable in Obsidian

- **The plan of what gets built next used to be one 1,700-line document that was hard to find
  your way around. Now every planned piece of work is its own note, with sortable tables of
  what's done, what's next, and what depends on what, and it can be edited right there.** The
  single combined document still exists and is rebuilt automatically, so nothing that relied on
  it breaks, and the automated checks refuse any change where the two drift apart.
  Details: vault migration V1–V3 ([docs/v3/VAULT-MIGRATION.md](docs/v3/VAULT-MIGRATION.md)):
  story notes in `docs/v3/backlog/`, `pnpm backlog:build` regenerates `docs/v3/BACKLOG.md`,
  and `pnpm backlog:check` runs in `pnpm verify` and CI. No product change.
  _(2026-09-13)_

## Under the hood: a mismatch between the app's server and its screens now gets caught before it ships

- **If a future update ever made the server send different data than a screen expects, that
  mistake is now caught automatically before the change goes out — not discovered later as a
  broken page.** Every API route now also carries a version number, so a future change to
  how the server responds can't silently break something that was already relying on the
  old shape.
  Details: S26 — one shared, checked declaration ties each route to its response type on both
  the sending and receiving end; routes moved to `/api/v1/…`. Also lays a cheap seam
  (`<Type>Response` aliases) for decoupling the API from internal changes later, without
  building a full separate contract layer now — see [ADR-014](docs/v3/ARCHITECTURE.md#response-aliases--the-dto-seam-accepted-2026-09-13).
  _(2026-09-13)_

## The app looks like Baseball Theater now — not a placeholder

- **The app switched from a stand-in color scheme and font to its real brand look**: a
  red/gold/green palette, one consistent typeface (IBM Plex Sans) for headings and body
  alike, and automatic light/dark mode that follows your device instead of being locked to
  one setting. This is visible today if you open the app — every screen built from here
  forward starts on-brand instead of needing a redo later.
  Details: S24 — five brand tokens wired into the Mantine theme (`defaultColorScheme="auto"`,
  primary color anchored on `#CE0F0F`), old placeholder tokens and gradient removed. _(2026-09-13)_

## Cloud-storage readiness

- **The app's data can now live in Firestore (Firebase's database) instead of only in the
  server's memory, with no other code needing to change.** That's a required step toward
  running in the real world instead of just on a laptop. Local development still needs no
  cloud account or credit card — this is opt-in.
  Details: S7 — a Firestore adapter behind the existing repository interfaces, emulator-ready. _(2026-09-10)_

## Under the hood: making the test suite's pass/fail signal actually true

- **The automated checks that are supposed to catch bugs before they ship were quietly not
  running as strictly as everyone believed.** A tooling gap meant part of the test-coverage
  requirement was silently skipped by the very script meant to enforce it — for weeks,
  "all green" didn't fully mean what it claimed. That's now fixed, and the gaps it exposed
  are being closed rather than argued away.
  Details: root `pnpm test:coverage` rewired to actually gate on each package's coverage
  threshold instead of just reporting a number; the `functions` package's real gap
  (mostly two data-mapping files that only had their "happy path" tested) closed with new
  test cases, no behavior changed. _(2026-09-10)_

- **The codebase now follows one consistent formatting style everywhere**, matching the
  team's preference (tabs, a specific brace style, and a few other conventions) — enforced
  automatically on every commit so it can't drift. Mechanical change; nothing about how the
  app behaves is different. _(2026-09-10)_

## Real MLB game data, end to end

Before this work, the app only knew how to replay a handful of hand-picked practice games
saved to disk. This effort teaches it to talk to MLB's actual live game service — the
foundation every future screen (live scores, box scores, standings) will read from.

- **The backend can now fetch a real MLB game — in progress or finished — and understand
  every part of it**: score, inning-by-inning detail, every pitch (speed, location, spin),
  highlight videos, and full team/player info. Previously it only understood a few
  practice games that had been manually shaped to fit.
  Details: S11 (typed contracts for MLB's data), S12 (the live connection + translators),
  S13 (standings, article content, player bios), S23 (near-total field coverage with an
  automatic "did we miss something" check). _(2026-09-08)_

- **Live games now update automatically while they're being played, and the app stops
  checking once they're over** — so MLB's servers only get contacted for games that are
  actually happening right now, not once per person looking at the page.
  Details: S21 (raw MLB data gets turned into the app's own stable, queryable records),
  S16 (an active-window polling loop, per ADR-002). _(2026-09-09)_

- **Looking up an old, finished game no longer serves data that's stuck from whenever it
  was first loaded — but it also won't hammer MLB's servers just because a page got
  opened twice.** A background safety valve refreshes it once, then waits before trying
  again.
  Details: S17 — refresh-on-read with request de-duplication and a cooldown. _(2026-09-09)_

- **A finished game's entire play-by-play can now be replayed at any point or any speed,
  without ever asking MLB for it again.** The full sequence of what happened is captured
  once, right after the final out, and stored for good.
  Details: S22 — captures MLB's official timecode-by-timecode diff log for a finished
  game and reconstructs any moment from it. Verified against a real recorded game (534
  captured changes, exact final score reproduced from scratch). _(2026-09-09)_

- **When MLB adds something new to their data feed, the team now finds out automatically
  instead of it going unnoticed.** A drift scanner compares what's actually in MLB's
  responses against what the app understands, and flags anything new.
  Details: S15 (`pnpm mlb:scan-drift`), S14 (a recorder that keeps the app's practice-game
  test data up to date from the real MLB feed on demand). _(2026-09-09)_

## Getting the basics solid

- **The app correctly knows which games are "in progress" versus "not yet" or "long
  over"** — the judgment call every live-update feature above depends on getting right.
  Details: S1 — domain window-detection logic, fully tested. _(2026-09-08)_
