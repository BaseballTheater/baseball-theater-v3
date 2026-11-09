/**
 * S124: games per day for a month, from BT's stored schedule days, through the API route.
 * Every test runs at a fixed clock in November 2026, so 2026 is the current season: its days
 * and later ones may be filled from MLB (a counting fake), earlier seasons never are.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ScheduleDay, ScheduleGameSummary, Unversioned,
} from "@bt/domain";
import { datesBetween, scheduleWindowMode } from "@bt/domain";
import type {
	GameProjectionRepository, GameRepository, MlbStatsClient, ScheduleRepository,
} from "@bt/ports";
import {
	describe, expect, it,
} from "vitest";
import { createDevAccountData, createDevAuth } from "../adapters/fixtures/auth.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { HttpMlbStatsClient } from "../adapters/http/mlb.js";
import {
	InMemoryGameProjectionRepository,
	InMemoryGameRepository,
	InMemoryScheduleRepository,
	InMemorySettingsRepository,
} from "../adapters/memory/repos.js";
import { migratedPglite } from "../adapters/postgres/migrate.js";
import {
	PostgresGameProjectionRepository, PostgresGameRepository, PostgresScheduleRepository,
} from "../adapters/postgres/repos.js";
import { STALE_WHILE_REVALIDATE_S } from "../handlers/cache-control.js";
import { handleApiRequest } from "../handlers/api.js";
import { recordedClient } from "../test/recorded-mlb.js";
import type { IngestDeps } from "./ingest.js";
import { storeSchedule } from "./ingest.js";
import { getScheduleMonth } from "./schedule-month.js";
import { RefreshCoordinator } from "./refresh.js";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
/** In the 2026 off-season: 2026 is the current season, 2024 a past one. */
const T0 = new Date("2026-11-09T17:00:00Z");
const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/raw");

type Repos = {
	schedules: ScheduleRepository;
	games: GameRepository;
	projections: GameProjectionRepository;
};

/** An MLB client that counts what it is asked, answering a range with `gamesOn`'s games (none by default). */
class CountingClient extends FixtureMlbStatsClient
{
	readonly ranges: [string, string][] = [];
	days = 0;
	games = 0;
	fail = false;
	readonly gamesOn = new Map<string, ScheduleGameSummary[]>();

	override async fetchScheduleRange(startDate: string, endDate: string): Promise<Unversioned<ScheduleDay>[]>
	{
		this.ranges.push([startDate, endDate]);
		if (this.fail) throw new Error("MLB unreachable");
		return datesBetween(startDate, endDate).map((date) => ({
			date,
			games: this.gamesOn.get(date) ?? [],
			fetchedAt: "",
			windowMode: "cache",
		}));
	}

	override async fetchSchedule(date: string): Promise<Unversioned<ScheduleDay>>
	{
		this.days++;
		return super.fetchSchedule(date);
	}

	override async fetchGame(gamePk: number): ReturnType<FixtureMlbStatsClient["fetchGame"]>
	{
		this.games++;
		return super.fetchGame(gamePk);
	}
}

function memoryRepos(): Repos
{
	return {
		schedules: new InMemoryScheduleRepository(),
		games: new InMemoryGameRepository(),
		projections: new InMemoryGameProjectionRepository(),
	};
}

async function pgliteRepos(): Promise<Repos>
{
	const { db } = await migratedPglite();
	return {
		schedules: new PostgresScheduleRepository(db),
		games: new PostgresGameRepository(db),
		projections: new PostgresGameProjectionRepository(db),
	};
}

/** The API over `repos`, read at whatever `clock.now` says (from `start`), with a fresh refresh coordinator. */
function api(repos: Repos, mlb: MlbStatsClient = new CountingClient(), start: Date = T0)
{
	const clock = {
		now: start,
	};
	const auth = createDevAuth();
	const settings = new InMemorySettingsRepository();
	const ctx = {
		ingest: {
			mlb,
			...repos,
			now: () => clock.now,
			refresh: new RefreshCoordinator(() => clock.now),
		},
		auth,
		settings,
		account: createDevAccountData({
			users: auth.users,
			settings,
		}),
	};
	return {
		clock,
		get: (route: string) => handleApiRequest(new Request(`http://localhost:8787${route}`), ctx),
		month: async (month: string) =>
		{
			const response = await handleApiRequest(new Request(`http://localhost:8787/api/v1/schedule/month/${month}`), ctx);
			expect(response.status).toBe(200);
			const body = await response.json() as { month: string;
				days: { date: string;
					count: number | null; }[]; };
			return {
				body,
				count: (date: string) => body.days.find((day) => day.date === date)?.count,
				cacheControl: response.headers.get("Cache-Control"),
			};
		},
	};
}

