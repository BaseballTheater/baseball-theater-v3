import {
	describe, expect, it,
} from "vitest";
import { OLD_GAP_MS, RECENT_GAP_MS } from "../services/polite-fetch.js";
import { parseBackfillArgs } from "./backfill-args.js";

describe("parseBackfillArgs (S122 AC 1, 6)", () =>
{
	it("defaults: --to is MLB's today, --from a year before, the pacer's own gaps, production refused", () =>
	{
		expect(parseBackfillArgs([], "2026-11-08")).toEqual({
			from: "2025-11-08",
			to: "2026-11-08",
			recentGapMs: RECENT_GAP_MS,
			oldGapMs: OLD_GAP_MS,
			allowProduction: false,
		});
	});

	it("--from before 1901-04-18 is clamped; --to alone moves --from with it", () =>
	{
		expect(parseBackfillArgs(["--from", "1876-04-22"], "2026-11-08").from).toBe("1901-04-18");
		expect(parseBackfillArgs(["--from", "0001-01-01"], "2026-11-08").from).toBe("1901-04-18");
		expect(parseBackfillArgs(["--to=2020-09-01"], "2026-11-08")).toMatchObject({
			from: "2019-09-01",
			to: "2020-09-01",
		});
	});

	it("reads the gap flags and --allow-production", () =>
	{
		expect(parseBackfillArgs(["--gap-ms", "2000", "--old-gap-ms=6000", "--allow-production"], "2026-11-08")).toMatchObject({
			recentGapMs: 2000,
			oldGapMs: 6000,
			allowProduction: true,
		});
	});

	it("refuses what it can't read", () =>
	{
		expect(() => parseBackfillArgs(["--from", "July"], "2026-11-08")).toThrow("YYYY-MM-DD");
		expect(() => parseBackfillArgs(["--gap-ms", "-1"], "2026-11-08")).toThrow("milliseconds");
		expect(() => parseBackfillArgs(["--to"], "2026-11-08")).toThrow("needs a value");
		expect(() => parseBackfillArgs(["--force"], "2026-11-08")).toThrow("unknown argument");
		expect(() => parseBackfillArgs(["--from", "2026-05-02", "--to", "2026-05-01"], "2026-11-08")).toThrow("after");
	});

	it("refuses a date the calendar doesn't have, and a --to after MLB's today", () =>
	{
		for (const date of ["2026-02-30", "2026-13-01", "2025-99-99"])
		{
			expect(() => parseBackfillArgs(["--from", date, "--to", "2026-07-01"], "2026-11-08"), date).toThrow("--from must be a real date");
			expect(() => parseBackfillArgs(["--to", date], "2026-11-08"), date).toThrow("--to must be a real date");
		}
		expect(() => parseBackfillArgs(["--to", "2026-11-09"], "2026-11-08")).toThrow("--to 2026-11-09 is after MLB's today, 2026-11-08");
		expect(parseBackfillArgs(["--to", "2026-11-08"], "2026-11-08").to).toBe("2026-11-08");
	});

	it("refuses a --to before 1901-04-18, the first day the backfill asks for", () =>
	{
		for (const date of ["0050-01-01", "0052-02-29", "0000-06-01", "1900-06-01"])
		{
			expect(() => parseBackfillArgs(["--to", date], "2026-11-08"), date).toThrow(`--to ${date} is before 1901-04-18, the first day the backfill asks for`);
		}
		expect(parseBackfillArgs(["--to", "1901-04-18"], "2026-11-08")).toMatchObject({
			from: "1901-04-18",
			to: "1901-04-18",
		});
	});
});
