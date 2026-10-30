/**
 * Whether scores are hidden (S68; FEATURES "hide scores"). The one answer every view
 * asks — never the setting directly (owner, 2026-10-21: "establish the “should scores be
 * hidden” value through a function rather than directly through the setting. This makes
 * it easier to make the setting more complex than a Boolean toggle in the future").
 */
import type { AccountSettings } from "./settings.js";

/**
 * True when `game`'s scores (or, with no game, scores in general) should be hidden.
 * Today's setting is on/off, so the game is not consulted yet; it is part of the
 * signature so a per-team or per-game rule can arrive without touching any caller.
 */
export function shouldHideScores(settings: Pick<AccountSettings, "hideScores">, _game?: { gamePk: number }): boolean
{
	return settings.hideScores;
}
