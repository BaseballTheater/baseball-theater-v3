/**
 * The game backfill (S122) as a local download would run it, without the network: a counting
 * fake `MlbGameSources` over in-memory repositories for the walk, the resume and the give-up
 * rule, and `HttpMlbStatsClient` paced by `PoliteFetch` over the committed 823823 recordings
 * into PGlite — the same Postgres schema the local Docker database and Neon hold — for the store
 * path. No test reaches MLB.
 */
import { readFileSync } from "node:fs";
import {
	mkdtemp, readdir, readFile, rm, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
	GameSnapshot, ScheduleDay, ScheduleGameSummary, Unversioned,
} from "@bt/domain";
import {
	addDays, GIVE_UP_AFTER_DAYS, sourceGivenUpAt,
} from "@bt/domain";
import type {
	GameProjectionRepository, GameRepository, MlbGameSources, ScheduleRepository,
} from "@bt/ports";
import {
	afterEach, describe, expect, it,
} from "vitest";
import { FIXTURES_ROOT, FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { HttpMlbStatsClient } from "../adapters/http/mlb.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, InMemoryScheduleRepository,
} from "../adapters/memory/repos.js";
import { migratedPglite } from "../adapters/postgres/migrate.js";
import {
	PostgresGameProjectionRepository, PostgresGameRepository, PostgresScheduleRepository,
} from "../adapters/postgres/repos.js";
import type {
	BackfillDeps, BackfillState, ExtraSource, ResumeStore,
} from "./backfill.js";
import { runBackfill } from "./backfill.js";
import { fileResumeStore } from "./backfill-state.js";
import { ingestGame } from "./ingest.js";
import {
	OLD_GAP_MS, PoliteFetch, RECENT_GAP_MS,
} from "./polite-fetch.js";

const NOW = () => new Date("2026-11-08T17:00:00.000Z");
const TEMPLATE_SUMMARY = (JSON.parse(readFileSync(path.join(FIXTURES_ROOT, "schedule-2026-09-05.json"), "utf8")) as { games: ScheduleGameSummary[] }).games
	.find((game) => game.gamePk === 823823)!;
const TEMPLATE_FEED = await new FixtureMlbStatsClient().fetchGameFeed(823823);

const dirs: string[] = [];
afterEach(async () =>
{
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, {
		recursive: true,
		force: true,
	})));
});

type Status = { codedGameState: string;
	detailedState: string;
	abstractGameState: string; };
const FINAL: Status = {
	codedGameState: "F",
	detailedState: "Final",
	abstractGameState: "Final",
};
const LIVE: Status = {
	codedGameState: "I",
	detailedState: "In Progress",
	abstractGameState: "Live",
};

/** Game `n` of `date`: a stable gamePk per day and slot. */
function pkOf(date: string, n: number): number
{
	return Number(date.replaceAll("-", "")) * 10 + n;
}

/**
 * A fake MLB: `gamesPerDay` games on each day, final unless `status` says otherwise, each
 * source answering unless its `fails` says it fails for that game. Every request is counted.
 */
class FakeMlb implements MlbGameSources
{
	readonly requests: string[] = [];
	status: (date: string, n: number) => Status = () => FINAL;
	fails: Partial<Record<ExtraSource | "feed" | "schedule", (gamePk: number, date: string) => boolean>> = {};

	constructor(private readonly gamesPerDay = 2) {}

	private dateOf(gamePk: number): string
	{
		const digits = String(Math.floor(gamePk / 10));
		return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
	}

	private failing(kind: ExtraSource | "feed" | "schedule", gamePk: number, date: string): boolean
	{
		return this.fails[kind]?.(gamePk, date) ?? false;
	}

	count(kind: string, date?: string): number
	{
		return this.requests.filter((r) => r.startsWith(`${kind} `) && (date === undefined || r.includes(date))).length;
	}

	async fetchSchedule(date: string): Promise<Unversioned<ScheduleDay>>
	{
		this.requests.push(`schedule ${date}`);
		if (this.failing("schedule", 0, date)) throw new Error("MLB Stats API 500");
		return {
			date,
			fetchedAt: NOW().toISOString(),
			windowMode: "cache",
			games: Array.from({
				length: this.gamesPerDay,
			}, (_, n) => ({
				...TEMPLATE_SUMMARY,
				gamePk: pkOf(date, n),
				officialDate: date,
				gameDate: `${date}T23:05:00Z`,
				status: this.status(date, n),
			})),
		};
	}

	async fetchGameFeed(gamePk: number): Promise<Unversioned<GameSnapshot>>
	{
		const date = this.dateOf(gamePk);
		this.requests.push(`feed ${gamePk} ${date}`);
		if (this.failing("feed", gamePk, date)) throw new Error("MLB Stats API 404");
		return {
			...TEMPLATE_FEED,
			gamePk,
			gameDate: date,
			officialDate: date,
			status: this.status(date, gamePk % 10),
		};
	}

	async fetchGameEditorial(gamePk: number)
	{
		const date = this.dateOf(gamePk);
		this.requests.push(`content ${gamePk} ${date}`);
		return this.failing("content", gamePk, date) ? null : {
			highlights: [],
			recap: {
				headline: `Recap ${gamePk}`,
			} as never,
		};
	}

	async fetchPlayMetrics(gamePk: number)
	{
		const date = this.dateOf(gamePk);
		this.requests.push(`playMetrics ${gamePk} ${date}`);
		return this.failing("playMetrics", gamePk, date) ? null : {
			gamePk,
			atBats: [],
		} as never;
	}

