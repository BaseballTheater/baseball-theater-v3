import type { VitePWAOptions } from "vite-plugin-pwa";

/** The app's own ground (S55: the installed status bar takes it; `#10100F`, VISUAL-DESIGN). */
export const APP_BACKGROUND = "#10100F";

/**
 * The installed app (ADR-023, S73): `vite-plugin-pwa`'s options, kept here so a test can read
 * what `vite.config.ts` builds. The manifest makes it standalone with the flag mark at 192
 * and 512 (`public/icons/`, rendered from `favicon.svg`). The worker registers at scope `/`,
 * so Web Push can attach later without moving it; it precaches the built shell (scripts,
 * styles, the page, icons), and navigations fall back to the page except under `/api/`,
 * whose answers are never precached: BT's data stays fresh and personal data never sits in
 * Cache Storage (ADR-028). It waits rather than taking over (`prompt`), so the app can say
 * an update is ready (S55) and the reader chooses when to reload.
 */
export const PWA_OPTIONS: Partial<VitePWAOptions> = {
	registerType: "prompt",
	injectRegister: false,
	scope: "/",
	manifest: {
		name: "Baseball Theater",
		short_name: "Baseball Theater",
		description: "Every game's videos, pitches, plays and box score.",
		display: "standalone",
		start_url: "/",
		scope: "/",
		theme_color: APP_BACKGROUND,
		background_color: APP_BACKGROUND,
		icons: [
			{
				src: "/icons/flag-192.png",
				sizes: "192x192",
				type: "image/png",
			},
			{
				src: "/icons/flag-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "any maskable",
			},
		],
	},
	workbox: {
		globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
		navigateFallback: "/index.html",
		navigateFallbackDenylist: [/^\/api\//],
	},
};
