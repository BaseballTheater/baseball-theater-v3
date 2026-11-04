/**
 * doc-index.ts: docs/v3/INDEX.md, the docs index agents start from (owner, 2026-11-04:
 * cascading linked docs "whenever it is mostly lossless contextually") — section line
 * ranges, the numbered backlog rules, and the stories by status.
 */
import {
	describe, expect, it,
} from "vitest";
import {
	isIndexedDoc, numberedRules, renderDocIndex, sections,
} from "./doc-index.ts";
import type { Story } from "./parse.ts";

const story = (id: string, status: string, priority: number, extra: Partial<Story> = {}): Story => ({
	id,
	title: `${id} title`,
	tableTitle: `${id} table title`,
	order: 1,
	section: "Stories",
	body: "",
	status,
	priority,
	dependsOn: [],
	preferAfter: [],
	design: [],
	source: null,
	turnCap: null,
	scopeFiles: [],
	...extra,
});

describe("sections", () =>
{
	it("gives each heading the lines up to the next heading at its level or above, skipping fenced code", () =>
	{
		const text = ["# Title", "intro", "## One", "a", "### One.a", "b", "```", "## not a heading", "```", "## Two", "c", ""].join("\n");
		expect(sections(text)).toEqual([
			{
				level: 2,
				title: "One",
				start: 3,
				end: 9,
			},
			{
				level: 3,
				title: "One.a",
				start: 5,
				end: 9,
			},
			{
				level: 2,
				title: "Two",
				start: 10,
				end: 11,
			},
		]);
	});
});

describe("numberedRules", () =>
{
	it("indexes the opening section's numbered list, as plain first sentences, and stops at its first sub-heading", () =>
	{
		const text = [
			"# Backlog",
			"1. **First rule.** More text.",
			"2. A [linked](#x) `code` rule that keeps going",
			"   onto an indented line.",
			"",
			"Unindented paragraph after the list.",
			"### Later",
			"1. **Not a rule.**",
		].join("\n");
		expect(numberedRules(text)).toEqual([
			{
				level: 0,
				title: "1. First rule.",
				start: 2,
				end: 2,
			},
			{
				level: 0,
				title: "2. A linked code rule that keeps going",
				start: 3,
				end: 4,
			},
		]);
	});

	it("shortens a long first sentence to 90 characters", () =>
	{
		expect(numberedRules(`1. ${"word ".repeat(40)}`)[0]!.title).toHaveLength(93);
	});
});

describe("renderDocIndex", () =>
{
	const big = (heading: string) => `# Big doc\n\n## ${heading}\n\n${"x".repeat(13_000)}\n`;

	it("lists every doc with its size, sections only for large ones, and the rules of the first frame note", () =>
	{
		const index = renderDocIndex({
			docs: [{
				path: "SMALL.md",
				text: "# Small doc\n\n## Hidden section\n",
			}, {
				path: "ARCHITECTURE.md",
				text: big("ADR-001 — Something"),
			}, {
				path: "BACKLOG.md",
				text: "not listed as a doc",
			}],
			frame: [{
				path: "backlog/frame/00 Rules.md",
				text: `# Rules\n1. **Rule one.**\n\n## Section\n${"y".repeat(13_000)}\n`,
			}],
			stories: [],
		});
		expect(index).toContain("- [SMALL.md — Small doc](SMALL.md) — 1 KB");
		expect(index).not.toContain("Hidden section");
		expect(index).toContain("- [ARCHITECTURE.md — Big doc](ARCHITECTURE.md) — 13 KB\n  - `3–5` ADR-001 — Something");
		expect(index).toContain("- [00 Rules](<backlog/frame/00 Rules.md>) — 13 KB");
		expect(index).toContain("    - `2–2` 1. Rule one.");
		expect(index).not.toContain("not listed as a doc");
	});

	it("tables the open stories (doing, todo, blocked; by priority) and lists the rest by status", () =>
	{
		const index = renderDocIndex({
			docs: [],
			frame: [],
			stories: [
				story("S3", "blocked", 1),
				story("S2", "todo", 5, {
					dependsOn: ["S1"],
					design: ["S9"],
				}),
				story("S4", "todo", 2),
				story("S1", "done", 3),
				story("S5", "doing", 9),
				story("S6", "superseded", 4),
			],
		});
		const rows = index.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Priority"));
		expect(rows.map((r) => /\[(S\d+)\]/.exec(r)?.[1])).toEqual(["S5", "S4", "S2", "S3"]);
		expect(index).toContain("| 5 | [S2](backlog/stories/S2.md) S2 table title | `todo` | S1 | S9 |");
		expect(index).toContain("**`done`** (1): [S1](backlog/stories/S1.md)");
		expect(index).toContain("**`superseded`** (1): [S6](backlog/stories/S6.md)");
	});
});

describe("isIndexedDoc", () =>
{
	it("takes Markdown directly in docs/v3/, not subfolders or the index itself", () =>
	{
		expect(["ARCHITECTURE.md", "INDEX.md", "visual/x/DESIGN.md", "audit.jsonl"].map(isIndexedDoc)).toEqual([true, false, false, false]);
	});
});
