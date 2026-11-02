/**
 * S73: what the build's service worker and manifest are told (`PWA_OPTIONS`, read by
 * `vite.config.ts`). The grader also inspects a real build.
 */
import {
	describe, expect, it,
} from "vitest";
import { APP_BACKGROUND, PWA_OPTIONS } from "./options.js";

describe("the installed app's configuration (S73)", () =>
{
	it("scope: the worker and the manifest both sit at /, so Web Push can attach later without moving it", () =>
	{
		expect(PWA_OPTIONS.scope).toBe("/");
		expect(PWA_OPTIONS.manifest && PWA_OPTIONS.manifest.scope).toBe("/");
		expect(PWA_OPTIONS.registerType).toBe("prompt");
	});

	it("precache: the built shell (scripts, styles, the page, icons), never an /api/ answer", () =>
	{
		const workbox = PWA_OPTIONS.workbox!;
		expect(workbox.globPatterns).toEqual(["**/*.{js,css,html,svg,png,webmanifest}"]);
		for (const pattern of workbox.globPatterns ?? []) expect(pattern).not.toMatch(/api/);
		expect(workbox.navigateFallback).toBe("/index.html");
		expect(workbox.navigateFallbackDenylist!.some((deny) => deny.test("/api/v1/schedule"))).toBe(true);
		expect(workbox.navigateFallbackDenylist!.some((deny) => deny.test("/games/2026-09-05"))).toBe(false);
	});

	it("manifest: standalone, the flag mark at 192 and 512, on the app background", () =>
	{
		const manifest = PWA_OPTIONS.manifest;
		if (!manifest) throw new Error("no manifest");
		expect(manifest.display).toBe("standalone");
		expect(manifest.theme_color).toBe(APP_BACKGROUND);
		expect(APP_BACKGROUND).toBe("#10100F");
		expect(manifest.icons?.map((icon) => [icon.src, icon.sizes])).toEqual([["/icons/flag-192.png", "192x192"], ["/icons/flag-512.png", "512x512"]]);
	});
});