	async fetchGameGraphContent(gamePk: number)
	{
		const date = this.dateOf(gamePk);
		this.requests.push(`graphContent ${gamePk} ${date}`);
		return this.failing("graphContent", gamePk, date) ? null : {
			videoPlayRefs: [],
			relatedArticles: [],
		};
	}
}

/** Repositories that count their writes. */
type Counted = { schedules: ScheduleRepository;
	games: GameRepository;
	projections: GameProjectionRepository;
	writes: string[]; };

function counted(base: { schedules: ScheduleRepository;
	games: GameRepository;
	projections: GameProjectionRepository; }, failProjectionFor?: number): Counted
{
	const writes: string[] = [];
	let failed = false;
	return {
		writes,
		schedules: {
			getByDate: (date) => base.schedules.getByDate(date),
			listGameCounts: (from, to) => base.schedules.listGameCounts(from, to),
			upsert: async (day) =>
			{
				writes.push(`schedule ${day.date}`);
				await base.schedules.upsert(day);
			},
		},
		games: {
			getByPk: (pk) => base.games.getByPk(pk),
			listByDate: (date) => base.games.listByDate(date),
			upsert: async (game) =>
			{
				writes.push(`game ${game.gamePk}`);
				await base.games.upsert(game);
			},
		},
		projections: {
			getByPk: (pk) => base.projections.getByPk(pk),
			upsert: async (projection) =>
			{
				if (projection.header.gamePk === failProjectionFor && !failed)
				{
					failed = true;
					throw new Error("killed between the snapshot and projection writes");
				}
				writes.push(`projection ${projection.header.gamePk}`);
				await base.projections.upsert(projection);
			},
		},
	};
}

function memoryRepos()
{
	return {
		schedules: new InMemoryScheduleRepository(),
		games: new InMemoryGameRepository(),
		projections: new InMemoryGameProjectionRepository(),
	};
}

/** A resume store held in memory, shared across runs like the file. */
function memoryStore(): ResumeStore & { saved: BackfillState | undefined }
{
	const store = {
		saved: undefined as BackfillState | undefined,
		async load(): Promise<BackfillState>
		{
			return structuredClone(store.saved ?? {
				sources: {},
			});
		},
		async save(state: BackfillState): Promise<void>
		{
			store.saved = structuredClone(state);
		},
	};
	return store;
}

function deps(mlb: MlbGameSources, repos: Counted, state: ResumeStore, extra: Partial<BackfillDeps> = {}): BackfillDeps
{
	return {
		mlb,
		schedules: repos.schedules,
		games: repos.games,
		projections: repos.projections,
		state,
		now: NOW,
		...extra,
	};
}

/** An abort signal that fires once `days` days have been visited (read off the pacer hook). */
function stopAfter(days: number): Pick<BackfillDeps, "signal" | "pace">
{
	const controller = new AbortController();
	let seen = 0;
	return {
		signal: controller.signal,
		pace: () =>
		{
			if (++seen >= days) controller.abort();
		},
	};
}

const JULY = {
	from: "2026-07-01",
	to: "2026-07-10",
};

