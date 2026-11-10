import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { jsonResponse } from "../test/jsonResponse.js";
import {
	fetchGame, fetchSchedule, fetchScheduleMonth,
} from "./client.js";

/** Stubs the global fetch with one JSON response. */
function mockFetchOnce(body: unknown, status = 200): void
{
	vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(body, status)));
}

/** The path and query of the one request the client sent through the stubbed fetch. */
function requestedPath(): string
{
	const request = vi.mocked(fetch).mock.calls[0]?.[0] as Request;
	const url = new URL(request.url);
	return url.pathname + url.search;
}

afterEach(() =>
{
	vi.unstubAllGlobals();
});

describe("fetchSchedule", () =>
{
	it("requests the versioned schedule route and returns the parsed body", async () =>
	{
		mockFetchOnce({
			date: "2024-07-04",
			games: [],
			fetchedAt: "x",
			windowMode: "cache",
		});
		const day = await fetchSchedule("2024-07-04");
		expect(day.date).toBe("2024-07-04");
		expect(requestedPath()).toBe("/api/v1/schedule?date=2024-07-04");
	});

	it("throws when the response is not ok", async () =>
	{
		mockFetchOnce({}, 500);
		await expect(fetchSchedule("2024-07-04")).rejects.toThrow("Request failed (500)");
	});
});

describe("fetchScheduleMonth (S124)", () =>
{
	it("requests the month route and returns each day's count", async () =>
	{
		mockFetchOnce({
			month: "2026-09",
			days: [
				{
					date: "2026-09-01",
					count: 15,
				},
				{
					date: "2026-09-02",
					count: null,
				},
			],
		});
		const month = await fetchScheduleMonth("2026-09");
		expect(month.days[1]?.count).toBeNull();
		expect(requestedPath()).toBe("/api/v1/schedule/month/2026-09");
	});
});

describe("fetchGame", () =>
{
	it("requests the versioned game route and returns the parsed body", async () =>
	{
		mockFetchOnce({
			gamePk: 744834,
			plays: [],
		});
		const game = await fetchGame(744834);
		expect(game.gamePk).toBe(744834);
		expect(requestedPath()).toBe("/api/v1/games/744834");
	});
});
