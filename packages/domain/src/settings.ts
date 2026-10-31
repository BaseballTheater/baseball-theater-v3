import type { Room } from "./game-phase.js";
import { MLB_TEAMS } from "./teams.js";

/** The rooms a user may pick to open first (the ratified Settings frame's Opens First: Videos / Live / Box). */
export const OPENS_FIRST_ROOMS = ["videos", "live", "box"] as const satisfies readonly Room[];

export type OpensFirst = (typeof OPENS_FIRST_ROOMS)[number];

/**
 * What sits at the right of each scoreboard game (S67; the Settings frame's Game-Row
 * Slot). `status` is the drawn per-phase mix and the default; `roomMenu` links into
 * the game's rooms. Win Probability is left out at launch (owner, 2026-10-19).
 */
export const GAME_ROW_SLOTS = ["status", "roomMenu"] as const;

export type GameRowSlot = (typeof GAME_ROW_SLOTS)[number];

/**
 * Where a video plays (S70; the Settings frame's Video Player): `dialog` over the page,
 * the default (owner, 2026-10-13: "Configurable by the user, defaulting to the dialog
 * overlay"), or `stage`, fixed at the top of the game's Videos room.
 */
export const VIDEO_PLAYERS = ["dialog", "stage"] as const;

export type VideoPlayerMode = (typeof VIDEO_PLAYERS)[number];

/**
 * A user's settings, stored on their account (ADR-027) and synced to every
 * device. Versioned like every BT document (ADR-022): a write applies only if
 * its `version` is newer than the stored one, so a stale device can't undo a
 * newer change. Each control adds its field with its reader (collapse and Hide
 * Scores S68, Video Player S70).
 */
export type AccountSettings = {
	/** MLB team ids (`MLB_TEAMS`), in the order the user picked them. */
	favoriteTeamIds: number[];
	opensFirst: OpensFirst;
	gameRowSlot: GameRowSlot;
	/** Fold games without a favorite team into slim bars (S68). */
	collapseNonFavorites: boolean;
	/**
	 * Hide every score and record (S68). Read it through `shouldHideScores`, never
	 * directly (owner, 2026-10-21), so the setting can outgrow an on/off switch.
	 */
	hideScores: boolean;
	/** Where videos play (S70): a dialog over the page, or a stage in the Videos room. */
	videoPlayer: VideoPlayerMode;
	version: number;
};

/** The house defaults: what a signed-out visitor gets, and a new account until it saves. */
export const DEFAULT_SETTINGS: AccountSettings = {
	favoriteTeamIds: [],
	opensFirst: "videos",
	gameRowSlot: "status",
	collapseNonFavorites: false,
	hideScores: false,
	videoPlayer: "dialog",
	version: 0,
};

const TEAM_IDS = new Set(MLB_TEAMS.map((t) => t.id));

/**
 * `value` as settings when it is a well-formed document (every field present,
 * known team ids without repeats, an offered room, a whole non-negative
 * version), else null. A missing `gameRowSlot`, `collapseNonFavorites`, `hideScores` or
 * `videoPlayer` reads as the default: a page loaded before S67 / S68 / S70 saves documents without them,
 * and must not get a 400 for that. The server uses it on every write, so nothing malformed
 * is stored.
 */
export function parseAccountSettings(value: unknown): AccountSettings | null
{
	if (value === null || typeof value !== "object") return null;
	const {
		favoriteTeamIds, opensFirst, version,
		gameRowSlot = DEFAULT_SETTINGS.gameRowSlot,
		collapseNonFavorites = DEFAULT_SETTINGS.collapseNonFavorites,
		hideScores = DEFAULT_SETTINGS.hideScores,
		videoPlayer = DEFAULT_SETTINGS.videoPlayer,
	} = value as Record<string, unknown>;
	if (!Array.isArray(favoriteTeamIds) || !favoriteTeamIds.every((id) => typeof id === "number" && TEAM_IDS.has(id))) return null;
	if (new Set(favoriteTeamIds).size !== favoriteTeamIds.length) return null;
	if (!OPENS_FIRST_ROOMS.some((room) => room === opensFirst)) return null;
	if (!GAME_ROW_SLOTS.some((slot) => slot === gameRowSlot)) return null;
	if (typeof collapseNonFavorites !== "boolean" || typeof hideScores !== "boolean") return null;
	if (!VIDEO_PLAYERS.some((mode) => mode === videoPlayer)) return null;
	if (typeof version !== "number" || !Number.isInteger(version) || version < 0) return null;
	return {
		favoriteTeamIds: favoriteTeamIds as number[],
		opensFirst: opensFirst as OpensFirst,
		gameRowSlot: gameRowSlot as GameRowSlot,
		collapseNonFavorites,
		hideScores,
		videoPlayer: videoPlayer as VideoPlayerMode,
		version,
	};
}
