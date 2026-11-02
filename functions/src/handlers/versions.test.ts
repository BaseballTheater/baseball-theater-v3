/**
 * S28: the version lifecycle at the handler (ADR-015). Lifecycle is data, so each case hands
 * the handler its own table for v1 rather than publishing a real v2. Requests run in process
 * over the committed fixtures (`fixtureGet`): the 2026-09-05 schedule.
 */
import type { ApiVersionTable } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import type { ApiUsageRecord } from "../services/api-usage.js";
import { logApiUsage } from "../services/api-usage.js";
import { fixtureGet } from "./fixture-request.js";

const SCHEDULE = "/api/v1/schedule?date=2026-09-05";

const DEPRECATED: ApiVersionTable = {
	v1: {
		status: "deprecated",
		deprecatedOn: "2027-01-01",
		sunsetOn: "2027-04-01",
	},
};

const RETIRED: ApiVersionTable = {
	v1: {
		status: "sunset",
		sunsetOn: "2027-04-01",
	},
};

describe("API version lifecycle (S28)", () =>
{
	it("deprecated: 200 with Deprecation and Sunset headers, and the same body as a supported version", async () =>
	{
		const supported = await fixtureGet(SCHEDULE);
		const warned = await fixtureGet(SCHEDULE, {
			versions: DEPRECATED,
		});
		expect(warned.status).toBe(200);
		expect(warned.headers.get("Deprecation")).toBe("@1798761600");
		expect(warned.headers.get("Sunset")).toBe("Thu, 01 Apr 2027 00:00:00 GMT");
		expect(supported.headers.get("Deprecation")).toBeNull();
		// Each call stores the day afresh, so its fetch and change stamps differ; the day itself doesn't.
		const day = async (response: Response) =>
		{
			const { date, games } = await response.json() as { date: string;
				games: unknown[]; };
			return {
				date,
				games,
			};
		};
		expect(await day(warned)).toEqual(await day(supported));
	});

	it("sunset: 426 version_unsupported, with no payload data", async () =>
	{
		const response = await fixtureGet(SCHEDULE, {
			versions: RETIRED,
		});
		expect(response.status).toBe(426);
		const body = await response.json() as Record<string, unknown>;
		expect(body.error).toBe("version_unsupported");
		expect(Object.keys(body).sort()).toEqual(["error", "hint"]);
		expect(body).not.toHaveProperty("games");
	});

	it("usage: each versioned request is recorded with its version and route; two versions make two distinct records", async () =>
	{
		const records: ApiUsageRecord[] = [];
		const usage = (record: ApiUsageRecord) => records.push(record);
		await fixtureGet(SCHEDULE, {
			usage,
		});
		await fixtureGet("/api/v2/schedule?date=2026-09-05", {
			usage,
		});
		await fixtureGet("/health", {
			usage,
		});
		expect(records).toEqual([{
			version: "v1",
			route: "GET /api/v1/schedule",
		}, {
			version: "v2",
			route: "unmatched",
		}]);
	});

	it("usage: the log line holds the version and route only, as JSON", () =>
	{
		const lines: unknown[] = [];
		const original = console.info;
		console.info = (line: unknown) => lines.push(line);
		try
		{
			logApiUsage({
				version: "v1",
				route: "GET /api/v1/schedule",
			});
		}
		finally
		{
			console.info = original;
		}
		expect(lines.map((line) => JSON.parse(String(line)))).toEqual([{
			event: "api_usage",
			version: "v1",
			route: "GET /api/v1/schedule",
		}]);
	});

	it("an unknown version is not found, not retired", async () =>
	{
		expect((await fixtureGet("/api/v2/schedule?date=2026-09-05")).status).toBe(404);
	});
});
