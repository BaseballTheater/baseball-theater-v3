/**
 * Storage ports (ADR-018): every durable read and write goes through one of
 * these, so the in-memory test doubles and the Postgres adapter (S50) are
 * interchangeable. All of them are held to one shared contract
 * (`functions/src/adapters/repository-contract.ts`, S46): values round-trip as
 * JSON, reads return copies, and an upsert whose `version` is not newer than
 * the stored one is a no-op (ADR-022 apply-if-newer).
 */
import type {
	AccountSettings, GameProjection, GameSnapshot, ScheduleDay, ScheduleDayTally,
} from "@bt/domain";
import type { ReplayPatchEntry } from "@bt/mlb-api";

export interface ScheduleRepository {
	getByDate(date: string): Promise<ScheduleDay | null>;
	upsert(day: ScheduleDay): Promise<void>;
	/**
	 * Every stored day from `from` to `to` (both included, `YYYY-MM-DD`) as its game count and
	 * stamps, in date order, in one read (S124's month view): days nothing stored are left out.
	 */
	listGameCounts(from: string, to: string): Promise<ScheduleDayTally[]>;
}

export interface GameRepository {
	getByPk(gamePk: number): Promise<GameSnapshot | null>;
	upsert(game: GameSnapshot): Promise<void>;
	listByDate(date: string): Promise<GameSnapshot[]>;
}

/** The five projected store documents per game; versioned by `header.version`. */
export interface GameProjectionRepository {
	upsert(projection: GameProjection): Promise<void>;
	getByPk(gamePk: number): Promise<GameProjection | null>;
}

/**
 * One game's replay: a pointer to the base feed timecode plus the ordered,
 * idle-collapsed patch sequence that walks it to the final state. The base feed
 * bytes are not stored here — the reconstructor is handed them separately.
 */
export interface ReplayArtifact {
	gamePk: number;
	/** The timecode the patch chain roots at (`timestamps[0]`). */
	baseTimecode: string;
	/** End timecode of each retained patch, in order. */
	timecodes: string[];
	/** Retained (non-empty-diff) patches, oldest first. */
	patches: ReplayPatchEntry[];
	/**
	 * ADR-022 version: the number of retained patches. A capture that walked
	 * further along the game is newer; re-capturing the same walk is a no-op.
	 */
	version: number;
}

export interface ReplayArtifactRepository {
	upsert(artifact: ReplayArtifact): Promise<void>;
	getByPk(gamePk: number): Promise<ReplayArtifact | null>;
}

/**
 * Each user's settings document (ADR-027), keyed by BT `uid`. Apply-if-newer
 * on `version` like every other store (ADR-022). Personal data (ADR-028's
 * `BT database: settings`): it also exports and deletes one user's document.
 */
export interface SettingsRepository {
	get(uid: string): Promise<AccountSettings | null>;
	upsert(uid: string, settings: AccountSettings): Promise<void>;
	/** The user's settings for their data download; null when they never saved any. */
	exportFor(uid: string): Promise<AccountSettings | null>;
	/** Removes the user's settings; a no-op when there are none. */
	deleteFor(uid: string): Promise<void>;
}