/** A day's games, the first not yet played and the second postponed, as a stored schedule lists them. */
async function mixedGames(): Promise<ScheduleGameSummary[]>
{
	const [first, second] = (await new FixtureMlbStatsClient().fetchSchedule("2024-07-04")).games;
	return [
		{
			...first!,
			status: {
				...first!.status,
				abstractGameState: "Preview",
				codedGameState: "S",
				detailedState: "Scheduled",
			},
		},
		{
			...second!,
			status: {
				...second!.status,
				abstractGameState: "Final",
				codedGameState: "D",
				detailedState: "Postponed",
			},
		},
	];
}

/** Stores a schedule day the way ingest does (version-guarded, ADR-022; its window judged at `at`). */
async function store(repos: Repos, date: string, games: ScheduleGameSummary[], at: Date = T0): Promise<void>
{
	await storeSchedule(repos, {
		date,
		games,
		fetchedAt: at.toISOString(),
		windowMode: scheduleWindowMode(games, at),
	});
}

describe.each([["memory", async () => memoryRepos()], ["PGlite", pgliteRepos]] as const)("S124 AC 1 %s", (_name, makeRepos) =>
{
	it("counts every day of the month from its stored schedule day, scheduled and postponed games included, with no game snapshots stored", async () =>
	{
		const repos = await makeRepos();
		const games = await mixedGames();
		await store(repos, "2024-07-04", games);
		await store(repos, "2024-07-05", []);
		const mlb = new CountingClient();
		const { body, count } = await api(repos, mlb).month("2024-07");
		expect(body.month).toBe("2024-07");
		expect(body.days.map((day) => day.date)).toEqual(datesBetween("2024-07-01", "2024-07-31"));
		expect(count("2024-07-04")).toBe(2);
		expect(count("2024-07-05")).toBe(0);
		expect(count("2024-07-06")).toBeNull();
		expect(await repos.games.listByDate("2024-07-04")).toEqual([]);
		// A past season is never asked of MLB here.
		expect(mlb.ranges).toEqual([]);
	});
});

describe("S124 AC 1 one query", () =>
{
	it("reads a month with one repository query, never one per day", async () =>
	{
		const repos = memoryRepos();
		await store(repos, "2024-07-04", await mixedGames());
		const calls = {
			list: 0,
			day: 0,
		};
		const schedules: ScheduleRepository = {
			getByDate: (date) =>
			{
				calls.day++;
				return repos.schedules.getByDate(date);
			},
			upsert: (day) => repos.schedules.upsert(day),
			listGameCounts: (from, to) =>
			{
				calls.list++;
				return repos.schedules.listGameCounts(from, to);
			},
		};
		await api({
			...repos,
			schedules,
		}).month("2024-07");
		expect(calls).toEqual({
			list: 1,
			day: 0,
		});
	});
});

