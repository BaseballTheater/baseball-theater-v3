/**
 * The mid-game fixture the Live theater is built against (S63): CHC @ MIA (823823)
 * folded from its recorded pre-game feed through MLB's own diff log
 * (`fixtures/raw/live-823823-base.json` + `diffpatch-823823.json`) to one named
 * moment — top of the 3rd, two out, bases loaded, Alex Bregman 2–2 against Ryan Gusto,
 * five pitches into the at-bat. Offline: the same `reconstructReplay` the replay
 * service uses, then the same `mapLiveFeed` live data goes through. The pre-game
 * moment and the recordings-backed `fetch` serve S65's scoreboard summaries too, and
 * both moments are committed as the scoreboard's scheduled and live rows (S66).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	parseLiveFeedResponse, parseRecordedReplayWalk, reconstructReplay,
} from "@bt/mlb-api";
import type { LiveFeedResponse } from "@bt/mlb-api";
import type {
	GameSnapshot, ScheduleGameSummary, Unversioned,
} from "@bt/domain";
import { mapLiveFeed, mapLiveFeedSummary } from "../mappers/live.js";
import { rawEndpoints } from "./recorder.js";
import type { RecorderTarget } from "./recorder.js";

/** The recorded moment `fixtures/game-823823-live.json` shows. */
export const LIVE_FIXTURE_TIMECODE = "20260905_205719";

/** A game as a fixture file holds it: no fetch time or window, plays inline. */
export type LiveFixture = Omit<Unversioned<GameSnapshot>, "fetchedAt" | "windowMode">;

/** The pre-game moment (S65): the walk's starting feed, warm-up (`P`), probables named. */
export const PREGAME_TIMECODE = "20260905_170118";

/**
 * The recorded 823823 feed at `timecode`: `<rawDir>/live-823823-base.json` itself at the
 * walk's first timecode, else folded through `<rawDir>/diffpatch-823823.json` up to it.
 * Throws if the walk never reaches it.
 */
export function recordedFeedAt(rawDir: string, timecode: string): LiveFeedResponse
{
	const read = (name: string): unknown => JSON.parse(readFileSync(path.join(rawDir, name), "utf8"));
	const base = read("live-823823-base.json");
	const walk = parseRecordedReplayWalk(read("diffpatch-823823.json"));
	if (walk[0]?.startTimecode === timecode) return parseLiveFeedResponse(base);
	const state = reconstructReplay(base, walk).states.find((s) => s.timecode === timecode);
	if (!state) throw new Error(`the recorded walk has no state at ${timecode}`);
	return parseLiveFeedResponse(state.feed);
}

/** The game at `timecode` as `fixtures/game-823823-live.json` holds it. */
export function liveFixtureAt(rawDir: string, timecode = LIVE_FIXTURE_TIMECODE): LiveFixture
{
	const {
		fetchedAt: _fetchedAt, windowMode: _windowMode, ...game
	} = mapLiveFeed(recordedFeedAt(rawDir, timecode), "");
	return game;
}

/**
 * 823823 on the scoreboard at its two unfinished moments, as
 * `fixtures/schedule-823823-moments.json` holds them (S66): before first pitch
 * (`PREGAME_TIMECODE`) and in progress (`LIVE_FIXTURE_TIMECODE`). The committed
 * schedules are all finished games; these give the scoreboard its scheduled and live rows.
 */
export function scheduleMomentsAt(rawDir: string): { pregame: ScheduleGameSummary;
	live: ScheduleGameSummary; }
{
	return {
		pregame: mapLiveFeedSummary(recordedFeedAt(rawDir, PREGAME_TIMECODE)),
		live: mapLiveFeedSummary(recordedFeedAt(rawDir, LIVE_FIXTURE_TIMECODE)),
	};
}

/**
 * A `fetch` that answers each upstream URL the recorder asks for `target` with its
 * recording, `<rawDir>/<endpoint>.json` (S2, S65) — `recordNormalized` runs offline
 * through the same mappers as live data.
 */
export function recordedFetch(rawDir: string, target: RecorderTarget): typeof fetch
{
	const byUrl = new Map(rawEndpoints(target).map((e) => [e.url, path.join(rawDir, `${e.name}.json`)]));
	return async (input) =>
	{
		const file = byUrl.get(String(input));
		if (!file) throw new Error(`no recording for ${String(input)}`);
		return new Response(readFileSync(file), {
			headers: {
				"Content-Type": "application/json",
			},
		});
	};
}
