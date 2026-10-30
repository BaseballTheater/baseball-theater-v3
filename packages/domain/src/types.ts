export type GameStatusCode =
  | "S" // scheduled
  | "P" // pregame
  | "I" // in progress / live
  | "F" // final
  | "O" // game over
  | "C" // cancelled
  | "D" // delayed
  | "U"; // unknown

export type AbstractTeam = {
	id: number;
	abbreviation: string;
	name: string;
	teamName: string;
};

export type LinescoreSummary = {
	currentInning: number | null;
	inningState: string | null;
	isTopInning: boolean | null;
	outs: number | null;
	balls: number | null;
	strikes: number | null;
	teams: {
		home: { runs: number | null;
			hits: number | null;
			errors: number | null };
		away: { runs: number | null;
			hits: number | null;
			errors: number | null };
	};
	/** Innings the game is scheduled for (9 unless shortened); absent on older recordings (S2). */
	scheduledInnings?: number | null;
	/** One entry per inning played or under way, in order (S2). Absent on older recordings. */
	innings?: LinescoreInning[];
};

/**
 * One inning of the linescore (S2). A side that hasn't batted in it yet — the home
 * half of an unfinished inning, or a bottom 9th never played — has `runs: null`.
 */
export type LinescoreInning = {
	num: number;
	away: { runs: number | null };
	home: { runs: number | null };
};

/** One batter's line in the box score (S2; the ratified Box frames' columns). */
export type BoxscoreBatter = {
	id: number;
	fullName: string;
	/** Fielding position abbreviation as MLB gives it (`CF`, `DH`, `P`). */
	position: string;
	/** MLB's batting-order code: `100`–`900` for starters, `101`… for whoever replaced them. */
	battingOrder: string;
	atBats: number;
	runs: number;
	hits: number;
	rbi: number;
	baseOnBalls: number;
	strikeOuts: number;
	/** Season batting average after this game, as MLB formats it (`.279`). */
	avg: string | null;
};

/** One `label: value` line of MLB's boxscore notes (Venue, Weather, Att…). */
export type BoxscoreInfoLine = {
	label: string;
	value: string;
};

/**
 * The live moment of a game in progress (S63; the game-rooms Live frames' diamond and
 * pitcher / batter cards): the player id on each base (`null` when empty), the
 * batter and the pitcher. MLB's `linescore.offense` and `currentPlay.matchup`.
 */
export type GameLive = {
	runners: {
		first: number | null;
		second: number | null;
		third: number | null;
	};
	batterId: number | null;
	pitcherId: number | null;
};

/**
 * MLB's editorial recap as plain text (S10): the headline and the article's
 * paragraphs, separated by blank lines. Markup, embedded players and links are
 * stripped at ingest, so views never render outside HTML.
 */
export type GameRecap = {
	headline: string;
	text: string;
};

/** The box score (S2): each team's batters in batting order, and MLB's game info lines. */
export type GameBoxscore = {
	teams: {
		away: { batting: BoxscoreBatter[] };
		home: { batting: BoxscoreBatter[] };
	};
	info: BoxscoreInfoLine[];
};

export type MediaHighlight = {
	id: string;
	playId: string | null;
	title: string;
	blurb: string | null;
	duration: string | null;
	imageUrl: string | null;
	playbackUrl: string | null;
};

import type { AtBat } from "./plays.js";

export type GameSnapshot = {
	gamePk: number;
	gameDate: string; // YYYY-MM-DD (schedule date)
	officialDate: string;
	status: {
		abstractGameState: string;
		codedGameState: GameStatusCode | string;
		detailedState: string;
	};
	teams: {
		home: AbstractTeam;
		away: AbstractTeam;
	};
	venue: { id: number;
		name: string } | null;
	linescore: LinescoreSummary | null;
	highlights: MediaHighlight[];
	plays: AtBat[];
	/** The box score (S2); absent until MLB has one, and on older recordings. */
	boxscore?: GameBoxscore;
	/** MLB's editorial recap (S10); absent until MLB publishes one. */
	recap?: GameRecap;
	/** Who is on base and who is batting and pitching (S63); `null` unless in progress, absent on older recordings. */
	live?: GameLive | null;
	fetchedAt: string; // ISO
	windowMode: "active" | "cache";
	/** ADR-022: monotonic per game; bumps only when the content changes (`stampVersion`). */
	version: number;
	/** ISO time the content last changed — not the last poll, which is `fetchedAt`. */
	lastChangedAt: string;
};

/** A team's season record (S65; the scoreboard module's `81-62`). */
export type TeamRecord = {
	wins: number;
	losses: number;
};

/** A team on the scoreboard (S65): the team, and its record when MLB sent one. */
export type ScheduleTeam = AbstractTeam & {
	record?: TeamRecord | null;
};

/** A player named on the scoreboard (pitchers of record). */
export type PlayerRef = {
	id: number;
	fullName: string;
};

/** A probable pitcher with his season line (S65; the module's "W-L, ERA"); nulls when MLB sent none. */
export type ProbablePitcher = PlayerRef & {
	wins: number | null;
	losses: number | null;
	era: string | null;
};

