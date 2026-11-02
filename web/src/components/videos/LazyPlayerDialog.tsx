import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import type { PlayerDialog as Dialog } from "./PlayerDialog.js";

/**
 * The dialog loads when a clip is first chosen, so it stays out of the entry bundle
 * (200,000-byte budget, `pnpm size`); nothing shows until a clip is chosen anyway.
 */
const PlayerDialog = lazy(() => import("./PlayerDialog.js").then((m) => ({
	default: m.PlayerDialog,
})));

/**
 * `PlayerDialog`, loaded on demand: the one way a page opens the modal player (S71; ADR-025).
 * `PlayerHost` (the Videos room), the day digest and Search (S5) all use it, so there is a
 * single lazy import of the dialog. Same props as `PlayerDialog`.
 */
export function LazyPlayerDialog(props: ComponentProps<typeof Dialog>)
{
	return (
		<Suspense fallback={null}>
			<PlayerDialog {...props} />
		</Suspense>
	);
}
