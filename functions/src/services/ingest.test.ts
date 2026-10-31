import {
	describe, expect, it,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository,
	InMemoryGameRepository,
	InMemoryScheduleRepository,
} from "../adapters/memory/repos.js";
import { getOrRefreshGame, ingestScheduleDay } from "./ingest.js";
import { RefreshCoordinator } from "./refresh.js";

describe("ingest with fixtures", () =>
{
	it("loads schedule and games into memory", async () =>
	{
		const schedules = new InMemoryScheduleRepository();
		const games = new InMemoryGameRepository();
		const projections = new InMemoryGameProjectionRepository();
		const mlb = new FixtureMlbStatsClient();
		const day = await ingestScheduleDay(
			{
				mlb,
				schedules,
				games,
				projections,
			},
			"2024-07-04",
		);
		expect(day.games.length).toBe(2);
		expect(await schedules.getByDate("2024-07-04")).not.toBeNull();
		const game = await getOrRefreshGame({
			mlb,
			schedules,
			games,
			projections,
		}, 744834);
		expect(game?.teams.home.abbreviation).toBe("WSH");
		expect(game?.highlights[0]?.title.toLowerCase()).toContain("walk-off");
	});
});

describe("ingest versioning (ADR-022)", () =>
{
	/** A fixture client whose game 744834 can be edited between polls. */
	class EditableClient extends FixtureMlbStatsClient
	{
		detailedState: string | null = null;

		override async fetchGame(gamePk: number)
		{
			const game = await super.fetchGame(gamePk);
			return this.detailedState === null ? game : {
				...game,
				status: {
					...game.status,
					detailedState: this.detailedState,
				},
			};
		}
	}

	it("keeps the version when the same fixture is ingested twice, and bumps it on a changed payload", async () =>
	{
		const mlb = new EditableClient();
		const games = new InMemoryGameRepository();
		const projections = new InMemoryGameProjectionRepository();
		let clock = new Date("2024-07-05T12:00:00.000Z");
		const deps = {
			mlb,
			schedules: new InMemoryScheduleRepository(),
			games,
			projections,
			now: () => clock,
		};

		const first = await getOrRefreshGame(deps, 744834, {
			force: true,
		});
		expect(first?.version).toBe(1);
		expect(first?.lastChangedAt).toBe("2024-07-05T12:00:00.000Z");

		clock = new Date("2024-07-05T12:10:00.000Z");
		const same = await getOrRefreshGame(deps, 744834, {
			force: true,
		});
		expect(same?.version).toBe(1);
		expect(same?.lastChangedAt).toBe("2024-07-05T12:00:00.000Z");
		expect((await games.getByPk(744834))?.version).toBe(1);

		mlb.detailedState = "Final: revised";
		clock = new Date("2024-07-05T12:20:00.000Z");
		const changed = await getOrRefreshGame(deps, 744834, {
			force: true,
		});
		expect(changed?.version).toBe(2);
		expect(changed?.lastChangedAt).toBe("2024-07-05T12:20:00.000Z");
		expect((await games.getByPk(744834))?.status.detailedState).toBe("Final: revised");
		expect((await projections.getByPk(744834))?.header.version).toBe(2);
	});

	it("keeps a schedule day's version across identical re-ingests", async () =>
	{
		const schedules = new InMemoryScheduleRepository();
		const deps = {
			mlb: new FixtureMlbStatsClient(),
			schedules,
			games: new InMemoryGameRepository(),
			projections: new InMemoryGameProjectionRepository(),
			now: () => new Date("2024-07-05T12:00:00.000Z"),
		};
		await ingestScheduleDay(deps, "2024-07-04");
		const again = await ingestScheduleDay({
			...deps,
			now: () => new Date("2024-07-05T12:30:00.000Z"),
		}, "2024-07-04");
		expect(again.version).toBe(1);
		expect((await schedules.getByDate("2024-07-04"))?.version).toBe(1);
	});
});

describe("refresh-on-read cache lifetime (S47, ADR-021)", () =>
{
	it("lifetime: each unchanged check earns a longer wait before MLB is asked again, up the ladder", async () =>
	{
		const MINUTE = 60_000;
		const real = new FixtureMlbStatsClient();
		let calls = 0;
		const mlb = new FixtureMlbStatsClient();
		mlb.fetchGame = async (pk: number) =>
		{
			calls += 1;
			return real.fetchGame(pk);
		};
		let clock = new Date("2026-10-30T12:00:00Z");
		const deps = {
			mlb,
			schedules: new InMemoryScheduleRepository(),
			games: new InMemoryGameRepository(),
			projections: new InMemoryGameProjectionRepository(),
			refresh: new RefreshCoordinator(() => clock, 0),
			now: () => clock,
		};
		const at = async (minutes: number) =>
		{
			clock = new Date(Date.parse("2026-10-30T12:00:00Z") + minutes * MINUTE);
			await getOrRefreshGame(deps, 823823);
			return calls;
		};
		// Stored at 0 (changed then): the floor, 5 minutes.
		expect(await at(0)).toBe(1);
		expect(await at(4)).toBe(1);
		// Checked at 5 (5m unchanged: still the floor), then at 10 (10m unchanged: 15m earned).
		expect(await at(5)).toBe(2);
		expect(await at(10)).toBe(3);
		expect(await at(24)).toBe(3);
		// Checked at 25 (25m unchanged: 30m earned), so 54 is served from the store and 55 asks again.
		expect(await at(25)).toBe(4);
		expect(await at(54)).toBe(4);
		expect(await at(55)).toBe(5);
		// 55m unchanged earned 2h: nothing until 175.
		expect(await at(174)).toBe(5);
		expect(await at(175)).toBe(6);
	});
});