describe("runBackfill (S122)", () =>
{
	it("off-season: days from November 15 through February 15 make no request", async () =>
	{
		const mlb = new FakeMlb(1);
		const result = await runBackfill(deps(mlb, counted(memoryRepos()), memoryStore()), {
			from: "2025-11-13",
			to: "2026-02-17",
		});
		expect(mlb.requests.filter((r) => r.startsWith("schedule")).map((r) => r.slice(9))).toEqual(["2026-02-17", "2026-02-16", "2025-11-14", "2025-11-13"]);
		expect(result.days).toBe(4);
	});

	it("newest: walks newest to oldest", async () =>
	{
		const mlb = new FakeMlb(1);
		await runBackfill(deps(mlb, counted(memoryRepos()), memoryStore()), JULY);
		const days = mlb.requests.filter((r) => r.startsWith("schedule")).map((r) => r.slice(9));
		expect(days).toHaveLength(10);
		expect(days).toEqual([...days].sort().reverse());
		expect(days[0]).toBe("2026-07-10");
	});

	it("second run: a day already complete asks MLB nothing and writes nothing", async () =>
	{
		const mlb = new FakeMlb();
		const repos = counted(memoryRepos());
		const first = await runBackfill(deps(mlb, repos, memoryStore()), JULY);
		expect(first.gamesStored).toBe(20);
		expect(first.incomplete).toEqual([]);
		expect(mlb.requests).toHaveLength(10 + 20 * 4);
		mlb.requests.length = 0;
		repos.writes.length = 0;
		const second = await runBackfill(deps(mlb, repos, memoryStore()), JULY);
		expect(mlb.requests).toEqual([]);
		expect(repos.writes).toEqual([]);
		expect(second.alreadyComplete).toBe(10);
		expect(second.gamesStored).toBe(0);
	});

	it("repairs: a stop between a game's snapshot and projection writes is finished from the stored snapshot, with no MLB request", async () =>
	{
		const mlb = new FakeMlb();
		const base = memoryRepos();
		const victim = pkOf("2026-07-05", 1);
		await expect(runBackfill(deps(mlb, counted(base, victim), memoryStore()), JULY)).rejects.toThrow("killed");
		expect(await base.games.getByPk(victim)).not.toBeNull();
		expect(await base.projections.getByPk(victim)).toBeNull();

		const feedsBefore = mlb.count("feed", String(victim));
		const result = await runBackfill(deps(mlb, counted(base), memoryStore()), JULY);
		expect(mlb.count("feed", String(victim))).toBe(feedsBefore);
		expect(result.repaired).toBe(1);
		expect((await base.projections.getByPk(victim))?.header.version).toBe((await base.games.getByPk(victim))?.version);
		expect(result.incomplete).toEqual([]);

		// A projection older than its snapshot is repaired the same way.
		const snapshot = (await base.games.getByPk(victim))!;
		await base.games.upsert({
			...snapshot,
			version: snapshot.version + 1,
		});
		mlb.requests.length = 0;
		const again = await runBackfill(deps(mlb, counted(base), memoryStore()), JULY);
		expect(mlb.requests).toEqual([]);
		expect(again.repaired).toBe(1);
		expect((await base.projections.getByPk(victim))?.header.version).toBe(snapshot.version + 1);
	});

	it("unsettled: a day with a game not yet settled is checked again on the next run, until it settles", async () =>
	{
		const mlb = new FakeMlb();
		mlb.status = (date, n) => date === "2026-07-10" && n === 1 ? LIVE : FINAL;
		const repos = counted(memoryRepos());
		const first = await runBackfill(deps(mlb, repos, memoryStore()), JULY);
		expect(first.incomplete).toEqual(["2026-07-10"]);
		expect(mlb.count("feed", String(pkOf("2026-07-10", 1)))).toBe(0);

		mlb.requests.length = 0;
		await runBackfill(deps(mlb, repos, memoryStore()), JULY);
		expect(mlb.requests).toEqual(["schedule 2026-07-10"]);

		mlb.status = () => FINAL;
		mlb.requests.length = 0;
		const settled = await runBackfill(deps(mlb, repos, memoryStore()), JULY);
		expect(settled.incomplete).toEqual([]);
		expect(mlb.count("schedule")).toBe(1);
		expect(mlb.count("feed")).toBe(1);

		mlb.requests.length = 0;
		await runBackfill(deps(mlb, repos, memoryStore()), JULY);
		expect(mlb.requests).toEqual([]);
	});

	it("resumes: a run stopped part-way picks up at the first incomplete day, and both runs ask what one clean run asks", async () =>
	{
		const clean = new FakeMlb();
		await runBackfill(deps(clean, counted(memoryRepos()), memoryStore()), JULY);

		const mlb = new FakeMlb();
		const repos = counted(memoryRepos());
		const state = memoryStore();
		const stopped = await runBackfill(deps(mlb, repos, state, stopAfter(4)), JULY);
		expect(stopped.stopped).toBe(true);
		expect(stopped.days).toBe(4);
		const firstRun = mlb.requests.length;
		const resumed = await runBackfill(deps(mlb, repos, state), JULY);
		expect(resumed.alreadyComplete).toBe(4);
		expect(mlb.requests.slice(firstRun).filter((r) => r.startsWith("schedule"))[0]).toBe("schedule 2026-07-06");
		expect(mlb.requests).toHaveLength(clean.requests.length);
		expect([...mlb.requests].sort()).toEqual([...clean.requests].sort());

		// An MLB error on a day leaves it for the next run, which asks only for it.
		const flaky = new FakeMlb();
		flaky.fails.schedule = (_pk, date) => date === "2026-07-03" && flaky.count("schedule", date) === 1;
		const flakyRepos = counted(memoryRepos());
		const withError = await runBackfill(deps(flaky, flakyRepos, memoryStore()), JULY);
		expect(withError.incomplete).toEqual(["2026-07-03"]);
		flaky.requests.length = 0;
		await runBackfill(deps(flaky, flakyRepos, memoryStore()), JULY);
		expect(flaky.count("schedule")).toBe(1);
		expect(flaky.count("schedule", "2026-07-03")).toBe(1);
	});

	it("revisits: a run that asks again only for days it already counted saves no resume state", async () =>
	{
		const mlb = new FakeMlb();
		// Each day's second game has no live feed on the first run, so every day is counted but left incomplete.
		mlb.fails.feed = (pk) => pk % 10 === 1;
		const repos = counted(memoryRepos());
		const state = memoryStore();
		await runBackfill(deps(mlb, repos, state), JULY);
		expect(sourceGivenUpAt(state.saved?.sources.content)).toBeUndefined();
		expect(state.saved?.sources.content?.stretches).toHaveLength(1);
		mlb.fails.feed = undefined;
		let saves = 0;
		const second = await runBackfill(deps(mlb, repos, {
			load: () => state.load(),
			save: async (saved) =>
			{
				saves++;
				await state.save(saved);
			},
		}), JULY);
		// Each day's second game is fetched now and every source answers for it, but every day was already counted.
		expect(second.incomplete).toEqual([]);
		expect(mlb.count("content", "2026-07-01")).toBe(2);
		expect(saves).toBe(0);
	});

	it("gives up a source after 14 consecutive failed days of games, asking it for no older day; a day with any success resets the count", async () =>
	{
		const mlb = new FakeMlb();
		// Content fails for every game from 2026-07-25 back, except one game on 07-20.
		mlb.fails.content = (pk, date) => date <= "2026-07-25" && pk !== pkOf("2026-07-20", 0);
		const lines: string[] = [];
		const result = await runBackfill(deps(mlb, counted(memoryRepos()), memoryStore(), {
			log: (line) => lines.push(line),
		}), {
			from: "2026-06-01",
			to: "2026-07-31",
		});
		// 07-25 … 07-21 fail (5), 07-20 resets, then 07-19 back: the 14th failed day is 07-06.
		const givenUpAt = addDays("2026-07-19", -(GIVE_UP_AFTER_DAYS - 1));
		expect(result.givenUp).toEqual({
			content: givenUpAt,
		});
		expect(mlb.count("content", givenUpAt)).toBe(2);
		expect(mlb.requests.filter((r) => r.startsWith("content") && r.slice(-10) < givenUpAt)).toEqual([]);
		// The other sources kept answering and are still asked for the oldest day.
		expect(mlb.count("playMetrics", "2026-06-01")).toBe(2);
		expect(mlb.count("graphContent", "2026-06-01")).toBe(2);
		expect(lines.join("\n")).toContain(`${givenUpAt}: gave up content after 14 days`);
	});

	it("split run: a streak survives a stop, so 13 failed days then a resume gives up after the next failed day", async () =>
	{
		const mlb = new FakeMlb();
		mlb.fails.graphContent = () => true;
		const repos = counted(memoryRepos());
		const state = memoryStore();
		const range = {
			from: "2026-06-01",
			to: "2026-07-31",
		};
		const first = await runBackfill(deps(mlb, repos, state, stopAfter(13)), range);
		expect(first.days).toBe(13);
		expect(first.givenUp).toEqual({});
		expect(state.saved?.sources.graphContent).toEqual({
			stretches: [{
				newest: "2026-07-31",
				oldest: "2026-07-19",
				streak: 13,
				newestStreak: 13,
				allFailed: true,
				givenUp: false,
			}],
		});
		const before = mlb.count("graphContent");
		const second = await runBackfill(deps(mlb, repos, state), range);
		expect(second.givenUp).toEqual({
			graphContent: "2026-07-18",
		});
		expect(mlb.count("graphContent") - before).toBe(2);
		expect(sourceGivenUpAt(state.saved?.sources.graphContent)).toBe("2026-07-18");
	});

	it("two runs over ranges that don't touch: a newer range after a give-up counts its own streak and gives the source up again", async () =>
	{
		const mlb = new FakeMlb();
		mlb.fails.content = () => true;
		const state = memoryStore();
		const older = await runBackfill(deps(mlb, counted(memoryRepos()), state), {
			from: "2026-06-01",
			to: "2026-06-30",
		});
		expect(older.givenUp).toEqual({
			content: "2026-06-17",
		});
		mlb.requests.length = 0;
		const lines: string[] = [];
		const newer = await runBackfill(deps(mlb, counted(memoryRepos()), state, {
			log: (line) => lines.push(line),
		}), {
			from: "2026-07-01",
			to: "2026-07-31",
		});
		const gaveUp = lines.filter((line) => line.includes("gave up content"));
		expect(gaveUp).toHaveLength(1);
		expect(gaveUp[0]).toMatch(/^2026-07-18: /);
		// Content is asked for 07-31 … 07-18 (14 days, two games each) and for no older day of the newer range.
		expect(newer.givenUp).toEqual({
			content: "2026-07-18",
		});
		expect(mlb.count("content")).toBe(GIVE_UP_AFTER_DAYS * 2);
		expect(mlb.count("content", "2026-07-17")).toBe(0);
	});

	it("a newer range with fewer than 14 failed days keeps the earlier give-up and reports no new one", async () =>
	{
		const mlb = new FakeMlb();
		mlb.fails.content = () => true;
		const state = memoryStore();
		await runBackfill(deps(mlb, counted(memoryRepos()), state), {
			from: "2026-06-01",
			to: "2026-06-30",
		});
		const lines: string[] = [];
		const newer = await runBackfill(deps(mlb, counted(memoryRepos()), state, {
			log: (line) => lines.push(line),
		}), {
			from: "2026-07-20",
			to: "2026-07-31",
		});
		expect(newer.givenUp).toEqual({
			content: "2026-06-17",
		});
		expect(lines.filter((line) => line.includes("gave up"))).toEqual([]);
		expect(mlb.count("content", "2026-07-20")).toBe(2);
	});

	it("a day whose schedule MLB didn't serve is walked but not counted: it neither breaks nor adds to the streak", async () =>
	{
		const mlb = new FakeMlb();
		mlb.fails.content = () => true;
		mlb.fails.schedule = (_pk, date) => date === "2026-07-25";
		const result = await runBackfill(deps(mlb, counted(memoryRepos()), memoryStore()), {
			from: "2026-06-01",
			to: "2026-07-31",
		});
		// 07-31 … 07-26 and 07-24 … 07-17 are the 14 failed days of games.
		expect(result.givenUp).toEqual({
			content: "2026-07-17",
		});
		expect(result.incomplete).toEqual(["2026-07-25"]);
	});

	it("live feed: a game whose feed fails is never given up; its day stays incomplete and is retried next run", async () =>
	{
		const mlb = new FakeMlb(1);
		mlb.fails.feed = () => true;
		const repos = counted(memoryRepos());
		const range = {
			from: "2026-06-01",
			to: "2026-07-31",
		};
		const first = await runBackfill(deps(mlb, repos, memoryStore()), range);
		expect(first.incomplete).toHaveLength(61);
		expect(first.givenUp).toEqual({});
		expect(mlb.count("feed", "2026-06-01")).toBe(1);
		// No feed, so the extras were never asked and nothing counted toward their streaks.
		expect(mlb.count("content")).toBe(0);

		mlb.fails.feed = undefined;
		mlb.requests.length = 0;
		const second = await runBackfill(deps(mlb, repos, memoryStore()), range);
		expect(second.incomplete).toEqual([]);
		expect(mlb.count("feed")).toBe(61);
		expect(mlb.count("schedule")).toBe(0);
	});

	it("resume file: kept per database host and name, so a resumed run doesn't re-probe a given-up source and another database starts fresh", async () =>
	{
		const dir = await mkdtemp(path.join(tmpdir(), "bt-backfill-"));
		dirs.push(dir);
		const local = {
			host: "localhost",
			name: "bt",
		};
		const range = {
			from: "2026-06-01",
			to: "2026-07-31",
		};
		const mlb = new FakeMlb(1);
		mlb.fails.content = () => true;
		await runBackfill(deps(mlb, counted(memoryRepos()), fileResumeStore(dir, local), stopAfter(20)), range);
		expect(await readdir(dir)).toEqual(["localhost--bt.json"]);
		const saved = JSON.parse(await readFile(path.join(dir, "localhost--bt.json"), "utf8")) as BackfillState & { database: unknown };
		expect(saved.database).toEqual(local);
		expect(sourceGivenUpAt(saved.sources.content)).toBe("2026-07-18");

		// Resumed against the same database (fresh repos stand in for days not yet stored): no content request at or before 07-18.
		mlb.requests.length = 0;
		await runBackfill(deps(mlb, counted(memoryRepos()), fileResumeStore(dir, local)), {
			from: "2026-07-01",
			to: "2026-07-18",
		});
		expect(mlb.count("content")).toBe(0);

		// Another database has its own file and asks content again.
		mlb.requests.length = 0;
		await runBackfill(deps(mlb, counted(memoryRepos()), fileResumeStore(dir, {
			host: "localhost",
			name: "bt_other",
		})), {
			from: "2026-07-17",
			to: "2026-07-18",
		});
		expect(mlb.count("content")).toBe(2);
		expect((await readdir(dir)).sort()).toEqual(["localhost--bt.json", "localhost--bt_other.json"]);
	});

	it("resume file: an empty, unreadable or misshapen file fails naming the file to delete", async () =>
	{
		const dir = await mkdtemp(path.join(tmpdir(), "bt-backfill-"));
		dirs.push(dir);
		const target = {
			host: "localhost",
			name: "bt",
		};
		const file = path.join(dir, "localhost--bt.json");
		// Each bad stretch is a good one with one thing wrong, so the check it trips is the one named.
		const good = {
			newest: "2026-07-31",
			oldest: "2026-07-01",
			streak: 1,
			newestStreak: 0,
			allFailed: false,
			givenUp: false,
		};
		const stretches = (...list: unknown[]) => JSON.stringify({
			sources: {
				content: {
					stretches: list,
				},
			},
		});
		const old = (streak: Record<string, unknown>) => JSON.stringify({
			sources: {
				content: streak,
			},
		});
		const { allFailed: _allFailed, ...noAllFailed } = good;
		const { newestStreak: _newestStreak, ...noNewestStreak } = good;
		const { givenUp: _givenUp, ...noGivenUp } = good;
		for (const text of ["", "{nope", "[]", "{\"sources\":{\"content\":{\"streak\":\"x\"}}}", "{\"sources\":{\"videos\":{\"streak\":1}}}", "{\"sources\":{\"content\":{\"streak\":1,\"givenUpAt\":\"2026-02-30\"}}}",
			"{\"sources\":{\"content\":{\"stretches\":\"x\"}}}", stretches(1),
			stretches({
				...good,
				newest: "x",
			}), stretches({
				...good,
				newest: "2026-06-30",
			}), stretches({
				...good,
				streak: -1,
			}), stretches({
				...good,
				newestStreak: 1.5,
			}), stretches(noAllFailed), stretches(noNewestStreak), stretches(noGivenUp),
			stretches({
				...good,
				streak: 0,
				newestStreak: 0,
				allFailed: true,
			}), stretches({
				...good,
				streak: 3,
				newestStreak: 2,
				allFailed: true,
			}), stretches({
				...good,
				streak: GIVE_UP_AFTER_DAYS,
			}), stretches({
				...good,
				newestStreak: GIVE_UP_AFTER_DAYS,
			}), stretches(good, {
				...good,
				newest: "2026-07-15",
				oldest: "2026-06-20",
			}), stretches(good, {
				...good,
				newest: "2026-07-01",
				oldest: "2026-06-20",
			}),
			old({
				streak: 14,
				givenUpAt: "2026-07-18",
			}), old({
				streak: 14,
				lastCountedDay: "2026-07-17",
				givenUpAt: "2026-07-18",
			}), old({
				streak: 3,
				lastCountedDay: "2026-07-18",
				givenUpAt: "2026-07-18",
			}), old({
				streak: 14,
				lastCountedDay: "2026-07-18",
			})])
		{
			await writeFile(file, text);
			await expect(fileResumeStore(dir, target).load(), text).rejects.toThrow(`${file} is not a readable backfill resume file`);
			await expect(fileResumeStore(dir, target).load(), text).rejects.toThrow("delete it");
		}
	});

	it("resume file: a file saved before streaks were kept per stretch still loads, as one stretch at its last counted day", async () =>
	{
		const dir = await mkdtemp(path.join(tmpdir(), "bt-backfill-"));
		dirs.push(dir);
		const target = {
			host: "localhost",
			name: "bt",
		};
		await writeFile(path.join(dir, "localhost--bt.json"), JSON.stringify({
			sources: {
				content: {
					streak: 13,
					lastCountedDay: "2026-07-19",
				},
				playMetrics: {
					streak: 14,
					lastCountedDay: "2026-07-18",
					givenUpAt: "2026-07-18",
				},
				graphContent: {
					streak: 0,
				},
			},
		}));
		expect((await fileResumeStore(dir, target).load()).sources).toEqual({
			content: {
				stretches: [{
					newest: "2026-07-19",
					oldest: "2026-07-19",
					streak: 13,
					newestStreak: 0,
					allFailed: false,
					givenUp: false,
				}],
			},
			playMetrics: {
				stretches: [{
					newest: "2026-07-18",
					oldest: "2026-07-18",
					streak: 14,
					newestStreak: 0,
					allFailed: false,
					givenUp: true,
				}],
			},
			graphContent: {
				stretches: [],
			},
		});
	});

	it("old resume file: a give-up saved in the old shape still holds for older days, and a newer range gives the source up again", async () =>
	{
		const dir = await mkdtemp(path.join(tmpdir(), "bt-backfill-"));
		dirs.push(dir);
		const target = {
			host: "localhost",
			name: "bt",
		};
		await writeFile(path.join(dir, "localhost--bt.json"), JSON.stringify({
			sources: {
				content: {
					streak: 14,
					lastCountedDay: "2026-06-17",
					givenUpAt: "2026-06-17",
				},
			},
		}));
		const mlb = new FakeMlb();
		mlb.fails.content = () => true;
		const result = await runBackfill(deps(mlb, counted(memoryRepos()), fileResumeStore(dir, target)), {
			from: "2026-06-10",
			to: "2026-07-31",
		});
		expect(result.givenUp).toEqual({
			content: "2026-07-18",
		});
		expect(mlb.count("content")).toBe(GIVE_UP_AFTER_DAYS * 2);
	});

	it("old resume file: the owner's shape (streak 0 at 2026-09-01) doesn't stop a newer range from counting and giving up", async () =>
	{
		const dir = await mkdtemp(path.join(tmpdir(), "bt-backfill-"));
		dirs.push(dir);
		const target = {
			host: "localhost",
			name: "bt",
		};
		await writeFile(path.join(dir, "localhost--bt.json"), JSON.stringify({
			sources: Object.fromEntries(["content", "playMetrics", "graphContent"].map((source) => [source, {
				streak: 0,
				lastCountedDay: "2026-09-01",
			}])),
		}));
		const mlb = new FakeMlb();
		mlb.fails.graphContent = () => true;
		const result = await runBackfill(deps(mlb, counted(memoryRepos()), fileResumeStore(dir, target)), {
			from: "2026-09-10",
			to: "2026-10-10",
		});
		expect(result.givenUp).toEqual({
			graphContent: "2026-09-27",
		});
	});

	it("old resume file: a resume that recounts days above an old streak of 13 doesn't add them to it", async () =>
	{
		const dir = await mkdtemp(path.join(tmpdir(), "bt-backfill-"));
		dirs.push(dir);
		const target = {
			host: "localhost",
			name: "bt",
		};
		await writeFile(path.join(dir, "localhost--bt.json"), JSON.stringify({
			sources: {
				content: {
					streak: 13,
					lastCountedDay: "2026-07-19",
				},
			},
		}));
		// Fresh repos: 07-31 … 07-20, which the old run counted, are incomplete and asked again.
		const mlb = new FakeMlb();
		mlb.fails.content = () => true;
		const result = await runBackfill(deps(mlb, counted(memoryRepos()), fileResumeStore(dir, target)), {
			from: "2026-07-01",
			to: "2026-07-31",
		});
		expect(result.givenUp).toEqual({
			content: "2026-07-18",
		});
		expect(mlb.count("content", "2026-07-18")).toBe(2);
	});

	it("old resume file: a plain resume from an old streak of 13 gives up on the next failed day", async () =>
	{
		const dir = await mkdtemp(path.join(tmpdir(), "bt-backfill-"));
		dirs.push(dir);
		const target = {
			host: "localhost",
			name: "bt",
		};
		const mlb = new FakeMlb();
		mlb.fails.content = () => true;
		const repos = counted(memoryRepos());
		const range = {
			from: "2026-06-01",
			to: "2026-07-31",
		};
		// The first run stores 07-31 … 07-19; its streak is then written as an old file would have held it.
		await runBackfill(deps(mlb, repos, memoryStore(), stopAfter(13)), range);
		await writeFile(path.join(dir, "localhost--bt.json"), JSON.stringify({
			sources: {
				content: {
					streak: 13,
					lastCountedDay: "2026-07-19",
				},
			},
		}));
		mlb.requests.length = 0;
		const resumed = await runBackfill(deps(mlb, repos, fileResumeStore(dir, target)), range);
		expect(resumed.givenUp).toEqual({
			content: "2026-07-18",
		});
		expect(mlb.count("content")).toBe(2);
	});

	it("resume file: stretches saved oldest first load newest first", async () =>
	{
		const dir = await mkdtemp(path.join(tmpdir(), "bt-backfill-"));
		dirs.push(dir);
		const target = {
			host: "localhost",
			name: "bt",
		};
		const older = {
			newest: "2026-06-30",
			oldest: "2026-06-01",
			streak: 2,
			newestStreak: 0,
			allFailed: false,
			givenUp: false,
		};
		const newer = {
			newest: "2026-07-31",
			oldest: "2026-07-01",
			streak: 3,
			newestStreak: 3,
			allFailed: true,
			givenUp: false,
		};
		await writeFile(path.join(dir, "localhost--bt.json"), JSON.stringify({
			sources: {
				content: {
					stretches: [older, newer],
				},
			},
		}));
		expect((await fileResumeStore(dir, target).load()).sources.content?.stretches).toEqual([newer, older]);
	});

	it("resume file: a stretch counted just above a given-up one loads beside it", async () =>
	{
		const dir = await mkdtemp(path.join(tmpdir(), "bt-backfill-"));
		dirs.push(dir);
		const target = {
			host: "localhost",
			name: "bt",
		};
		const givenUp = {
			newest: "2010-04-30",
			oldest: "2010-04-17",
			streak: GIVE_UP_AFTER_DAYS,
			newestStreak: GIVE_UP_AFTER_DAYS,
			allFailed: true,
			givenUp: true,
		};
		const above = {
			newest: "2010-05-07",
			oldest: "2010-05-01",
			streak: 7,
			newestStreak: 7,
			allFailed: true,
			givenUp: false,
		};
		await writeFile(path.join(dir, "localhost--bt.json"), JSON.stringify({
			sources: {
				content: {
					stretches: [above, givenUp],
				},
			},
		}));
		expect((await fileResumeStore(dir, target).load()).sources.content?.stretches).toEqual([above, givenUp]);
	});

	it("resume file: two saves at once to one database both finish, leaving one whole file", async () =>
	{
		const dir = await mkdtemp(path.join(tmpdir(), "bt-backfill-"));
		dirs.push(dir);
		const target = {
			host: "localhost",
			name: "bt",
		};
		const a = fileResumeStore(dir, target);
		const b = fileResumeStore(dir, target);
		const saving = (streak: number) => ({
			sources: {
				content: {
					stretches: [{
						newest: "2026-07-31",
						oldest: "2026-07-31",
						streak,
						newestStreak: streak,
						allFailed: true,
						givenUp: false,
					}],
				},
			},
		});
		await Promise.all([a.save(saving(1)), b.save(saving(2))]);
		expect([1, 2]).toContain((await a.load()).sources.content?.stretches[0]?.streak);
		expect(await readdir(dir)).toEqual(["localhost--bt.json"]);
	});

	it("resume: a stop after a day's games are fetched but before its answers are saved can't lose them, so a source that answered isn't given up", async () =>
	{
		const mlb = new FakeMlb(1);
		mlb.fails.content = (_pk, date) => date === "2026-07-09";
		const repos = counted(memoryRepos());
		const state = memoryStore();
		state.saved = {
			sources: {
				content: {
					stretches: [{
						newest: "2026-07-31",
						oldest: "2026-07-11",
						streak: GIVE_UP_AFTER_DAYS - 1,
						newestStreak: GIVE_UP_AFTER_DAYS - 1,
						allFailed: true,
						givenUp: false,
					}],
				},
			},
		};
		const save = state.save.bind(state);
		let saves = 0;
		state.save = async (next) =>
		{
			if (saves++ === 0) throw new Error("killed before the resume file was written");
			await save(next);
		};
		const range = {
			from: "2026-07-09",
			to: "2026-07-10",
		};
		await expect(runBackfill(deps(mlb, repos, state), range)).rejects.toThrow("killed");
		const resumed = await runBackfill(deps(mlb, repos, state), range);
		// 07-10's content answered, so the streak reset there; 07-09's failure is the first of a new one.
		expect(resumed.givenUp).toEqual({});
		expect(state.saved?.sources.content).toEqual({
			stretches: [{
				newest: "2026-07-31",
				oldest: "2026-07-09",
				streak: 1,
				newestStreak: GIVE_UP_AFTER_DAYS - 1,
				allFailed: false,
				givenUp: false,
			}],
		});
	});

	it("empty day: a day MLB lists no games for is asked again while it is MLB's today, and settled once a run's today is past it", async () =>
	{
		const mlb = new FakeMlb(0);
		const repos = counted(memoryRepos());
		const range = {
			from: "2026-11-08",
			to: "2026-11-08",
		};
		const today = await runBackfill(deps(mlb, repos, memoryStore()), range);
		expect(today.incomplete).toEqual(["2026-11-08"]);
		mlb.requests.length = 0;
		const later = await runBackfill(deps(mlb, repos, memoryStore()), range);
		expect(mlb.requests).toEqual(["schedule 2026-11-08"]);
		expect(later.incomplete).toEqual(["2026-11-08"]);
		// The stored row keeps its first fetchedAt (unchanged, ADR-022), so the run's own clock decides.
		const nextDay = () => new Date("2026-11-09T17:00:00.000Z");
		mlb.requests.length = 0;
		const after = await runBackfill(deps(mlb, repos, memoryStore(), {
			now: nextDay,
		}), range);
		expect(mlb.requests).toEqual([]);
		expect(after.alreadyComplete).toBe(1);
	});

	it("progress: a line per day with its games stored and any sources given up", async () =>
	{
		const mlb = new FakeMlb();
		mlb.fails.content = () => true;
		const lines: string[] = [];
		await runBackfill(deps(mlb, counted(memoryRepos()), memoryStore(), {
			log: (line) => lines.push(line),
		}), {
			from: "2026-06-01",
			to: "2026-07-31",
		});
		expect(lines[0]).toBe("2026-07-31: 2 final, 2 stored");
		expect(lines).toContain("2026-07-17: 2 final, 2 stored; given up: content");
	});

	it("pacing: the pacer is told each day before its first request, and older days get the longer gap", async () =>
	{
		// Only the pacer's day and gap are read here; a request through it would be a bug.
		const polite = new PoliteFetch({
			today: "2026-11-08",
			fetchImpl: async () =>
			{
				throw new Error("no network in tests");
			},
		});
		const mlb = new FakeMlb(1);
		const seen: string[] = [];
		await runBackfill(deps(mlb, counted(memoryRepos()), memoryStore(), {
			pace: (day) =>
			{
				polite.setDay(day);
				seen.push(`${day} ${polite.gapMs} after ${mlb.requests.length}`);
			},
		}), {
			from: "2016-11-06",
			to: "2016-11-09",
		});
		expect(seen).toEqual([
			`2016-11-09 ${RECENT_GAP_MS} after 0`,
			`2016-11-08 ${RECENT_GAP_MS} after 5`,
			`2016-11-07 ${OLD_GAP_MS} after 10`,
			`2016-11-06 ${OLD_GAP_MS} after 15`,
		]);
	});
});