describe("S124 AC 2", () =>
{
	it("S124 AC 2 empty month: one schedule request for the whole month, no game request", async () =>
	{
		const repos = memoryRepos();
		const mlb = new CountingClient();
		mlb.gamesOn.set("2026-12-12", await mixedGames());
		const { count } = await api(repos, mlb).month("2026-12");
		expect(mlb.ranges).toEqual([["2026-12-01", "2026-12-31"]]);
		expect(mlb.days).toBe(0);
		expect(mlb.games).toBe(0);
		expect(count("2026-12-12")).toBe(2);
		expect(count("2026-12-13")).toBe(0);
		expect((await repos.schedules.getByDate("2026-12-12"))?.version).toBe(1);
		// Each filled day's window is judged at the fill (`scheduleWindowMode`), day by day.
		const twelfth = await repos.schedules.getByDate("2026-12-12");
		expect(twelfth?.windowMode).toBe(scheduleWindowMode(twelfth!.games, T0));
		expect((await repos.schedules.getByDate("2026-12-13"))?.windowMode).toBe("cache");
	});

	it("S124 AC 2 holding the ends: only the span between the days it holds is asked", async () =>
	{
		const repos = memoryRepos();
		await store(repos, "2027-04-01", []);
		await store(repos, "2027-04-30", []);
		const mlb = new CountingClient();
		await api(repos, mlb).month("2027-04");
		expect(mlb.ranges).toEqual([["2027-04-02", "2027-04-29"]]);
	});

	it("S124 AC 2 season start: a month of an earlier season is never asked; MLB's today, not UTC's, sets the season", async () =>
	{
		const mlb = new CountingClient();
		const { body } = await api(memoryRepos(), mlb).month("2025-12");
		expect(body.days.every((day) => day.count === null)).toBe(true);
		expect(mlb.ranges).toEqual([]);
		// 03:00 UTC on 2027-01-01 is still 2026-12-31 for MLB, so 2026 is still the current season.
		const late = new CountingClient();
		await api(memoryRepos(), late, new Date("2027-01-01T03:00:00Z")).month("2026-12");
		expect(late.ranges).toEqual([["2026-12-01", "2026-12-31"]]);
	});

	it("S124 AC 2 store failure: a schedule write that fails rejects the read, rather than passing for MLB being unreachable", async () =>
	{
		const repos = memoryRepos();
		let writes = 0;
		const schedules: ScheduleRepository = {
			getByDate: (date) => repos.schedules.getByDate(date),
			upsert: async (day) =>
			{
				if (++writes === 3) throw new Error("database down");
				await repos.schedules.upsert(day);
			},
			listGameCounts: (from, to) => repos.schedules.listGameCounts(from, to),
		};
		const deps: IngestDeps = {
			...repos,
			schedules,
			mlb: new CountingClient(),
			now: () => T0,
		};
		await expect(getScheduleMonth(deps, "2026-12")).rejects.toThrow("database down");
		// The two days written before it stay (each write is version-guarded on its own).
		expect(await repos.schedules.listGameCounts("2026-12-01", "2026-12-31")).toHaveLength(2);
	});

	it("S124 AC 2 recorded range: the recorded client answers a range from its recorded days", async () =>
	{
		const { mlb, asked } = recordedClient();
		const { count } = await api(memoryRepos(), mlb).month("2026-09");
		expect(asked).toHaveLength(1);
		expect(count("2026-09-05")).toBe(15);
		expect(count("2026-09-06")).toBe(0);
	});

	it("S124 AC 2 concurrent: two reads at once share one request through the coordinator", async () =>
	{
		const repos = memoryRepos();
		const mlb = new CountingClient();
		mlb.gamesOn.set("2026-12-12", await mixedGames());
		const reader = api(repos, mlb);
		const [a, b] = await Promise.all([reader.month("2026-12"), reader.month("2026-12")]);
		expect(mlb.ranges).toHaveLength(1);
		expect(a.count("2026-12-12")).toBe(2);
		expect(b.count("2026-12-12")).toBe(2);
	});

	it("S124 AC 2 concurrent without a coordinator: each read asks for itself, and both answers are right", async () =>
	{
		const repos = memoryRepos();
		const mlb = new CountingClient();
		mlb.gamesOn.set("2026-12-12", await mixedGames());
		const deps: IngestDeps = {
			...repos,
			mlb,
			now: () => T0,
		};
		const [a, b] = await Promise.all([getScheduleMonth(deps, "2026-12"), getScheduleMonth(deps, "2026-12")]);
		expect(mlb.ranges).toHaveLength(2);
		for (const answer of [a, b]) expect(answer.days.find((day) => day.date === "2026-12-12")?.count).toBe(2);
		// Stored once: the second write of the same content kept its version (ADR-022).
		expect((await repos.schedules.getByDate("2026-12-12"))?.version).toBe(1);
		// Inside the lifetime a later read asks nothing.
		await getScheduleMonth(deps, "2026-12");
		expect(mlb.ranges).toHaveLength(2);
	});

	it("S124 AC 2 holding one day: the days around it are filled with one schedule request, no game request", async () =>
	{
		const repos = memoryRepos();
		const games = await mixedGames();
		await store(repos, "2027-04-05", games);
		const mlb = new CountingClient();
		mlb.gamesOn.set("2027-04-05", games);
		mlb.gamesOn.set("2027-04-20", games.slice(0, 1));
		const { count } = await api(repos, mlb).month("2027-04");
		expect(mlb.ranges).toEqual([["2027-04-01", "2027-04-30"]]);
		expect(mlb.days).toBe(0);
		expect(mlb.games).toBe(0);
		expect(count("2027-04-05")).toBe(2);
		expect(count("2027-04-20")).toBe(1);
		expect(count("2027-04-01")).toBe(0);
		// The day it held was unchanged, so the version guard wrote nothing new (ADR-022).
		expect((await repos.schedules.getByDate("2027-04-05"))?.version).toBe(1);
	});

	it("S124 AC 2 null: a day still unknown after the request (it failed) is null, distinct from a stored day with no games", async () =>
	{
		const repos = memoryRepos();
		await store(repos, "2026-12-25", []);
		const mlb = new CountingClient();
		mlb.fail = true;
		const { count, body } = await api(repos, mlb).month("2026-12");
		expect(mlb.ranges).toHaveLength(1);
		expect(count("2026-12-25")).toBe(0);
		expect(count("2026-12-24")).toBeNull();
		expect(body.days.filter((day) => day.count === null)).toHaveLength(30);
	});

	it("S124 AC 2 null: a past month nothing stored is all null, and MLB is not asked", async () =>
	{
		const mlb = new CountingClient();
		const { body } = await api(memoryRepos(), mlb).month("2019-05");
		expect(body.days.every((day) => day.count === null)).toBe(true);
		expect(mlb.ranges).toEqual([]);
		expect(mlb.days).toBe(0);
	});

	it("S124 AC 2 absent day: MLB's range answer lists only days with games; the others are stored with none, not another day's games", async () =>
	{
		const urls: string[] = [];
		const mlb = new HttpMlbStatsClient({
			now: () => T0,
			fetchImpl: async (input) =>
			{
				urls.push(String(input));
				return new Response(readFileSync(path.join(RAW, "schedule-2026-09-05.json")));
			},
		});
		const repos = memoryRepos();
		const { count } = await api(repos, mlb).month("2026-09");
		expect(urls).toHaveLength(1);
		expect(new URL(urls[0]!).searchParams.get("startDate")).toBe("2026-09-01");
		expect(count("2026-09-05")).toBe(15);
		expect(count("2026-09-04")).toBe(0);
		expect(count("2026-09-30")).toBe(0);
		expect((await repos.schedules.getByDate("2026-09-04"))?.games).toEqual([]);
	});
});