/** The pitchers of record of a finished game (S65; W / L / S). */
export type GameDecisions = {
	winner: PlayerRef | null;
	loser: PlayerRef | null;
	save: PlayerRef | null;
};

/**
 * The live moment on the scoreboard (S65): S63's runners and matchup, plus the count,
 * and who is batting and pitching by name for the count slot's "AB / P" lines (S67).
 */
export type ScheduleLive = GameLive & {
	batterName: string | null;
	pitcherName: string | null;
	balls: number | null;
	strikes: number | null;
	outs: number | null;
};

export type ScheduleGameSummary = {
	gamePk: number;
	gameDate: string;
	officialDate: string;
	/** First pitch as an ISO instant (S65); views show it in the viewer's zone (`formatGameTime`). */
	startTime?: string;
	status: GameSnapshot["status"];
	teams: {
		home: ScheduleTeam;
		away: ScheduleTeam;
	};
	venue: GameSnapshot["venue"];
	linescore: LinescoreSummary | null;
	/** Before the game: who is expected to start (S65). */
	probablePitchers?: {
		away: ProbablePitcher | null;
		home: ProbablePitcher | null;
	};
	/** After the game: the pitchers of record (S65); `null` until MLB names them. */
	decisions?: GameDecisions | null;
	/** During the game: runners, matchup and count (S65); `null` unless in progress. */
	live?: ScheduleLive | null;
};

export type ScheduleDay = {
	date: string; // YYYY-MM-DD
	games: ScheduleGameSummary[];
	fetchedAt: string;
	windowMode: "active" | "cache";
	/** ADR-022: monotonic per day; bumps only when the content changes (`stampVersion`). */
	version: number;
	/** ISO time the content last changed — not the last poll, which is `fetchedAt`. */
	lastChangedAt: string;
};

export type PatronTier =
  "none" | "Backer" | "Pro Backer" | "Star Backer" | "Premium Sponsor";

export type Entitlements = {
	tier: PatronTier;
	fasterLiveRefresh: boolean;
	cloudSyncedSettings: boolean;
	savantLinks: boolean;
};

/** What a user may administer. Lives in BT, not the identity provider (ADR-019: no provider RBAC). */
export type Role = "member" | "admin";

export type UserProfile = {
	/** BT's own user ID (ADR-019); provider accounts link to it, never the reverse. */
	uid: string;
	/** Every account has an email (owner, 2026-10-28: "It should be impossible for an account to have no email."; S82). */
	email: string;
	displayName: string | null;
	patreonUserId: string | null;
	role: Role;
	entitlements: Entitlements;
	createdAt: string;
	updatedAt: string;
};

/**
 * What BT's own signed session carries (ADR-019): enough to authorize an
 * ordinary request without reading Postgres or calling the identity provider.
 * Role and entitlements are a copy as of sign-in, so a change reaches the
 * session when it is next issued. Times are Unix seconds.
 */
export type BtSession = {
	uid: string;
	role: Role;
	entitlements: Entitlements;
	issuedAt: number;
	expiresAt: number;
};

/**
 * One team's row in a standings table.
 *
 * MLB reports games-back and the elimination figures as strings, using `"-"`
 * for "not applicable". The mapper normalizes that sentinel to `null` so the
 * UI never has to special-case a dash.
 */
export type StandingsTeamRecord = {
	teamId: number;
	name: string;
	abbreviation: string | null;
	wins: number;
	losses: number;
	pct: string | null;
	gamesBack: string | null;
	divisionRank: number | null;
	streak: string | null;
	runsScored: number | null;
	runsAllowed: number | null;
	runDifferential: number | null;
	divisionLeader: boolean;
	clinched: boolean;
	eliminationNumber: string | null;
};

export type StandingsDivision = {
	divisionId: number | null;
	name: string | null;
	leagueId: number | null;
	teams: StandingsTeamRecord[];
};

export type StandingsSnapshot = {
	date: string; // YYYY-MM-DD
	divisions: StandingsDivision[];
	fetchedAt: string;
	windowMode: "active" | "cache";
};

/** A player's season line for one stat group, as BT displays it. */
export type PlayerSeasonLine = {
	season: string;
	group: string; // "hitting" | "pitching" | "fielding"
	teamId: number | null;
	gamesPlayed: number | null;
	avg: string | null;
	obp: string | null;
	slg: string | null;
	ops: string | null;
	homeRuns: number | null;
	rbi: number | null;
	era: string | null;
	wins: number | null;
	losses: number | null;
	strikeOuts: number | null;
	inningsPitched: string | null;
};

/** Identity + season bag for one player. */
export type PlayerProfile = {
	playerId: number;
	fullName: string;
	boxscoreName: string | null;
	primaryNumber: string | null;
	position: string | null;
	batSide: string | null;
	pitchHand: string | null;
	birthDate: string | null;
	currentAge: number | null;
	active: boolean;
	seasons: PlayerSeasonLine[];
};

export type FreshnessMeta = {
	fetchedAt: string;
	windowMode: "active" | "cache";
	stale: boolean;
};
