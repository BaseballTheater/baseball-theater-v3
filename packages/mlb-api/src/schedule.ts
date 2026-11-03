/**
 * `GET /api/v1/schedule` — the scoreboard payload.
 *
 * Everything past the game header arrives through `hydrate`, so most of this
 * module is optional: the same endpoint returns a bare game or a game with a
 * linescore, decisions, broadcasts, and content attached.
 */
import type {
	GameStatus,
	HomeAwayPair,
	LeagueRecord,
	MlbRef,
	MlbTeam,
	Person,
	SpringLeague,
	Venue,
} from "./common.js";
import type { GameContentBody } from "./content.js";
import type { Linescore } from "./linescore.js";
import type {
	LiveDecisions,
	LiveGameFlags,
	LiveGamePlay,
	LiveGamePlayEvent,
	LiveGameReview,
	PlayAbout,
} from "./live.js";

export interface ScheduleResponse {
	copyright?: string;
	totalItems?: number;
	totalEvents?: number;
	totalGames?: number;
	totalGamesInProgress?: number;
	dates: ScheduleDate[];
}

export interface ScheduleDate {
	date: string;
	totalItems?: number;
	totalEvents?: number;
	totalGames?: number;
	totalGamesInProgress?: number;
	games: ScheduleGame[];
	events?: unknown[];
}

export interface ScheduleGame {
	gamePk: number;
	gameGuid?: string;
	link?: string;
	gameType?: string;
	season?: string;
	seasonDisplay?: string;
	gameDate: string;
	officialDate?: string;
	status: GameStatus;
	teams: ScheduleGameTeams;
	venue?: Venue;
	linescore?: Linescore;
	content?: ScheduleGameContent;
	decisions?: ScheduleDecisions;
	/** Every home run hit in the game, as trimmed play objects. */
	homeRuns?: ScheduleGamePlay[];
	previousPlay?: ScheduleGamePlay;
	isTie?: boolean;
	gameNumber?: number;
	doubleHeader?: string;
	gamedayType?: string;
	tiebreaker?: string;
	calendarEventID?: string;
	dayNight?: string;
	scheduledInnings?: number;
	inningBreakLength?: number;
	reverseHomeAwayStatus?: boolean;
	publicFacing?: boolean;
	recordSource?: string;
	ifNecessary?: string;
	ifNecessaryDescription?: string;
	seriesDescription?: string;
	/** A postseason game's own name, `"World Series Game 1"` (S111's World Series recordings). */
	description?: string;
	seriesGameNumber?: number;
	gamesInSeries?: number;
	seriesStatus?: SeriesStatus;
	broadcasts?: Broadcast[];
	flags?: LiveGameFlags;
	review?: LiveGameReview;
}

export type ScheduleGameTeams = Required<HomeAwayPair<ScheduleGameTeam>>;

/**
 * The schedule hydrate returns the same play the live feed does, minus the
 * at-bat bookkeeping and the pitch events — so it borrows the live shape
 * rather than declaring a second one.
 */
export interface ScheduleGamePlay extends Omit<LiveGamePlay, "about" | "playEvents"> {
	about?: ScheduleGamePlayAbout;
	playEvents?: LiveGamePlayEvent[];
}

export type ScheduleGamePlayAbout = Partial<PlayAbout>;

/** One side of a scheduled game: record, score, and the hydrated team. */
export interface ScheduleGameTeam {
	team: MlbTeam;
	score?: number;
	isWinner?: boolean;
	splitSquad?: boolean;
	seriesNumber?: number;
	springLeague?: SpringLeague;
	leagueRecord?: LeagueRecord;
	probablePitcher?: Person;
}

/**
 * Winning/losing/save pitchers. Same three slots the live feed carries; the
 * schedule just hydrates the people deeper.
 */
export type ScheduleDecisions = LiveDecisions;

export interface SeriesStatus {
	gameNumber?: number;
	totalGames?: number;
	wins?: number;
	losses?: number;
	isTied?: boolean;
	isOver?: boolean;
	abbreviation?: string;
	shortName?: string;
	shortDescription?: string;
	description?: string;
	result?: string;
	winningTeam?: MlbTeam;
	losingTeam?: MlbTeam;
}

export interface Broadcast extends MlbRef {
	type?: string;
	language?: string;
	homeAway?: string;
	isNational?: boolean;
	callSign?: string;
	mediaId?: string;
	gameDateBroadcastGuid?: string;
	broadcastDate?: string;
	availableForStreaming?: boolean;
	freeGame?: boolean;
	freeGameStatus?: boolean;
	mvpdAuthRequired?: boolean;
	preGameShow?: string;
	postGameShow?: boolean;
	tags?: string[];
	availability?: BroadcastAvailability;
	mediaState?: BroadcastMediaState;
	videoResolution?: BroadcastResolution;
	colorSpace?: BroadcastColorSpace;
}

export interface BroadcastAvailability {
	availabilityId?: number;
	availabilityCode?: string;
	availabilityText?: string;
}

export interface BroadcastMediaState {
	mediaStateId?: number;
	mediaStateCode?: string;
	mediaStateText?: string;
}

export interface BroadcastResolution {
	code?: string;
	resolutionShort?: string;
	resolutionFull?: string;
}

export interface BroadcastColorSpace {
	code?: string;
	colorSpaceFull?: string;
}

/**
 * The `game(content(...))` hydrate. The editorial and highlight branches come
 * back empty here — the content endpoint is what fills them — so this is the
 * same body that endpoint returns, not a second declaration of it.
 */
export type ScheduleGameContent = GameContentBody;