describe("runBackfill on the recordings through PGlite (S122 AC 3)", () =>
{
	/** The recorded 2026-09-05 day and 823823's sources, by URL; a 404 for every other game. */
	function recordedFetch(asked: string[]): typeof fetch
	{
		const raw = path.join(FIXTURES_ROOT, "raw");
		return async (input) =>
		{
			const url = new URL(String(input));
			asked.push(url.toString());
			const file = url.hostname === "data-graph.mlb.com" ? "graphql-content-823823.json"
				: url.pathname.endsWith("/bdfed/playMetrics/823823") ? "playmetrics-823823.json"
					: url.pathname === "/api/v1/schedule" && url.searchParams.get("date") === "2026-09-05" ? "schedule-2026-09-05.json"
						: url.pathname === "/api/v1.1/game/823823/feed/live" ? "live-823823.json"
							: url.pathname === "/api/v1/game/823823/content" ? "content-823823.json" : null;
			return file ? new Response(readFileSync(path.join(raw, file))) : new Response("{}", {
				status: 404,
			});
		};
	}

	it("823823: stores the day and its game through the version-guarded path, and a game stored unchanged is not rewritten", async () =>
	{
		const { db } = await migratedPglite();
		const asked: string[] = [];
		const polite = new PoliteFetch({
			today: "2026-11-08",
			recentGapMs: 0,
			oldGapMs: 0,
			fetchImpl: recordedFetch(asked),
		});
		const mlb = new HttpMlbStatsClient({
			fetchImpl: polite.fetch,
			now: NOW,
		});
		const repos = counted({
			schedules: new PostgresScheduleRepository(db),
			games: new PostgresGameRepository(db),
			projections: new PostgresGameProjectionRepository(db),
		});
		const day = {
			from: "2026-09-05",
			to: "2026-09-05",
		};
		const first = await runBackfill(deps(mlb, repos, memoryStore(), {
			pace: (d) => polite.setDay(d),
		}), day);
		// 823823 is the one game with a recorded feed; the other 14 leave the day for the next run.
		expect(first.gamesStored).toBe(1);
		expect(first.incomplete).toEqual(["2026-09-05"]);
		const stored = (await repos.games.getByPk(823823))!;
		expect(stored.version).toBe(1);
		expect(stored.highlights.length).toBeGreaterThan(0);
		expect(stored.playMetrics).toBeDefined();
		expect(stored.videoPlayRefs?.length).toBeGreaterThan(0);
		expect((await repos.projections.getByPk(823823))?.header.version).toBe(1);
		expect((await repos.schedules.getByDate("2026-09-05"))?.games).toHaveLength(15);
		// The same game the adapter's fetchGame builds (one assembly, both paths).
		const whole = await mlb.fetchGame(823823);
		expect(stored.highlights.map((h) => h.id)).toEqual(whole.highlights.map((h) => h.id));
		expect(stored.recap).toEqual(whole.recap);

		// Unchanged content through ingest's guard writes nothing.
		repos.writes.length = 0;
		expect((await ingestGame(repos, {
			...whole,
			fetchedAt: NOW().toISOString(),
			windowMode: "cache",
		})).changed).toBe(false);
		expect(repos.writes).toEqual([]);

		// The next run doesn't ask for the stored, final 823823 or the settled day again.
		asked.length = 0;
		await runBackfill(deps(mlb, repos, memoryStore()), day);
		expect(asked.filter((u) => u.includes("823823"))).toEqual([]);
		expect(asked.filter((u) => u.includes("/schedule"))).toEqual([]);
		expect(asked.filter((u) => u.includes("/feed/live"))).toHaveLength(14);
		expect(repos.writes).toEqual([]);
	});
});
