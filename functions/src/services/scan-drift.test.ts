import {
	mkdtemp, readFile, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import {
	formatDriftReport,
	parserFor,
	scanRawDir,
	type DriftReport,
} from "./scan-drift.js";

const committedRaw = fileURLToPath(new URL("../../../fixtures/raw/", import.meta.url));

async function tempRawDir(): Promise<string>
{
	return mkdtemp(path.join(tmpdir(), "bt-scan-drift-test-"));
}

describe("parserFor", () =>
{
	it("routes each raw fixture name to a parser and skips unknown ones", () =>
	{
		expect(parserFor("live-823823-base.json")).toBeTypeOf("function");
		expect(parserFor("live-823823.json")).toBeTypeOf("function");
		expect(parserFor("diffpatch-823823.json")).toBeTypeOf("function");
		expect(parserFor("schedule-2026-09-05.json")).toBeTypeOf("function");
		expect(parserFor("something-else.json")).toBeUndefined();
	});
});

describe("scanRawDir", () =>
{
	it("reports an injected unknown path in an otherwise-modeled fixture", async () =>
	{
		const dir = await tempRawDir();
		const people = JSON.parse(
			await readFile(path.join(committedRaw, "people-823823.json"), "utf8"),
		);
		people.__bt_probe__ = {
			madeUpField: 1,
		};
		await writeFile(path.join(dir, "people-823823.json"), JSON.stringify(people));

		const report = await scanRawDir(dir);

		expect(report.scanned).toEqual(["people-823823.json"]);
		const finding = report.findings.find((f) => f.fixture === "people-823823.json");
		expect(finding?.uncovered).toContain("__bt_probe__.madeUpField");
	});

	it("skips files no parser owns", async () =>
	{
		const dir = await tempRawDir();
		await writeFile(path.join(dir, "mystery-1.json"), JSON.stringify({
			a: 1,
		}));
		const report = await scanRawDir(dir);
		expect(report.scanned).toEqual([]);
		expect(report.skipped).toEqual(["mystery-1.json"]);
		expect(report.findings).toEqual([]);
	});

	it("finds no drift across the committed corpus", async () =>
	{
		const report = await scanRawDir(committedRaw);
		expect(report.scanned.length).toBeGreaterThanOrEqual(7);
		expect(report.findings).toEqual([]);
	});
});

describe("formatDriftReport", () =>
{
	it("summarizes a clean scan", () =>
	{
		const clean: DriftReport = {
			scanned: ["a.json"],
			skipped: [],
			findings: [],
		};
		expect(formatDriftReport(clean)).toContain("no drift");
		expect(formatDriftReport(clean)).toContain("  a.json");
	});

	it("lists each unmodeled path under its fixture", () =>
	{
		const drifted: DriftReport = {
			scanned: ["a.json"],
			skipped: ["b.json"],
			findings: [{
				fixture: "a.json",
				uncovered: ["x.y", "z"],
			}],
		};
		const text = formatDriftReport(drifted);
		expect(text).toContain("a.json");
		expect(text).toContain("    x.y");
		expect(text).toContain("triage");
	});
});
