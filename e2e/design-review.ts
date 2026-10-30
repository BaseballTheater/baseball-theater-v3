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
// original frame of the same name, since it is what the build is matched against. The
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
	const frame = ratifiedFrame(name);
	await page.setContent(`<!doctype html><style>
		body { margin: 0; background: #282828; color: #fff2d3; font: 20px Helvetica, Arial, sans-serif; }
		main { display: inline-flex; gap: 24px; padding: 16px 24px 24px; align-items: flex-start; }
		figure { margin: 0; }
		figcaption { margin-bottom: 12px; }
		small { display: block; font-size: 12px; opacity: 0.7; }
		img { display: block; }
	</style><main>${panel("Ratified frame", frame)}${panel(`${story} build`, join(checks, name))}</main>`);
	await page.locator("main").screenshot({
		path: join(out, name),
	});
	console.log(`${join(out, name)}${frame ? "" : "  (no ratified frame found)"}`);
}
await browser.close();
