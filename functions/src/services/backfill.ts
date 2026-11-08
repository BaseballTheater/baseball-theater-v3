/**
 * The game backfill (S122; owner, 2026-11-07: "I want idempotent functionality that hydrates
 * every game between two dates"): walks the days from `to` back to `from`, newest first, and
 * stores each day the way ingest does — its schedule day (`storeSchedule`) and each final game
 * through `ingestGame`'s version-guarded write (ADR-022) — so the data it leaves is the same
 * Postgres rows the app reads locally and that a production run would write to Neon.
 *
 * It is resumable without a progress file: a day is **complete** when its stored schedule day
 * holds only settled games (`isSettledGame`) and every final one is stored, final, with a
 * current projection. A complete day asks MLB nothing and writes nothing, so a second run, or
 * a run after a stop, goes straight to the first incomplete day. A game whose projection fell
 * behind its snapshot (a stop between `storeGame`'s two writes) is repaired from the stored
 * snapshot. The only state outside the database is each extra source's give-up streak
 * ({@link ResumeStore}, AC 8).
 *
 * The game's three extra sources — content (videos and recap), play metrics and the GraphQL
 * game content — exist only for recent games, so each is asked on its own and given up after
 * {@link GIVE_UP_AFTER_DAYS} consecutive failed days of games (`recordSourceDay`). The live
 * feed is never given up: a game whose feed fails leaves its day incomplete for the next run.
 */
import type {
	GameGraphContent, GamePlayMetrics, ScheduleDay, SourceStreak,
} from "@bt/domain";
import {
	backfillDays, isFinalStatus, isGameInActiveWindow, isSettledGame, isSourceGivenUp, normalizeStatusCode, recordSourceDay,
} from "@bt/domain";
import type {
	GameEditorial, GameProjectionRepository, GameRepository, MlbGameSources, ScheduleRepository,
} from "@bt/ports";
import { assembleGame } from "../mappers/game-extras.js";
import {
	ingestGame, repairProjection, storeSchedule,
} from "./ingest.js";

/** The extra sources a game is hydrated from beside its live feed, each given up on its own. */
export const EXTRA_SOURCES = ["content", "playMetrics", "graphContent"] as const;
export type ExtraSource = (typeof EXTRA_SOURCES)[number];

/** What a resumed run needs that the database doesn't hold: each extra source's give-up streak. */
export type BackfillState = {
	sources: Partial<Record<ExtraSource, SourceStreak>>;
};

/** Where {@link BackfillState} is kept between runs (a file per database, `backfill-state.ts`). */
export interface ResumeStore
{
	load(): Promise<BackfillState>;
	save(state: BackfillState): Promise<void>;
}

export type BackfillDeps = {
	mlb: MlbGameSources;
	schedules: ScheduleRepository;
	games: GameRepository;
	projections: GameProjectionRepository;
	state: ResumeStore;
	now?: () => Date;
	/** Called with each day before its first request, so the pacer can pick that day's gap. */
	pace?: (day: string) => void;
	/** Progress lines (AC 9). */
	log?: (line: string) => void;
	/** Stops the walk before the next day; the day in progress finishes first. */
	signal?: AbortSignal;
};

export type BackfillResult = {
	/** Days visited (off-season days are never visited). */
	days: number;
	/** Days that were already complete and asked MLB nothing. */
	alreadyComplete: number;
	/** Games written this run. */
	gamesStored: number;
	/** Projections repaired from their stored snapshot. */
	repaired: number;
	/** Days left incomplete, for the next run: unsettled games, or a schedule or feed MLB didn't serve. */
	incomplete: string[];
	/** Each given-up source and the day it was given up at. */
	givenUp: Partial<Record<ExtraSource, string>>;
	/** Whether the walk stopped early (`signal`). */
	stopped: boolean;
};

function isFinalSummary(summary: ScheduleDay["games"][number]): boolean
{
	return isFinalStatus(normalizeStatusCode(summary.status.codedGameState));
}

/** One extra source's answer: the value, or null when it failed or had nothing. */
async function ask<T>(asked: boolean, call: () => Promise<T | null>): Promise<T | null>
{
	if (!asked) return null;
	try
	{
		return await call();
	}
	catch
	{
		return null;
	}
}

/** What one game's hydration came to, for the day's tally. */
type GameOutcome =
	| { kind: "stored" | "unchanged" | "repaired" | "feedFailed" }
	| { kind: "fetched";
		changed: boolean;
		answered: Partial<Record<ExtraSource, boolean>>; };

/**
 * Hydrates one final game: from the store when it is already there and final (repairing its
 * projection if it fell behind), else from MLB, asking each extra source not given up for `day`.
 */
