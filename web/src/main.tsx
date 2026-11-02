import "@mantine/core/styles.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { captureInstallPrompt } from "./pwa/install.js";
import { exposeDevUpdateTrigger, startUpdates } from "./pwa/updates.js";

// The installed app (ADR-023, S73): hold the browser's install offer from the start, and
// register the service worker. The register module (workbox-window) loads on its own, after
// the page, so it stays out of the entry bundle.
captureInstallPrompt();
if ("serviceWorker" in navigator) void import("virtual:pwa-register").then(({ registerSW }) => startUpdates(registerSW));
if (import.meta.env.DEV) exposeDevUpdateTrigger();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
