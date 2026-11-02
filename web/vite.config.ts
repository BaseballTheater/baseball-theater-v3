import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { PWA_OPTIONS } from "./src/pwa/options.js";

/**
 * The commit this build is from: Actions names it, a local build asks git, and
 * a build outside a checkout says so. Short form only (S60 version line).
 */
function buildCommit(): string
{
	if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
	try
	{
		return execSync("git rev-parse --short=7 HEAD", {
			encoding: "utf8",
		}).trim();
	}
	catch
	{
		return "unknown";
	}
}

export default defineConfig({
	// The installed app (ADR-023, S73): manifest, icons and the service worker, from src/pwa/options.ts.
	plugins: [react(), VitePWA(PWA_OPTIONS)],
	// The rail's version line (S60, `src/layout/version.ts`): the Actions run
	// number counts up on every GitHub Actions build without touching
	// package.json (owner, 2026-10-21); any other build says "dev".
	define: {
		__BT_BUILD__: JSON.stringify(process.env.GITHUB_RUN_NUMBER ?? "dev"),
		__BT_COMMIT__: JSON.stringify(buildCommit()),
	},
	server: {
		port: 5173,
		// Bind all interfaces so the dev server is reachable from another device
		// on the LAN (phone, tablet) — Vite's default is loopback only.
		host: true,
		// Vite 403s any request whose Host header isn't allow-listed (DNS-rebinding
		// protection). `.local` permits mDNS hostnames like `jake-macbook-m5.local`
		// without disabling the check outright.
		allowedHosts: [".local"],
		proxy: {
			"/api": {
				target: "http://localhost:8787",
				changeOrigin: true,
			},
			"/health": {
				target: "http://localhost:8787",
				changeOrigin: true,
			},
		},
	},
});
