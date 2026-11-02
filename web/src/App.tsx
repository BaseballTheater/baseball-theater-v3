import { MantineProvider, createTheme } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { createQueryClient } from "./api/queryClient.js";
import { useUpdateNotice } from "./pwa/updates.js";
import { useVersionNotice } from "./api/versionNotice.js";
import { AppShellLayout } from "./layout/AppShellLayout.js";
import { AppRoutes } from "./routes.js";
import { SessionProvider } from "./session/SessionProvider.js";
import { SettingsSync } from "./settings/SettingsSync.js";

/**
 * Five-token brand palette (VISUAL-DESIGN §3-4): Primary anchors Mantine's
 * `primaryColor`; Accent / Accent 2 are named theme colors so components say
 * `color="accent"` / `color="accent2"`, never a hex. Each 10-shade scale is
 * generated around the true brand hex at index 6 — lighter tints toward
 * white below it, darker shades toward black above it.
 *
 * No `headings.fontFamily` override: Mantine defaults headings to the theme's
 * `fontFamily`, so headings and body both land on IBM Plex Sans — Fraunces is
 * gone, not replaced with another heading-only font.
 *
 * The product is dark only (S39): `forceColorScheme="dark"`, and `colors.dark`
 * carries the ratified surfaces. Primary Light, muted text, and the pitch
 * roles are CSS custom properties in `styles.css`.
 */
const theme = createTheme({
	primaryColor: "primary",
	colors: {
		primary: [
			"#fbecec",
			"#f3c4c4",
			"#eb9c9c",
			"#e27373",
			"#da4b4b",
			"#d22323",
			"#ce0f0f",
			"#b40d0d",
			"#9b0b0b",
			"#810909",
		],
		accent: [
			"#fef8ed",
			"#fdebc7",
			"#fbdda1",
			"#f9cf7c",
			"#f8c256",
			"#f6b430",
			"#f5ad1d",
			"#d69719",
			"#b88216",
			"#996c12",
		],
		accent2: [
			"#f4fcf6",
			"#dcf6e4",
			"#c5efd1",
			"#ade9bf",
			"#95e3ad",
			"#7edc9a",
			"#72d991",
			"#64be7f",
			"#56a36d",
			"#47885b",
		],
		// Dark-only ground (S31 / VISUAL-DESIGN §3), warm-neutral steps Mantine reads
		// by index: 0 text (Light), 2 dimmed (Light 50% on Dark), 4 borders,
		// 5 Raised current, 6 Raised, 7 page body (Dark).
		dark: [
			"#fff2d3",
			"#c4bba5",
			"#878171",
			"#57524b",
			"#3a3633",
			"#272422",
			"#1c1a19",
			"#10100f",
			"#0b0b0a",
			"#060605",
		],
	},
	// Filled Primary controls (buttons, checked radios) are Primary #CE0F0F itself in the dark
	// scheme too, not Mantine's default darker shade 8 (S31 palette; matched in S79's captures).
	primaryShade: 6,
	fontFamily: "IBM Plex Sans, Segoe UI, sans-serif",
	defaultRadius: "md",
});

/** One client for the app's lifetime — recreating it on render would empty the cache. */
const queryClient = createQueryClient();

export function App()
{
	// One notice at a time: a retired API version (S28) or a waiting new version (S73), both
	// "reload to update"; the offline marker joins them in S74.
	const versionNotice = useVersionNotice();
	const updateNotice = useUpdateNotice();
	const notice = versionNotice ?? updateNotice;
	return (
		<MantineProvider theme={theme} forceColorScheme="dark">
			<QueryClientProvider client={queryClient}>
				<SessionProvider>
					<SettingsSync />
					<BrowserRouter>
						<AppShellLayout notice={notice}>
							{(variant) => <AppRoutes variant={variant} />}
						</AppShellLayout>
					</BrowserRouter>
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>
	);
}
