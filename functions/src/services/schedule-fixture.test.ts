/**
 * S65: the scoreboard's data from recordings, not typed. The 2026-09-05 schedule is
 * re-derived offline through the recorder and mappers; a pre-game and an in-progress
 * summary of 823823 are folded from its recorded replay; the schedule route serves the
 * new fields.
 */
import {
	mkdtempSync, readFileSync, rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, describe, expect, it,
} from "vitest";
import type { ScheduleGameSummary } from "@bt/domain";
import { HttpMlbStatsClient } from "../adapters/http/mlb.js";
import { fixtureGet } from "../handlers/fixture-request.js";
import { mapLiveFeedSummary } from "../mappers/live.js";
import {
	LIVE_FIXTURE_TIMECODE, PREGAME_TIMECODE, recordedFeedAt, recordedFetch, scheduleMomentsAt,
} from "./live-fixture.js";
import { recordNormalized } from "./recorder.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const RAW = path.join(FIXTURES, "raw");
const TARGET = {
	date: "2026-09-05",
	gamePk: 823823,
};

let out: string | undefined;

afterEach(() =>
{
	if (out) rmSync(out, {
		recursive: true,
		force: true,
	});
	out = undefined;
});

// Each fold replays the whole recorded game (reconstructReplay over every diffpatch):
// about 1.3 s locally, past vitest's 5 s default on a CI runner under coverage.
const REPLAY_TIMEOUT = {
	timeout: 30_000,
};

describe("the 2026-09-05 scoreboard data (S65)", REPLAY_TIMEOUT, () =>
{
	it("regenerates fixtures/schedule-2026-09-05.json offline from fixtures/raw/, equal to the committed file", async () =>
	{
		out = mkdtempSync(path.join(tmpdir(), "schedule-2026-09-05-"));
		await recordNormalized(new HttpMlbStatsClient({
			fetchImpl: recordedFetch(RAW, TARGET),
		}), TARGET, out);
		expect(readFileSync(path.join(out, "schedule-2026-09-05.json"), "utf8")).toBe(readFileSync(path.join(FIXTURES, "schedule-2026-09-05.json"), "utf8"));
	});

	it("fold: in progress at 20260905_205719 — bases loaded, Bregman batting against Gusto at 2–2, two out; probables with season lines", () =>
	{
		expect(LIVE_FIXTURE_TIMECODE).toBe("20260905_205719");
		const summary = mapLiveFeedSummary(recordedFeedAt(RAW, LIVE_FIXTURE_TIMECODE));
		expect(summary.status.codedGameState).toBe("I");
		const live = summary.live!;
		expect([live.runners.first, live.runners.second, live.runners.third].every((id) => typeof id === "number")).toBe(true);
		expect(live).toMatchObject({
			balls: 2,
			strikes: 2,
			outs: 2,
		});
		expect(live.batterId).toEqual(expect.any(Number));
		expect(summary.probablePitchers?.away).toMatchObject({
			fullName: "Javier Assad",
			wins: expect.any(Number),
			era: expect.stringMatching(/^\d+\.\d{2}$/),
		});
		expect(summary.probablePitchers?.home?.fullName).toBe("Ryan Gusto");
		expect(summary.decisions).toBeNull();
	});

	it("fold: scheduled at 20260905_170118 (pre-game) — probables and records, no runners, no decisions, first pitch 20:10Z", () =>
	{
		expect(PREGAME_TIMECODE).toBe("20260905_170118");
		const summary: ScheduleGameSummary = mapLiveFeedSummary(recordedFeedAt(RAW, PREGAME_TIMECODE));
		expect(summary.status.codedGameState).toBe("P");
		expect(summary.live).toBeNull();
		expect(summary.decisions).toBeNull();
		expect(summary.startTime).toBe("2026-09-05T20:10:00Z");
		expect(summary.teams.away.record).toEqual({
			wins: 81,
			losses: 62,
		});
		expect(summary.probablePitchers?.away?.fullName).toBe("Javier Assad");
		expect(summary.probablePitchers?.home?.fullName).toBe("Ryan Gusto");
	});

	it("moments: regenerates fixtures/schedule-823823-moments.json — the pre-game and in-progress folds above, equal to the committed file (S66)", () =>
	{
		const regenerated = `${JSON.stringify(scheduleMomentsAt(RAW), null, 2)}\n`;
		expect(regenerated).toBe(readFileSync(path.join(FIXTURES, "schedule-823823-moments.json"), "utf8"));
	});

	it("GET /api/v1/schedule?date=2026-09-05 returns the start time, records, probables, decisions and live moment", async () =>
	{
		const res = await fixtureGet("/api/v1/schedule?date=2026-09-05");
		expect(res.status).toBe(200);
		const day = await res.json() as { games: ScheduleGameSummary[] };
		const game = day.games.find((g) => g.gamePk === 823823)!;
		expect(game).toMatchObject({
			startTime: "2026-09-05T20:10:00Z",
			teams: {
				away: {
					abbreviation: "CHC",
					record: {
						wins: 81,
						losses: 62,
					},
				},
			},
			probablePitchers: {
				away: {
					fullName: "Javier Assad",
					wins: 6,
					losses: 1,
					era: "3.58",
				},
			},
			decisions: {
				winner: {
					fullName: "Ryan Rolison",
				},
			},
			live: null,
		});
	});
});
