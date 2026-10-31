# Baseball Savant data

Baseball Savant (`baseballsavant.mlb.com`) feeds the owner found, what each holds, and where BT stands on it. Two kinds:

- **Game data** BT ingests through stories under FEATURES' _More MLB game data_: the per-pitch game feed (**S103**), pitcher season averages (**S104**) and ballpark field drawings (**S105**).
- **Player-season data**, recorded here for future ideas only (owner, 2026-10-30: _"Just record the example URLS for the seasonal data and describe what they contain in a document we can use for future ideas."_). No feature uses it and no story ingests it. A feature that wants it starts in FEATURES, in the owner's words.

None of these are documented APIs. They are the endpoints Savant's own pages call; they can change or vanish without notice. Every sample below was fetched on 2026-10-30, after the 2026 season.

## Terms of use

The terms of use (Savant's and MLB's) must be checked before any live call to Savant ships (owner, 2026-10-30, _"Sure"_). Covered: the data, the field drawings and query-engine use. **S103** AC 7 does the check and records the result here, quoting the terms with links and the date read.

_Not yet checked._

## Game data (ingested by stories)

| Feed | Example | What it holds | Story |
| ---- | ------- | ------------- | ----- |
| Game feed | `https://baseballsavant.mlb.com/gf?game_pk=823823` | Every pitch of a game keyed by the live feed's `playId`. Most of it repeats MLB's live feed; BT keeps only what MLB's feeds lack (xBA, barrels, spray position, home-run ballpark count, bat speed, swords, Savant's in-zone call, times through the order, the challenged pitch, the front-of-plate location) | S103 |
| Pitcher yearly averages | `https://baseballsavant.mlb.com/gamefeed/pitcher-yearly-averages?pitchers=[668909,681870,…]` | Each listed pitcher's season averages per pitch type: usage, average and range of speed, spin, horizontal / vertical / induced break, spin axis and release point (397 fields a pitcher). Any number of pitchers in one call. Savant's game page uses it to set each pitch beside the pitcher's norm. The owner's sample listed 19 pitchers and returned 3 rows. | S104 |
| Field drawing | `https://baseballsavant.mlb.com/site-core/images/fields/3313.svg` | A 250×250 SVG outline of a ballpark. The number is MLB's venue id: 3313 is Yankee Stadium, 4169 (loanDepot park, `gameData.venue.id` of 823823) returns that park. MLB-made artwork | S105 |
| Date schedule | `https://baseballsavant.mlb.com/schedule?date=2026-10-15` | Every game on a date with its win probability after each at-bat (`wpa[].wpaValues`). The values match MLB's play metrics (S93) at-bat for at-bat (85 of 85 on 823823) | Not ingested: S93's play metrics already give the same values |
| Date scoreboard | `https://baseballsavant.mlb.com/scoreboard-data?date=2026-10-15` | The same win probabilities per game (`stats.wpa.gameWpa`), the top players by win probability added, and for the current play a **leverage index** and a **drama index**, which no MLB feed BT reads carries | Not ingested; a future idea (below) |

## Player-season data (future ideas)

All about a player over a season, not a game. BT has no place that shows a player yet (no player card, no comparison view). Ideas raised on 2026-10-30, none chosen: a player card opened from Live, Plays or Box; matchup context in Live (the batter's zones against the pitcher's locations); season context on a play ("his hardest-hit ball this year", "a top-5% sprint"). It changes at most once a day.

### Leverage and drama index

`https://baseballsavant.mlb.com/scoreboard-data?date=2026-10-15`

