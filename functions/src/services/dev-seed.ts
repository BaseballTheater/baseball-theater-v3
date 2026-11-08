/**
 * The dev seed (S112): real MLB days and games for local development, far more than the
 * committed fixtures — by default the most recent finished season's last month of the regular
 * season through its last postseason game (the owner, 2026-11-02). `pnpm seed:refresh` records
 * it once through the HTTP client into one gzipped file (about 450 games; too big to commit or
 * bundle into the Worker, so it is git-ignored), and `pnpm dev` loads that file into the local
 * Postgres through ingest, like any other day (`pnpm db:seed`). CI and `pnpm verify` never
 * read it: tests record through a fetch stand-in into a temporary directory.
 */
import {
	mkdir, readFile, writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import type {
	GameSnapshot, ScheduleDay, SeasonCalendar, Unversioned,
} from "@bt/domain";
import { addDays } from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";
import { overlayMlbClient } from "../adapters/overlay-mlb.js";
import type { IngestDeps } from "./ingest.js";
import { ingestScheduleDay } from "./ingest.js";

/** Where `pnpm seed:refresh` writes and `pnpm dev` reads: `.dev-seed/` at the repo root, git-ignored. */
export const DEFAULT_SEED_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.dev-seed/seed.json.gz");

/** How far before the regular season's last day the default range starts: "the final 1 month". */
const DEFAULT_REGULAR_SEASON_DAYS = 30;

/** Games recorded at once: enough to finish in minutes, few enough to stay polite to MLB. */
const RECORD_CONCURRENCY = 6;

/** The file's shape. `format` changes only when an older file can no longer be loaded. */
export interface DevSeed {
	format: 1;
	/** When it was recorded (ISO instant). */
	recordedAt: string;
	start: string;
	end: string;
	/** Every day in the range, in order, empty days included. */
	days: Unversioned<ScheduleDay>[];
	/** Every game those days list that MLB could serve, hydrated (plays, content, play metrics). */
	games: Unversioned<GameSnapshot>[];
}

/**
 * What the default range needs from MLB: S111's calendar, which carries the regular season's last day (S128).
 * It rejects when MLB can't be reached; the default range treats that like an unpublished season and tries the year before.
 */
export interface SeasonDates {
	fetchSeasonCalendar(season: number): Promise<SeasonCalendar | null>;
}

/**
 * The default range: the most recent season whose last postseason game is before `today`
 * (MLB's day), from 30 days before its regular season's last day through that last game. A
 * season still being played is skipped, so the seed is always a finished stretch; pass dates
 * to record anything else.
 */
export async function defaultSeedRange(mlb: SeasonDates, today: string): Promise<{ start: string;
	end: string; }>
{
	const year = Number(today.slice(0, 4));
	for (const season of [year, year - 1])
	{
		const calendar = await mlb.fetchSeasonCalendar(season).catch(() => null);
		if (!calendar || calendar.lastGameDate >= today) continue;
		const regularEnd = calendar.regularSeasonEndDate;
		if (!regularEnd) break;
		return {
			start: addDays(regularEnd, -DEFAULT_REGULAR_SEASON_DAYS),
			end: calendar.lastGameDate,
		};
	}
	throw new Error("MLB has no finished season to seed from; pass --start=YYYY-MM-DD --end=YYYY-MM-DD");
}

/** Every calendar day from `start` through `end`, in order. */
export function seedDays(start: string, end: string): string[]
{
	const days: string[] = [];
	for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
	return days;
}

/** Runs `work` over `items`, `limit` at a time, keeping their order. */
async function inPool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]>
{
	const results: R[] = new Array<R>(items.length);
	let next = 0;
	const runners = Array.from({
		length: Math.min(limit, items.length),
	}, async () =>
	{
		while (next < items.length)
		{
			const index = next++;
			results[index] = await work(items[index]!);
		}
	});
	await Promise.all(runners);
	return results;
}

/**
 * Records `start`..`end` from `mlb`: each day's schedule, then each game it lists (once, even
 * when a suspended game appears on two days), hydrated by `fetchGame`. A game MLB won't serve
 * is left out and reported, so one bad feed doesn't lose the seed.
 */
export async function recordDevSeed(
	mlb: MlbStatsClient,
	range: { start: string;
		end: string; },
	options: { now?: () => Date;
		log?: (line: string) => void; } = {},
): Promise<{ seed: DevSeed;
	skipped: number[]; }>
{
	const log = options.log ?? (() => undefined);
	const days: Unversioned<ScheduleDay>[] = [];
	for (const date of seedDays(range.start, range.end))
	{
		days.push(await mlb.fetchSchedule(date));
	}
	const gamePks = [...new Set(days.flatMap((day) => day.games.map((game) => game.gamePk)))];
	log(`${days.length} days, ${gamePks.length} games`);

	const skipped: number[] = [];
	let done = 0;
	const fetched = await inPool(gamePks, RECORD_CONCURRENCY, async (gamePk) =>
	{
		try
		{
			return await mlb.fetchGame(gamePk);
		}
		catch
		{
			skipped.push(gamePk);
			return null;
		}
		finally
		{
			done++;
			if (done % 25 === 0 || done === gamePks.length) log(`${done}/${gamePks.length} games`);
		}
	});
	return {
		seed: {
			format: 1,
			recordedAt: (options.now?.() ?? new Date()).toISOString(),
			start: range.start,
			end: range.end,
			days,
			games: fetched.filter((game) => game !== null),
		},
		skipped: skipped.sort((a, b) => a - b),
	};
}

/** Writes `seed` gzipped to `file`, making its directory. */
export async function writeDevSeed(file: string, seed: DevSeed): Promise<void>
{
	await mkdir(path.dirname(file), {
		recursive: true,
	});
	await writeFile(file, await promisify(gzip)(JSON.stringify(seed)));
}

/** Reads the seed at `file`, or null when there is none (`pnpm dev` then starts without it). */
export async function readDevSeed(file: string): Promise<DevSeed | null>
{
	let bytes: Buffer;
	try
	{
		bytes = await readFile(file);
	}
	catch
	{
		return null;
	}
	const seed = JSON.parse((await promisify(gunzip)(bytes)).toString("utf8")) as DevSeed;
	if (seed.format !== 1) throw new Error(`${file} is seed format ${String(seed.format)}; run pnpm seed:refresh to re-record it`);
	return seed;
}

/**
 * Loads `seed` into the store through ingest, a day at a time, with the seed as the MLB client
 * for its own days and games: the same stamping and version-guarded writes as every ingest
 * (ADR-022), so loading it again writes nothing. Returns how many days it went through.
 */
export async function loadDevSeed(deps: IngestDeps, seed: DevSeed): Promise<number>
{
	const days = new Map(seed.days.map((day) => [day.date, day]));
	const games = new Map(seed.games.map((game) => [game.gamePk, game]));
	const mlb = overlayMlbClient(deps.mlb, {
		schedule: async (date) => days.get(date) ?? null,
		game: async (gamePk) => games.get(gamePk) ?? null,
	});
	for (const date of days.keys()) await ingestScheduleDay({
		...deps,
		mlb,
	}, date);
	return days.size;
}
