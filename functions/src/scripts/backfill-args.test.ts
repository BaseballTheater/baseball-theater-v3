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
});