async function hydrateGame(deps: BackfillDeps, gamePk: number, asking: Record<ExtraSource, boolean>, fetchedAt: string, windowMode: ScheduleDay["windowMode"]): Promise<GameOutcome>
{
	const stored = await deps.games.getByPk(gamePk);
	if (stored && isFinalStatus(normalizeStatusCode(stored.status.codedGameState)))
	{
		return {
			kind: await repairProjection(deps, stored) ? "repaired" : "unchanged",
		};
	}
	let feed;
	try
	{
		feed = await deps.mlb.fetchGameFeed(gamePk);
	}
	catch
	{
		return {
			kind: "feedFailed",
		};
	}
	const [editorial, playMetrics, graph] = await Promise.all([
		ask<GameEditorial>(asking.content, () => deps.mlb.fetchGameEditorial(gamePk)),
		ask<GamePlayMetrics>(asking.playMetrics, () => deps.mlb.fetchPlayMetrics(gamePk)),
		ask<GameGraphContent>(asking.graphContent, () => deps.mlb.fetchGameGraphContent(gamePk)),
	]);
	const { changed } = await ingestGame(deps, {
		...assembleGame(feed, editorial, playMetrics, graph),
		fetchedAt,
		windowMode,
	});
	const answered: Partial<Record<ExtraSource, boolean>> = {};
	if (asking.content) answered.content = editorial !== null;
	if (asking.playMetrics) answered.playMetrics = playMetrics !== null;
	if (asking.graphContent) answered.graphContent = graph !== null;
	return {
		kind: "fetched",
		changed,
		answered,
	};
}

/**
 * Hydrates every game from `to` back to `from` (both included; `from` clamped to 1901-04-18,
 * the off-season skipped, `backfillDays`). Safe to stop and run again: see the module comment.
 */
export async function runBackfill(deps: BackfillDeps, range: { from: string;
	to: string; }): Promise<BackfillResult>
{
	const log = deps.log ?? (() => undefined);
	const state = await deps.state.load();
	const result: BackfillResult = {
		days: 0,
		alreadyComplete: 0,
		gamesStored: 0,
		repaired: 0,
		incomplete: [],
		givenUp: {},
		stopped: false,
	};
	for (const source of EXTRA_SOURCES)
	{
		const givenUpAt = state.sources[source]?.givenUpAt;
		if (givenUpAt) result.givenUp[source] = givenUpAt;
	}

	for (const day of backfillDays(range.from, range.to))
	{
		if (deps.signal?.aborted)
		{
			result.stopped = true;
			break;
		}
		result.days++;
		deps.pace?.(day);
		const now = deps.now?.() ?? new Date();
		let complete = true;

		// The stored day is enough when every game in it is settled; otherwise MLB is asked again.
		let scheduleDay = await deps.schedules.getByDate(day);
		let askedMlb = false;
		if (!scheduleDay || !scheduleDay.games.every((game) => isSettledGame(game.status)))
		{
			askedMlb = true;
			try
			{
				const fetched = await deps.mlb.fetchSchedule(day);
				scheduleDay = await storeSchedule(deps, {
					...fetched,
					fetchedAt: now.toISOString(),
					windowMode: fetched.games.some((game) => isGameInActiveWindow(game, now)) ? "active" : "cache",
				});
			}
			catch (error)
			{
				log(`${day}: MLB served no schedule (${error instanceof Error ? error.message : String(error)}); left for the next run`);
				result.incomplete.push(day);
				continue;
			}
			if (!scheduleDay.games.every((game) => isSettledGame(game.status))) complete = false;
		}

		const asking = Object.fromEntries(EXTRA_SOURCES.map((source) => [source, !isSourceGivenUp(state.sources[source], day)])) as Record<ExtraSource, boolean>;
		const finals = scheduleDay.games.filter(isFinalSummary);
		const windowMode = scheduleDay.windowMode;
		const outcomes = await Promise.all(finals.map((game) => hydrateGame(deps, game.gamePk, asking, now.toISOString(), windowMode)));

		let stored = 0;
		let repaired = 0;
		for (const outcome of outcomes)
		{
			if (outcome.kind === "feedFailed") complete = false;
			if (outcome.kind === "repaired") repaired++;
			if (outcome.kind === "fetched")
			{
				askedMlb = true;
				if (outcome.changed) stored++;
			}
		}
		result.gamesStored += stored;
		result.repaired += repaired;
		let stateChanged = false;

		// The give-up rule (AC 7): a day counts for a source only when it was asked for some game.
		for (const source of EXTRA_SOURCES)
		{
			const answers = outcomes.flatMap((outcome) => outcome.kind === "fetched" && outcome.answered[source] !== undefined ? [outcome.answered[source]] : []);
			if (answers.length === 0) continue;
			const before = state.sources[source] ?? {
				streak: 0,
			};
			const after = recordSourceDay(before, day, !answers.includes(true));
			if (after === before) continue;
			state.sources[source] = after;
			stateChanged = true;
			if (after.givenUpAt && !before.givenUpAt)
			{
				result.givenUp[source] = after.givenUpAt;
				log(`${day}: gave up ${source} after ${after.streak} days of games without it; not asked again for older days`);
			}
		}
		if (stateChanged) await deps.state.save(state);

		if (!complete) result.incomplete.push(day);
		if (!askedMlb && complete && repaired === 0)
		{
			result.alreadyComplete++;
			continue;
		}
		const givenUp = Object.keys(result.givenUp);
		log(`${day}: ${finals.length} final, ${stored} stored${repaired > 0 ? `, ${repaired} repaired` : ""}${complete ? "" : ", incomplete (checked again next run)"}${givenUp.length > 0 ? `; given up: ${givenUp.join(", ")}` : ""}`);
	}
	return result;
}
