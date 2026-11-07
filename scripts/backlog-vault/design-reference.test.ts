/**
 * design-reference.ts — the one rule for which ratified reference governs a design capture,
 * shared by `pnpm design:review` and `scripts/audit.sh --design-match`.
 */
import {
	mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import { designReferences, overriddenNames } from "./design-reference.ts";

let root: string;

/** Writes `files` (path → text) under a throwaway visual dir. */
function visual(files: Record<string, string>): string
{
	for (const [path, text] of Object.entries(files))
	{
		mkdirSync(join(root, path, ".."), {
			recursive: true,
		});
		writeFileSync(join(root, path), text);
	}
	return root;
}

const written = (overrides: string) => `**Overrides:** ${overrides}: words.\n\n## Frames\n\nNone.\n`;

beforeEach(() =>
{
	root = mkdtempSync(join(tmpdir(), "design-reference-"));
});

afterEach(() =>
{
	rmSync(root, {
		recursive: true,
		force: true,
	});
});

describe("overriddenNames", () =>
{
	it("expands -medium shorthands against the name before them and keeps globs", () =>
	{
		expect(overriddenNames(written("`shell-notice-mobile` / `-medium` / `-desktop` and A1's `settings-*`")))
			.toEqual(["shell-notice-mobile", "shell-notice-medium", "shell-notice-desktop", "settings-*"]);
	});
});

describe("designReferences", () =>
{
	it("prefers an amendment frame over the original of the same name", () =>
	{
		const dir = visual({
			"s/a-mobile.png": "old",
			"s/amendments/a-mobile.png": "new",
		});
		expect(designReferences(dir, "a-mobile.png")).toEqual([{
			kind: "frame",
			path: join(dir, "s/amendments/a-mobile.png"),
		}]);
	});

	it("lets a written amendment that overrides the frame (by name, shorthand or glob) govern it", () =>
	{
		const dir = visual({
			"s/a-medium.png": "old",
			"s/amendments/a-medium.png": "redrawn",
			"s/amendments/A3.md": written("`a-mobile` / `-medium`"),
			"t/settings-x-mobile.png": "old",
			"t/amendments/A1.md": written("`settings-*`"),
		});
		expect(designReferences(dir, "a-medium.png")).toEqual([{
			kind: "amendment",
			path: join(dir, "s/amendments/A3.md"),
		}]);
		expect(designReferences(dir, "settings-x-mobile.png")[0]?.path).toBe(join(dir, "t/amendments/A1.md"));
	});

	it("lets a later amendment that draws the frame govern over an earlier written one", () =>
	{
		const dir = visual({
			"s/amendments/A1.md": written("`a-mobile`"),
			"s/amendments/A2.md": "## Frames\n\n- `a-mobile.png`\n",
			"s/amendments/a-mobile.png": "drawn",
		});
		expect(designReferences(dir, "a-mobile.png")).toEqual([{
			kind: "frame",
			path: join(dir, "s/amendments/a-mobile.png"),
		}]);
	});

	it("returns every original of an ambiguous name so the ledger can refuse it", () =>
	{
		const dir = visual({
			"s/live-mobile.png": "1",
			"t/live-mobile.png": "2",
		});
		expect(designReferences(dir, "live-mobile.png")).toHaveLength(2);
	});
});
