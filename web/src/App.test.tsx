import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cleanup, render } from "@testing-library/react";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { App } from "./App.js";

const mantineStyles = readFileSync(createRequire(import.meta.url).resolve("@mantine/core/styles.css"), "utf8");

/** Every `<style>` Mantine injected into the document, joined. */
function injectedCss(): string
{
	return Array.from(document.querySelectorAll("style"))
		.map((el) => el.textContent ?? "")
		.join("\n");
}

describe("App theme (S39)", () =>
{
	beforeEach(() =>
	{
		// The routes fetch `/api/*`; keep them pending so only the shell renders.
		vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
	});

	afterEach(() =>
	{
		// Vitest globals are off, so Testing Library never unmounts on its own. Left mounted,
		// the whole app outlives the file, and a Mantine modal's scroll-lock timer fired after
		// jsdom was torn down ("window is not defined"), failing CI on `stage` (2026-11-06).
		// Unmounting runs Mantine's effect cleanup, which clears that timer.
		cleanup();
		vi.unstubAllGlobals();
	});

	it("locks the document to the dark color scheme", () =>
	{
		render(<App />);
		expect(document.documentElement.getAttribute("data-mantine-color-scheme")).toBe("dark");
	});

	it("resolves the page ground to Dark #10100F", () =>
	{
		render(<App />);
		// Mantine's stylesheet points the dark-scheme body at `dark-7`; the theme
		// sets `dark-7`. Together they put the page on Dark.
		expect(mantineStyles).toMatch(/--mantine-color-body:\s*var\(--mantine-color-dark-7\)/);
		expect(injectedCss()).toMatch(/--mantine-color-dark-7:\s*#10100F/i);
	});
});
