/**
 * MLB Stats API capability drift scanner.
 *
 * S23 built the primitive — `leafPaths` / `uncoveredPaths` in `@bt/mlb-api`
 * compare a raw payload against what its zod parser kept, so a field the schema
 * silently drops is visible. `coverage.test.ts` runs that as a pass/fail gate
 * over the committed corpus.
 *
 * This is the *runnable* form: point it at a directory of raw `fixtures/raw/`
 * payloads (the committed set, or a freshly recorded game) and it reports every
 * unmodeled path per fixture, so a human can triage each into a typed field or
 * a backlog story. It never re-derives the leaf-path diff.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
	COVERAGE_IGNORE,
	parseGameContentResponse,
	parseGameDiffPatchResponse,
	parseGameTimestamps,
	parseLiveFeedResponse,
	parsePeopleResponse,
	parsePlayMetricsResponse,
	parseRecordedReplayWalk,
	parseScheduleResponse,
	parseSeasonsResponse,
	parseStandingsResponse,
	uncoveredPaths,
} from "@bt/mlb-api";

/** Unmodeled leaf paths found in one raw fixture. */
export interface DriftFinding {
	fixture: string;
	/** Paths present in the raw payload but dropped by its parser. */
	uncovered: string[];
}

export interface DriftReport {
	/** Fixture basenames that were scanned (had a known parser). */
	scanned: string[];
	/** Fixture basenames skipped because no parser owns their prefix. */
	skipped: string[];
	findings: DriftFinding[];
}

type Parser = (input: unknown) => unknown;

/**
 * Raw fixture basename → the parser that owns it. Order matters: the first
 * matching pattern wins, so `live-<pk>-base.json` is checked before `live-`.
 */
const PARSERS: ReadonlyArray<readonly [RegExp, Parser]> = [
	[/^schedule-.*\.json$/, parseScheduleResponse],
	// A season's World Series is a schedule response (S111).
	[/^worldseries-\d{4}\.json$/, parseScheduleResponse],
	[/^seasons-\d{4}\.json$/, parseSeasonsResponse],
	[/^live-\d+-base\.json$/, parseLiveFeedResponse],
	[/^live-\d+\.json$/, parseLiveFeedResponse],
	[/^content-.*\.json$/, parseGameContentResponse],
	[/^playmetrics-.*\.json$/, parsePlayMetricsResponse],
	[/^timestamps-.*\.json$/, parseGameTimestamps],
	[/^standings-.*\.json$/, parseStandingsResponse],
	[/^people-.*\.json$/, parsePeopleResponse],
	[/^diffpatch-.*\.json$/, parseRecordedReplayWalk],
	[/^diffpatch-response-.*\.json$/, parseGameDiffPatchResponse],
];

export function parserFor(fixture: string): Parser | undefined
{
	return PARSERS.find(([pattern]) => pattern.test(fixture))?.[1];
}

/**
 * Scan every `*.json` in `rawDir` that has a known parser. A fixture is a
 * finding when its parser drops any leaf path that is not on the S23 allowlist.
 */
export async function scanRawDir(rawDir: string): Promise<DriftReport>
{
	const names = (await readdir(rawDir)).filter((name) => name.endsWith(".json")).sort();
	const scanned: string[] = [];
	const skipped: string[] = [];
	const findings: DriftFinding[] = [];

	for (const name of names)
	{
		const parse = parserFor(name);
		if (!parse)
		{
			skipped.push(name);
			continue;
		}
		const raw: unknown = JSON.parse(await readFile(path.join(rawDir, name), "utf8"));
		scanned.push(name);
		const uncovered = uncoveredPaths(raw, parse(raw), COVERAGE_IGNORE);
		if (uncovered.length > 0) findings.push({
			fixture: name,
			uncovered,
		});
	}

	return {
		scanned,
		skipped,
		findings,
	};
}

/** Human-readable triage output: the count, then each fixture scanned by name, so a new recording visibly joins the scan. */
export function formatDriftReport(report: DriftReport): string
{
	const lines: string[] = [];
	lines.push(
		`scanned ${report.scanned.length} fixture(s), skipped ${report.skipped.length}`,
	);
	for (const name of report.scanned) lines.push(`  ${name}`);

	if (report.findings.length === 0)
	{
		lines.push("no drift — every recorded path is modeled or allow-listed.");
		return lines.join("\n");
	}

	lines.push("");
	lines.push(
		"NEW / UNMODELED PATHS — triage each into a typed field or a backlog story:",
	);
	for (const finding of report.findings)
	{
		lines.push(`  ${finding.fixture}`);
		for (const p of finding.uncovered) lines.push(`    ${p}`);
	}
	return lines.join("\n");
}
