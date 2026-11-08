import type {
	GameGraphContent,
	GamePlayMetrics,
	GameRecap,
	GameSnapshot,
	MediaHighlight,
	PlayerProfile,
	ScheduleDay,
	SeasonCalendar,
	StandingsSnapshot,
	Unversioned,
} from "@bt/domain";
import type { GameDiffPatchResponse } from "@bt/mlb-api";

/**
 * Upstream MLB Stats API–shaped client. Implementations: live HTTP or fixtures.
 * Schedules and games come back unversioned: ingest stamps them against the
 * stored state (`stampVersion`, ADR-022).
 */
export interface MlbStatsClient {
	fetchSchedule(date: string): Promise<Unversioned<ScheduleDay>>;
	fetchGame(gamePk: number): Promise<Unversioned<GameSnapshot>>;
	/** Highlights + editorial for one game; the only payload with playback URLs. */
	fetchGameContent(gamePk: number): Promise<MediaHighlight[]>;
	/**
	 * MLB's per-at-bat win probability and key-moment flags (S93), from an internal mlb.com
	 * feed: null when it fails or has nothing, never a throw, so a game is served without it.
	 * Ingest calls it (ADR-002); `fetchGame` attaches it as `playMetrics`.
	 */
	fetchPlayMetrics(gamePk: number): Promise<GamePlayMetrics | null>;
	/**
	 * Each video's pitch link and the game's related articles, from MLB's GraphQL game content
	 * (S94; a persisted query MLB may retire): null when it fails or adds nothing, never a
	 * throw. Ingest calls it (ADR-002); `fetchGame` attaches `videoPlayRefs` / `relatedArticles`.
	 */
	fetchGameGraphContent(gamePk: number): Promise<GameGraphContent | null>;
	/** The regular season's standings as of `date` (S4); MLB has none outside the regular season. */
	fetchStandings(date: string): Promise<StandingsSnapshot>;
	/** A season's final regular-season table (S128): MLB's standings for the season with no date. */
	fetchFinalStandings(season: number): Promise<StandingsSnapshot>;
	/** A season's spring training standings as of `date` (S128); empty before its first spring game is final. */
	fetchSpringStandings(season: number, date: string): Promise<StandingsSnapshot>;
	/**
	 * One season's calendar — its first spring game and its last postseason game (S111) — or
	 * null when MLB has not published the season. Rejects when it can't be had (MLB unreachable
	 * or erroring), so a caller can tell unreachable from unpublished (S128 standings); callers
	 * that treat both alike catch the rejection as null.
	 */
	fetchSeasonCalendar(season: number): Promise<SeasonCalendar | null>;
	/** Identity + season lines for the given player ids, in the order returned. */
	fetchPlayers(ids: number[]): Promise<PlayerProfile[]>;
	/**
   * `GET /api/v1.1/game/{gamePk}/feed/live/timestamps` — every recorded
   * timecode for a game, oldest first. Used by the post-game replay walk (S22).
   */
	fetchGameTimestamps(gamePk: number): Promise<string[]>;
	/**
   * `GET /api/v1.1/game/{gamePk}/feed/live/diffPatch?startTimecode=&endTimecode=`
   * — the RFC6902 delta between two timecodes, in MLB's one-element wrapper.
   */
	fetchGameDiffPatch(
		gamePk: number,
		startTimecode: string,
		endTimecode: string,
	): Promise<GameDiffPatchResponse>;
}

/** A game's content-endpoint payload as BT keeps it: its videos and its editorial recap (S10). */
export type GameEditorial = {
	highlights: MediaHighlight[];
	recap?: GameRecap;
};

/**
 * A game's sources one at a time (S122), for the backfill: it must tell, per source, whether
 * it answered, and stop asking one it has given up, which `fetchGame`'s fan-out can't do.
 * `fetchGame` is the live feed with all three extras attached; these are its parts.
 */
export interface MlbGameSources extends Pick<MlbStatsClient, "fetchSchedule" | "fetchPlayMetrics" | "fetchGameGraphContent"> {
	/** The live feed alone, mapped, with no highlights or extras; throws when it can't be had. */
	fetchGameFeed(gamePk: number): Promise<Unversioned<GameSnapshot>>;
	/** The content endpoint's videos and recap; null when it fails or has neither, never a throw. */
	fetchGameEditorial(gamePk: number): Promise<GameEditorial | null>;
}
