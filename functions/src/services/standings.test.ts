/**
 * The standings service (S128) on the committed recordings: `HttpMlbStatsClient` over
 * `fixtures/raw/` (`recordedClient`), so every table is MLB's own answer and every URL is the
 * one production asks. A test's own case (an empty table, a failed calendar) is an override.
 */
import { readFileSync } from "node:fs";
import {
	describe, expect, it,
} from "vitest";
import { recordedClient } from "../test/recorded-mlb.js";
import { getStandings } from "./standings.js";

const AL_EAST_FIRST = [201, 202, 200, 204, 205, 203];
/** MLB's recorded regular-season table for 2026-09-05, served for a day with no recording of its own. */
const SEPTEMBER_5: unknown = JSON.parse(readFileSync(new URL("../../../fixtures/raw/standings-2026-09-05.json", import.meta.url), "utf8"));

/** The fixed answers a test can give a URL. */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
	status,
});
const emptyTable = () => json({
	copyright: "",
	records: [],
});

function teams(divisions: { teams: unknown[] }[]): number
{
	return divisions.reduce((n, d) => n + d.teams.length, 0);
}

describe("getStandings (S128)", () =>
{
	it("after the regular season it is the final table, dated the season's regularSeasonEndDate", async () =>
	{
		const { mlb, asked } = recordedClient();
		const table = await getStandings({
			mlb,
		}, "2026-11-08");
		expect(table).toMatchObject({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
		expect(teams(table.divisions)).toBe(30);
		expect(table.divisions.map((d) => d.divisionId)).toEqual(AL_EAST_FIRST);
		const standings = new URL(asked.find((u) => u.includes("/api/v1/standings"))!);
		expect(standings.searchParams.get("season")).toBe("2026");
		expect(standings.searchParams.has("date")).toBe(false);
		expect(standings.searchParams.has("standingsTypes")).toBe(false);
	});

	it("in the spring it is the spring table as of the day, in the regular season's division order", async () =>
	{
		const { mlb, asked } = recordedClient();
		const table = await getStandings({
			mlb,
		}, "2026-03-01");
		expect(table).toMatchObject({
			phase: "spring",
			season: 2026,
			date: "2026-03-01",
		});
		expect(teams(table.divisions)).toBe(30);
		expect(table.divisions.map((d) => d.divisionId)).toEqual(AL_EAST_FIRST);
		const standings = new URL(asked.find((u) => u.includes("/api/v1/standings"))!);
		expect(standings.searchParams.get("standingsTypes")).toBe("springTraining");
		expect(standings.searchParams.get("season")).toBe("2026");
		expect(standings.searchParams.get("date")).toBe("2026-03-01");
	});

	it("in the regular season it is the regular-season table for the day (standingsUrl)", async () =>
	{
		const { mlb, asked } = recordedClient();
		const table = await getStandings({
			mlb,
		}, "2026-09-05");
		expect(table).toMatchObject({
			phase: "regularSeason",
			season: 2026,
			date: "2026-09-05",
		});
		expect(teams(table.divisions)).toBe(30);
		expect(asked).toContain("https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2026&date=2026-09-05&hydrate=team");
	});

	it("a past date is judged against its own year's and the year before's calendars (2019-11-01: 2019's final table)", async () =>
	{
		const calendar2019 = {
			copyright: "",
			seasons: [{
				seasonId: "2019",
				springStartDate: "2019-02-21",
				regularSeasonStartDate: "2019-03-20",
				regularSeasonEndDate: "2019-09-29",
				postSeasonEndDate: "2019-10-30",
			}],
		};
		const { mlb, asked } = recordedClient((url) => url.pathname === "/api/v1/seasons/2019" ? json(calendar2019) : undefined);
		const table = await getStandings({
			mlb,
		}, "2019-11-01");
		expect(table).toMatchObject({
			phase: "final",
			season: 2019,
			date: "2019-09-29",
		});
		expect(asked.some((u) => u.includes("/api/v1/seasons/2018"))).toBe(true);
		expect(asked.some((u) => u.includes("/api/v1/seasons/2019"))).toBe(true);
		expect(asked.some((u) => u.includes("season=2019&hydrate=team"))).toBe(true);
	});

	it("without a date it is MLB's today, not the UTC day (03:00 UTC on 09-28 is still the last regular-season day)", async () =>
	{
		// No 09-27 recording is committed, so that day is served 09-05's table (a full regular-season one).
		const { mlb, asked } = recordedClient((url) => url.searchParams.get("date") === "2026-09-27" ? json(SEPTEMBER_5) : undefined);
		const table = await getStandings({
			mlb,
			now: () => new Date("2026-09-28T03:00:00.000Z"),
		});
		expect(asked.some((u) => u.includes("season=2026&date=2026-09-27&hydrate=team"))).toBe(true);
		expect(asked.some((u) => u.includes("date=2026-09-28"))).toBe(false);
		expect(table).toMatchObject({
			phase: "regularSeason",
			season: 2026,
			date: "2026-09-27",
		});
		expect(teams(table.divisions)).toBe(30);
	});

	it("an empty mid-season or mid-spring table has no fallback: it is returned as it is, labelled with its own phase (AC 3)", async () =>
	{
		const midSeason = recordedClient((url) => url.searchParams.get("date") === "2026-07-01" ? emptyTable() : undefined);
		expect(await getStandings({
			mlb: midSeason.mlb,
		}, "2026-07-01")).toMatchObject({
			phase: "regularSeason",
			season: 2026,
			date: "2026-07-01",
			divisions: [],
		});
		expect(midSeason.asked.filter((u) => u.includes("/api/v1/standings"))).toHaveLength(1);

		const midSpring = recordedClient((url) => url.searchParams.get("date") === "2026-03-01" ? emptyTable() : undefined);
		expect(await getStandings({
			mlb: midSpring.mlb,
		}, "2026-03-01")).toMatchObject({
			phase: "spring",
			season: 2026,
			date: "2026-03-01",
			divisions: [],
		});
		expect(midSpring.asked.filter((u) => u.includes("/api/v1/standings"))).toHaveLength(1);
	});

	it("an empty spring table falls back to the previous season's final table (2027-02-19 morning)", async () =>
	{
		const { mlb } = recordedClient();
		const table = await getStandings({
			mlb,
		}, "2027-02-19");
		expect(table).toMatchObject({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
		expect(teams(table.divisions)).toBe(30);
	});

	it("an empty opening-day table falls back to spring's as of the last spring day", async () =>
	{
		const { mlb, asked } = recordedClient();
		const table = await getStandings({
			mlb,
		}, "2026-03-25");
		expect(table).toMatchObject({
			phase: "spring",
			season: 2026,
			date: "2026-03-24",
		});
		expect(teams(table.divisions)).toBe(30);
		expect(asked.some((u) => u.includes("standingsTypes=springTraining&date=2026-03-24"))).toBe(true);
	});

	it("an empty table with nothing before it is returned as it is", async () =>
	{
		const { mlb } = recordedClient((url) => url.pathname === "/api/v1/standings" ? emptyTable() : undefined);
		const table = await getStandings({
			mlb,
		}, "2026-11-08");
		expect(table).toMatchObject({
			phase: "final",
			season: 2026,
			divisions: [],
		});
	});

	it("request budget: two calendars (four requests) and one table, one more only for the fallback", async () =>
	{
		const final = recordedClient();
		await getStandings({
			mlb: final.mlb,
		}, "2026-11-08");
		expect(final.asked.filter((u) => !u.includes("/api/v1/standings"))).toHaveLength(4);
		expect(final.asked).toHaveLength(5);

		const fallback = recordedClient();
		await getStandings({
			mlb: fallback.mlb,
		}, "2027-02-19");
		expect(fallback.asked).toHaveLength(6);
	});

	it("with no calendar (the seasons request failed) it is the day's regular-season table", async () =>
	{
		const { mlb } = recordedClient((url) => url.pathname.startsWith("/api/v1/seasons/") ? json({}, 500) : undefined);
		const table = await getStandings({
			mlb,
		}, "2026-09-05");
		expect(table).toMatchObject({
			phase: "regularSeason",
			season: 2026,
			date: "2026-09-05",
		});
		expect(teams(table.divisions)).toBe(30);
	});

	it("an MLB error on the table is an error, not an empty table", async () =>
	{
		const { mlb } = recordedClient((url) => url.pathname === "/api/v1/standings" ? json({}, 500) : undefined);
		await expect(getStandings({
			mlb,
		}, "2026-11-08")).rejects.toThrow();
	});
});
