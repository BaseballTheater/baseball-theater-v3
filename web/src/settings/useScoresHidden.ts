import { shouldHideScores } from "@bt/domain";
import { useSettings } from "./store.js";

/**
 * Whether scores are hidden, for `game` when there is one (S68). The one way views ask:
 * it reads the settings and defers to `shouldHideScores` in `packages/domain`, so the
 * rule can grow past an on/off switch without touching a view (owner, 2026-10-21).
 */
export function useScoresHidden(game?: { gamePk: number }): boolean
{
	return shouldHideScores(useSettings(), game);
}
