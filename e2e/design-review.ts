#!/usr/bin/env node
// Lays out a story's design-match pairs for the owner (rule 22; owner, 2026-10-30): each
// capture in docs/v3/design-checks/<ID>/ beside the ratified frame of the same name, one
// PNG per frame, in the git-ignored .designreview/<ID>/. Delete the folder once the owner
// has given the verdict.
//
//   pnpm design:review S68          # build .designreview/S68/
//   pnpm design:review S68 --done   # delete it after the verdict
//
// A ratified amendment (docs/v3/visual/<surface>/amendments/<frame>.png) wins over the
// original frame of the same name, since it is what the build is matched against. A written
// amendment (its "## Frames" section says "None") that overrides a frame wins too, and since it
// has no picture its text goes on the reference side instead: an older frame it supersedes is
// never shown beside a capture (S73: the old under-the-header banner frames, shown beside
// captures after A6 moved the notice to the bottom, made a stale build look right). The
// pairs are drawn by Playwright's Chromium (already installed for `pnpm design:capture`),
// so no image library is needed.
import {
	existsSync, mkdirSync, readdirSync, readFileSync, rmSync,
} from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const [id, flag] = process.argv.slice(2);
if (!id || !/^[SV]\d+$/i.test(id))
{
	console.error("usage: pnpm design:review <story ID> [--done]");
	process.exit(2);
}
const story = id.toUpperCase();
const out = join(".designreview", story);

if (flag === "--done")
{
	rmSync(out, {
		recursive: true,
		force: true,
	});
	console.log(`removed ${out}`);
	process.exit(0);
}

const checks = join("docs/v3/design-checks", story);
if (!existsSync(checks))
{
	console.error(`${checks} does not exist; run pnpm design:capture ${story} first`);
	process.exit(1);
}

/** The ratified frame a capture is compared with: an amendment first, then the original. */
function ratifiedFrame(name: string): string | null
{
	const surfaces = readdirSync("docs/v3/visual", {
		withFileTypes: true,
	}).filter((d) => d.isDirectory()).map((d) => join("docs/v3/visual", d.name));
	for (const dir of [...surfaces.map((s) => join(s, "amendments")), ...surfaces])
	{
		const path = join(dir, name);
		if (existsSync(path)) return path;
	}
	return null;
}

/**
 * The ratified written amendment that governs a frame, if one does: the highest-numbered
 * amendment of any surface whose text names the frame, where that amendment is written (no
 * drawn frames) and names it on its **Overrides:** line. Names there are backticked: whole
 * (`shell-notice-mobile`), a suffix shorthand for the name before it (`-medium`), or a glob
 * (`settings-*`). A later amendment that draws the frame (`<name>.png` in its text) governs instead.
 */
function writtenAmendment(name: string): { path: string;
	text: string; } | null
{
	const frame = name.replace(/\.png$/, "");
	let best: { n: number;
		path: string;
		text: string;
		written: boolean; } | null = null;
	for (const surface of readdirSync("docs/v3/visual", {
		withFileTypes: true,
	}).filter((d) => d.isDirectory()))
	{
		const dir = join("docs/v3/visual", surface.name, "amendments");
		if (!existsSync(dir)) continue;
		for (const file of readdirSync(dir).filter((f) => /^A\d+\.md$/.test(f)))
		{
			const path = join(dir, file);
			const text = readFileSync(path, "utf8");
			const n = Number(file.slice(1, -3));
			const written = /^## Frames\s+None\b/m.test(text);
			const overrides = written ? overriddenNames(text) : [];
			const covers = text.includes(`${frame}.png`) || overrides.some((o) => (o.endsWith("*") ? frame.startsWith(o.slice(0, -1)) : o === frame));
			if (covers && (!best || n > best.n)) best = {
				n,
				path,
				text,
				written,
			};
		}
	}
	return best?.written ? {
		path: best.path,
		text: best.text,
	} : null;
}

/** The frame names on an amendment's **Overrides:** line, with `-medium`-style shorthands expanded. */
function overriddenNames(text: string): string[]
{
	const line = /^\*\*Overrides:\*\*(.*)$/m.exec(text)?.[1] ?? "";
	const names: string[] = [];
	for (const [, token] of line.matchAll(/`([a-z0-9*-]+)`/g))
	{
		const previous = names.at(-1);
		names.push(token!.startsWith("-") && previous ? previous.replace(/-[a-z0-9]+$/, token!) : token!);
	}
	return names;
}

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const dataUrl = (path: string): string => `data:image/png;base64,${readFileSync(path).toString("base64")}`;
const panel = (label: string, path: string | null): string => (path
	? `<figure><figcaption>${label}<small>${path}</small></figcaption><img src="${dataUrl(path)}"></figure>`
	: `<figure><figcaption>${label}<small>no ratified frame with this name</small></figcaption></figure>`);

rmSync(out, {
	recursive: true,
	force: true,
});
mkdirSync(out, {
	recursive: true,
});
const browser = await chromium.launch();
const page = await browser.newPage();
const captures = readdirSync(checks).filter((f) => f.endsWith(".png")).sort();
for (const name of captures)
{
	const amendment = writtenAmendment(name);
	const frame = amendment ? null : ratifiedFrame(name);
	const reference = amendment
		? `<figure class="written"><figcaption>Ratified written amendment (no frame; it supersedes any older frame named ${name})<small>${amendment.path}</small></figcaption><pre>${escapeHtml(amendment.text)}</pre></figure>`
		: panel("Ratified frame", frame);
	await page.setContent(`<!doctype html><style>
		body { margin: 0; background: #282828; color: #fff2d3; font: 20px Helvetica, Arial, sans-serif; }
		main { display: inline-flex; gap: 24px; padding: 16px 24px 24px; align-items: flex-start; }
		figure { margin: 0; }
		figcaption { margin-bottom: 12px; }
		small { display: block; font-size: 12px; opacity: 0.7; }
		img { display: block; }
		.written pre { width: 560px; margin: 0; white-space: pre-wrap; font: 14px/1.45 Helvetica, Arial, sans-serif; }
	</style><main>${reference}${panel(`${story} build`, join(checks, name))}</main>`);
	await page.locator("main").screenshot({
		path: join(out, name),
	});
	console.log(`${join(out, name)}${amendment ? `  (written amendment ${amendment.path})` : frame ? "" : "  (no ratified frame found)"}`);
}
await browser.close();
