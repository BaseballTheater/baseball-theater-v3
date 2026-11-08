/**
 * `GET /api/v1/standings` payload shapes.
 *
 * The per-team row shares its win/loss spine with the `TeamRecord` block the
 * live feed hydrates onto a team, so it extends that rather than re-declaring
 * it. Everything added here is standings-only: ranks, streaks, games-back, and
 * the elimination/magic-number bookkeeping MLB computes per race.
 *
 * MLB reports every games-back and elimination figure as a **string**, using
 * `"-"` for "not applicable" rather than `0` or `null`. Mapping that sentinel
 * into a number belongs in the domain mapper, not here.
 */
import type {
	LeagueRecord, MlbLink, MlbRef, TeamRecord, MlbTeam,
} from "./common.js";

export interface StandingsResponse {
	copyright?: string;
	records?: StandingsRecordGroup[];
}

/**
 * One division's (or league's) table, as MLB groups them.
 *
 * The group's own refs are bare `{ id, link }` — MLB does not name the
 * division here. The readable name is on each row's `team.division`.
 */
export interface StandingsRecordGroup {
	standingsType?: string;
	league?: MlbLink;
	division?: MlbLink;
	sport?: MlbLink;
	roundRobin?: StandingsRoundRobin;
	lastUpdated?: string;
	teamRecords?: StandingsRecordEntry[];
}

/** Postseason round-robin flag; `status` comes back as the string `"false"`. */
export interface StandingsRoundRobin {
	status?: string;
}

/** One team's row in a standings table. */
export interface StandingsRecordEntry extends TeamRecord {
	team?: MlbTeam;
	season?: string;
	lastUpdated?: string;
	streak?: StandingsStreak;
	records?: StandingsRecordBreakdown;

	divisionRank?: string;
	leagueRank?: string;
	sportRank?: string;

	gamesBack?: string;
	wildCardGamesBack?: string;
	leagueGamesBack?: string;
	divisionGamesBack?: string;
	sportGamesBack?: string;
	conferenceGamesBack?: string;
	springLeagueGamesBack?: string;
	/** A team's rank in its spring league (Cactus / Grapefruit), on a spring training table (S128). */
	springLeagueRank?: string;

	runsScored?: number;
	runsAllowed?: number;
	runDifferential?: number;

	divisionChamp?: boolean;
	hasWildcard?: boolean;
	clinched?: boolean;
	/** How a team clinched, on a final table (S128): MLB's `w` wild card, `y` division, `z` best record in the league. */
	clinchIndicator?: string;
	wildCardRank?: string;
	wildCardLeader?: boolean;

	magicNumber?: string;
	eliminationNumber?: string;
	eliminationNumberSport?: string;
	eliminationNumberLeague?: string;
	eliminationNumberDivision?: string;
	eliminationNumberConference?: string;
	wildCardEliminationNumber?: string;
}

export interface StandingsStreak {
	streakType?: string;
	streakNumber?: number;
	streakCode?: string;
}

/**
 * The plain W-L-pct line MLB repeats inside every record breakdown — the same
 * `LeagueRecord` the schedule and live feeds carry, except standings can omit
 * any of it (a team with no interleague games has no such row).
 */
export type StandingsRecordLine = Partial<LeagueRecord>;

/**
 * `records` splits the same W-L line five ways. `splitRecords`,
 * `overallRecords` and `expectedRecords` label themselves with `type`
 * (`"home"`, `"xWinLoss"`, …); the division and league variants carry the ref
 * they describe instead.
 */
export interface StandingsRecordBreakdown {
	splitRecords?: StandingsTypedRecord[];
	overallRecords?: StandingsTypedRecord[];
	expectedRecords?: StandingsTypedRecord[];
	divisionRecords?: StandingsDivisionRecord[];
	leagueRecords?: StandingsLeagueRecord[];
}

export interface StandingsTypedRecord extends StandingsRecordLine {
	type?: string;
}

export interface StandingsDivisionRecord extends StandingsRecordLine {
	division?: MlbRef;
}

export interface StandingsLeagueRecord extends StandingsRecordLine {
	league?: MlbRef;
}