describe.each([["memory", async () => memoryRepos()], ["PGlite", pgliteRepos]] as const)("S124 AC 3 %s", (_name, makeRepos) =>
{
	it("S124 AC 3 headers reset: a past month unchanged for a month is cached for the cap, and one that changes drops to the floor", async () =>
	{
		const repos = await makeRepos();
		const longAgo = new Date(T0.getTime() - 30 * DAY);
		for (const date of datesBetween("2024-07-01", "2024-07-31")) await store(repos, date, [], longAgo);
		const reader = api(repos);
		expect((await reader.month("2024-07")).cacheControl).toBe(`public, s-maxage=172800, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
		// A backfill fills a day of it now.
		await store(repos, "2024-07-04", await mixedGames(), T0);
		expect((await reader.month("2024-07")).cacheControl).toBe(`public, s-maxage=300, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
	});

	it("S124 AC 3 headers reset: a month with an unknown day is checked again at the floor", async () =>
	{
		expect((await api(await makeRepos()).month("2019-05")).cacheControl).toBe(`public, s-maxage=300, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
	});

	it("S124 AC 3 headers reset: a partly stored past month is checked again at the floor, not by its stored day's age", async () =>
	{
		const repos = await makeRepos();
		await store(repos, "2024-07-04", [], new Date(T0.getTime() - 30 * DAY));
		expect((await api(repos).month("2024-07")).cacheControl).toBe(`public, s-maxage=300, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
	});

	it("S124 AC 3 lifetime: past the cooldown but inside the month's lifetime, nothing is asked again", async () =>
	{
		const repos = await makeRepos();
		const mlb = new CountingClient();
		const reader = api(repos, mlb);
		await reader.month("2027-03");
		expect(mlb.ranges).toHaveLength(1);
		// Two minutes on: past the coordinator's one-minute cooldown, inside the five-minute floor.
		reader.clock.now = new Date(T0.getTime() + 2 * MINUTE);
		await reader.month("2027-03");
		expect(mlb.ranges).toHaveLength(1);
	});

	it("S124 AC 3 lifetime: a month whose every day was fetched a minute ago is not asked, even by a fresh isolate", async () =>
	{
		const repos = await makeRepos();
		for (const date of datesBetween("2026-12-01", "2026-12-31")) await store(repos, date, [], new Date(T0.getTime() - MINUTE));
		const mlb = new CountingClient();
		await api(repos, mlb).month("2026-12");
		expect(mlb.ranges).toEqual([]);
	});

	it("S124 AC 3 oldest check: the month counts as checked at its oldest day's fetch, so one old day makes it stale", async () =>
	{
		const repos = await makeRepos();
		await store(repos, "2026-12-01", [], new Date(T0.getTime() - 30 * DAY));
		for (const date of datesBetween("2026-12-02", "2026-12-31")) await store(repos, date, [], new Date(T0.getTime() - MINUTE));
		const mlb = new CountingClient();
		await api(repos, mlb).month("2026-12");
		expect(mlb.ranges).toEqual([["2026-12-01", "2026-12-31"]]);
	});

	it("S124 AC 3 failed refresh: a fill MLB didn't answer isn't a check, so the month is asked again once the cooldown passes", async () =>
	{
		const repos = await makeRepos();
		// Every day stored and last changed three days ago: once checked now, the ladder would
		// give the month its 48-hour cap, so a failure counted as a check would hide it for two days.
		for (const date of datesBetween("2026-12-01", "2026-12-31")) await store(repos, date, [], new Date(T0.getTime() - 3 * DAY));
		const mlb = new CountingClient();
		mlb.fail = true;
		const reader = api(repos, mlb);
		await reader.month("2026-12");
		expect(mlb.ranges).toHaveLength(1);
		mlb.fail = false;
		reader.clock.now = new Date(T0.getTime() + 2 * MINUTE);
		await reader.month("2026-12");
		expect(mlb.ranges).toHaveLength(2);
	});

	it("S124 AC 3 gains games after expiry: a future month stored empty gains its games once its lifetime has run out, with one schedule request and no game request", async () =>
	{
		const repos = await makeRepos();
		const mlb = new CountingClient();
		const reader = api(repos, mlb);
		expect((await reader.month("2027-03")).body.days.every((day) => day.count === 0)).toBe(true);
		expect(mlb.ranges).toHaveLength(1);
		// Inside its lifetime nothing is asked again.
		expect((await reader.month("2027-03")).count("2027-03-26")).toBe(0);
		expect(mlb.ranges).toHaveLength(1);
		// MLB publishes the schedule; past the floor's five minutes the next read asks once more.
		mlb.gamesOn.set("2027-03-26", await mixedGames());
		reader.clock.now = new Date(T0.getTime() + 6 * MINUTE);
		const later = await reader.month("2027-03");
		expect(mlb.ranges).toEqual([["2027-03-01", "2027-03-31"], ["2027-03-01", "2027-03-31"]]);
		expect(mlb.games).toBe(0);
		expect(mlb.days).toBe(0);
		expect(later.count("2027-03-26")).toBe(2);
		expect(later.cacheControl).toBe(`public, s-maxage=300, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
	});
});

describe("S124 AC 5", () =>
{
	it("rejects a month before 1901-04, or a malformed one, with a 400", async () =>
	{
		const { get } = api(memoryRepos());
		for (const month of ["1901-03", "1900-12", "1901-4", "2026-13", "2026-00", "2026-1", "202601", "2026-01-01"])
		{
			const response = await get(`/api/v1/schedule/month/${month}`);
			expect(response.status, month).toBe(400);
			expect(await response.json()).toEqual({
				error: "month_invalid",
				hint: "YYYY-MM, 1901-04 or later",
			});
		}
	});

	it("S124 AC 5 horizon: a month after December of next year is a 400 and asks MLB nothing; December itself is answered", async () =>
	{
		const mlb = new CountingClient();
		const { get, month } = api(memoryRepos(), mlb);
		for (const tooLate of ["2028-01", "2099-07", "9999-12"])
		{
			const response = await get(`/api/v1/schedule/month/${tooLate}`);
			expect(response.status, tooLate).toBe(400);
			expect(await response.json()).toEqual({
				error: "month_too_late",
				hint: "YYYY-MM, 2027-12 or earlier",
			});
		}
		expect(mlb.ranges).toEqual([]);
		const { body } = await month("2027-12");
		expect(body.days).toHaveLength(31);
		expect(mlb.ranges).toEqual([["2027-12-01", "2027-12-31"]]);
	});

	it("S124 AC 5 horizon: next year is MLB's, not UTC's", async () =>
	{
		// 03:00 UTC on 2027-01-01 is 2026-12-31 for MLB: next year is still 2027.
		const early = api(memoryRepos(), new CountingClient(), new Date("2027-01-01T03:00:00Z"));
		expect((await early.get("/api/v1/schedule/month/2028-01")).status).toBe(400);
		expect((await early.month("2027-12")).body.days).toHaveLength(31);
		// By 06:00 UTC it is 2027-01-01 for MLB too, and 2028 is next year.
		const later = api(memoryRepos(), new CountingClient(), new Date("2027-01-01T06:00:00Z"));
		expect((await later.month("2028-01")).body.days).toHaveLength(31);
	});

	it("answers 1901-04, the earliest month, with every day", async () =>
	{
		const { body } = await api(memoryRepos()).month("1901-04");
		expect(body.days).toHaveLength(30);
	});
});
