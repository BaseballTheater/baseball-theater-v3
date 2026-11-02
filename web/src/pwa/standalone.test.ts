/**
 * S73: the installed app's insets (S55 shell-scoreboard A1) and the headers that keep the
 * files deciding which version runs from being cached at the edge (S47's Workers Cache).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("installed layout (S73)", () =>
{
	it("safe-area: in standalone mode the body pads to the top safe area and the home indicator, on the app background", () =>
	{
		const css = readFileSync(join(WEB, "src/styles.css"), "utf8");
		const block = css.match(/@media \(display-mode: standalone\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
		expect(block).toMatch(/padding-top:\s*env\(safe-area-inset-top\)/);
		expect(block).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom\)/);
		expect(block).toMatch(/background:\s*var\(--bt-dark\)/);
		const html = readFileSync(join(WEB, "index.html"), "utf8");
		expect(html).toMatch(/viewport-fit=cover/);
		expect(html).toMatch(/apple-mobile-web-app-status-bar-style" content="black-translucent"/);
	});

	it("headers: sw.js, the page and the manifest are always revalidated, never served from the edge cache", () =>
	{
		const headers = readFileSync(join(WEB, "public/_headers"), "utf8");
		for (const path of ["/sw.js", "/index.html", "/", "/manifest.webmanifest"])
		{
			const rule = headers.split(/\n(?=\/)/).find((block) => block.split("\n")[0] === path);
			expect(rule, path).toMatch(/Cache-Control: no-cache/);
		}
	});
});
