import { useEffect, useState } from "react";
import type { Notice } from "../layout/NoticeSlot.js";
import { UPDATE_MESSAGE } from "../pwa/updates.js";

const UNSUPPORTED = "bt:version-unsupported";

/** Set once the API has said this app's version is retired; a reload is the only fix. */
let unsupported = false;

/**
 * Called by the API client's one middleware when an answer is 426 `version_unsupported`
 * (S28; ADR-015): the API version this app was built against is retired.
 */
export function markVersionUnsupported(): void
{
	if (unsupported) return;
	unsupported = true;
	window.dispatchEvent(new Event(UNSUPPORTED));
}

/**
 * The stale-client prompt (S28): once a request comes back 426, the shell's notice slot says
 * an update is ready, with Reload. It is the same notice as a waiting service worker's (S73;
 * ADR-023 makes the PWA's update notice where this lands), so S55's copy and one component.
 * Nothing is cleared: what the page already shows stays readable behind it (VISUAL-DESIGN D7).
 */
export function useVersionNotice(): Notice | null
{
	const [shown, setShown] = useState(unsupported);
	useEffect(() =>
	{
		const onUnsupported = () => setShown(true);
		window.addEventListener(UNSUPPORTED, onUnsupported);
		return () => window.removeEventListener(UNSUPPORTED, onUnsupported);
	}, []);
	if (!shown) return null;
	return {
		id: "version-unsupported",
		message: UPDATE_MESSAGE,
		action: {
			label: "Reload",
			onClick: () => window.location.reload(),
		},
		dismissible: true,
	};
}

/** Tests only: forget a retired version between cases. */
export function resetVersionNotice(): void
{
	unsupported = false;
}