Game data rather than player data, kept here as a future idea (owner, 2026-10-30, asked whether to ingest Savant's date feeds: _"Skip but note it in the future ideas document"_). For each game's current play, `games[].currentPlay` carries `leverageIndex` (how much the play's outcome can swing the game; 3.91 at one point in the sample) and `dramaIndex` (Savant's own measure; 164 in the sample). `stats.wpa.topWpaPlayers` lists the game's players by win probability added. One call covers every game on a date. Their win probabilities repeat S93's play metrics, so only these fields are new.

### Comparison tool

`https://baseballsavant.mlb.com/comparison-tool/services/661388-2026-batter,691718-2026-batter`

Returns `{ playerData: [...] }`, one row for each `<playerId>-<season>-<batter|pitcher>` in the comma-separated path, 347 fields a row. Mostly percentile ranks against the league: run value by pitch type, velocity, usage, spin, whiff rate, break and extension per pitch type; swing / take, fielding and baserunning run values. One player works. So do any number of players, batters and pitchers mixed, although Savant's own page won't let a batter and a pitcher be chosen together (owner, 2026-10-30).

### Histogram

`https://baseballsavant.mlb.com/player-services/histogram?playerId=682987&pos=8&fieldType=api_h_launch_speed&hand=&size=5&season=&event=pitch_percent&pitchType=`
`https://baseballsavant.mlb.com/player-services/histogram?playerId=682987&pos=8&fieldType=api_h_launch_angle&hand=L&size=2&season=2026&event=swings&pitchType=FF`

A player's distribution of one measure (`fieldType`: exit velocity, launch angle, …) in buckets of `size`. Filters: position, pitcher / batter hand, season, event (`pitch_percent`, `swings`, …) and pitch type. Each bucket carries the pitch count and about 30 stats: exit velocity, launch angle, BA, xBA, wOBA, xwOBA, hard-hit %, run expectancy and more. The owner: _"returns histogram groupings for the requested filters, of which there are many"_. The sample returned 16 buckets.

### Rolling average

`https://baseballsavant.mlb.com/player-services/roll?playerId=682987&playerType=8&count=50&type=xba_roll&year=`

A player's rolling average over a `count`-event window (`type`: `xba_roll` here), one point per event with its game date. The sample returned 259 points, a season trend line. The owner: _"a rolling average with its own filters"_.

### Hot and cold zones

`https://baseballsavant.mlb.com/player-services/zones?playerIds=682987&playerType=batting&season=2026&hand=R`

The 13 zones of MLB's strike-zone grid, each with pitches seen, swing and whiff rates, hard-hit %, barrels, run value and hits, for a batter or pitcher, filtered by the other side's hand and the season. The owner: _"hot and cold zones"_.

### Running splits

`https://baseballsavant.mlb.com/player-services/running-splits?playerId=682987`

Seconds from contact to each distance up the line (`seconds_since_hit_000` … `_090`) with percentile ranks. It returned all 546 qualified runners whatever `playerId` was asked for, so it's a league-wide table. The owner: _"running splits as compared to other players"_.

### Statcast search (CSV)

`https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfGT=R%7C&hfSea=2026%7C&player_type=pitcher&group_by=name&sort_col=pitches&sort_order=desc&minors=false&wbc=false`
`https://baseballsavant.mlb.com/statcast_search/csv?all=true&csv=all&hfGT=R|&hfNewZones=1|&hfC=12|30|&hfSea=2026|&player_type=pitcher&hfOuts=1|&group_by=name&sort_col=pitches&sort_order=desc&minors=false&wbc=false`

Savant's query engine as CSV. The first sample returned 868 pitchers, one row each (grouped by name), with about 60 columns: pitches, BA, ISO, wOBA, xwOBA, xBA, exit velocity, launch angle, spin rate, velocity, bat speed, swing length, fielders' starting distances and more. It answers questions, so it's a call to make when a view asks one, not a feed to copy. The owner listed 26 filters (each a `|`-separated list): `hfPT` pitch type, `hfAB` at-bat result, `hfGT` game type, `hfPR` pitch result, `hfZ` zone, `hfStadium`, `hfBBL` batted-ball location, `hfNewZones`, `hfPull`, `hfC` count, `hfSea` season, `hfSit` situation, `hfOuts`, `hfSA`, `hfEventOuts`, `hfEventRuns`, `hfABSFlag` ABS challenge, `hfMo` month, `hfTeam`, `hfOpponent`, `hfRO` runners on, `hfInfield` / `hfOutfield` alignment, `hfInn` inning, `hfBBT` batted-ball type, `hfFlag`.
