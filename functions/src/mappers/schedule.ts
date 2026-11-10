/**
 * Pure upstream → BT mappers for the schedule payload.
 *
 * No I/O here: adapters fetch, mappers translate. Keeping these pure is what
 * lets the recorded `fixtures/raw/` payloads stand in for the network in tests.
 */
import type {
	AbstractTeam,
	GameDecisions,
	GameStatusCode,
	LinescoreSummary,
	PlayerRef,
	ProbablePitcher,
	ScheduleDay,
	ScheduleGameSummary,
	ScheduleLive,
	TeamRecord,
	Unversioned,
} from "@bt/domain";
import { datesBetween, isLiveStatus } from "@bt/domain";
import type {
	Linescore,
	LiveDecisions,
	MlbTeam,
	Person,
	PitchingStatLine,
	GameStatus as UpstreamStatus,
	ScheduleGame,
	ScheduleResponse,
} from "@bt/mlb-api";

/** MLB's `codedGameState` is already the single letter the domain expects. */
export function toStatusCode(coded: string | undefined): GameStatusCode | string
{
	return coded ?? "U";
}

export function mapTeam(team: MlbTeam): AbstractTeam
{
	return {
		id: team.id,
		abbreviation: team.abbreviation ?? "",
		name: team.name,
		teamName: team.teamName ?? team.clubName ?? team.name,
	};
}

export function mapStatus(status: UpstreamStatus): ScheduleGameSummary["status"]
{
	return {
		abstractGameState: status.abstractGameState,
		codedGameState: toStatusCode(status.codedGameState),
		detailedState: status.detailedState,
	};
}

export function mapLinescore(linescore: Linescore | undefined): LinescoreSummary | null
{
	if (!linescore) return null;
	return {
		currentInning: linescore.currentInning ?? null,
		inningState: linescore.inningState ?? null,
		isTopInning: linescore.isTopInning ?? null,
		outs: linescore.outs ?? null,
		balls: linescore.balls ?? null,
		strikes: linescore.strikes ?? null,
		teams: {
			home: {
				runs: linescore.teams?.home?.runs ?? null,
				hits: linescore.teams?.home?.hits ?? null,
				errors: linescore.teams?.home?.errors ?? null,
			},
			away: {
				runs: linescore.teams?.away?.runs ?? null,
				hits: linescore.teams?.away?.hits ?? null,
				errors: linescore.teams?.away?.errors ?? null,
			},
		},
		scheduledInnings: linescore.scheduledInnings ?? null,
		// A half not batted yet (or a bottom 9th never played) has no `runs` upstream.
		innings: linescore.innings.map((inning) => ({
			num: inning.num,
			away: {
				runs: inning.away?.runs ?? null,
			},
			home: {
				runs: inning.home?.runs ?? null,
			},
		})),
	};
}

/** A season record, or `null` when MLB sent no wins / losses (S65). */
export function mapRecord(record: { wins?: number;
	losses?: number; } | undefined): TeamRecord | null
{
	if (record?.wins === undefined || record.losses === undefined) return null;
	return {
		wins: record.wins,
		losses: record.losses,
	};
}

function playerRef(person: Person | undefined): PlayerRef | null
{
	return person ? {
		id: person.id,
		fullName: person.fullName ?? "",
	} : null;
}

/** A probable pitcher and his season pitching line (S65), when MLB names one. */
export function mapProbable(person: Person | undefined, season: PitchingStatLine | undefined): ProbablePitcher | null
{
	const ref = playerRef(person);
	if (!ref) return null;
	return {
		...ref,
		wins: season?.wins ?? null,
		losses: season?.losses ?? null,
		era: season?.era ?? null,
	};
}

/** The probable's season line from the schedule's `stats` hydrate (`statsSingleSeason` · pitching). */
function seasonPitching(person: Person | undefined): PitchingStatLine | undefined
{
	return person?.stats?.find((s) => s.type?.displayName === "statsSingleSeason" && s.group?.displayName === "pitching")?.stats as PitchingStatLine | undefined;
}

/** Pitchers of record (S65), or `null` before MLB names any. */
export function mapDecisions(decisions: LiveDecisions | undefined): GameDecisions | null
{
	if (!decisions) return null;
	return {
		winner: playerRef(decisions.winner),
		loser: playerRef(decisions.loser),
		save: playerRef(decisions.save),
	};
}

/**
 * The scoreboard's live moment (S65): runners and the batter from the batting side,
 * the pitcher from the fielding side, and the count — only while the game is in
 * progress (`isLiveStatus`).
 */
export function mapScheduleLive(codedGameState: string, linescore: Linescore | undefined): ScheduleLive | null
{
	if (!isLiveStatus(codedGameState)) return null;
	return {
		runners: {
			first: linescore?.offense?.first?.id ?? null,
			second: linescore?.offense?.second?.id ?? null,
			third: linescore?.offense?.third?.id ?? null,
		},
		batterId: linescore?.offense?.batter?.id ?? null,
		pitcherId: linescore?.defense?.pitcher?.id ?? null,
		batterName: linescore?.offense?.batter?.fullName ?? null,
		pitcherName: linescore?.defense?.pitcher?.fullName ?? null,
		balls: linescore?.balls ?? null,
		strikes: linescore?.strikes ?? null,
		outs: linescore?.outs ?? null,
	};
}

export function mapScheduleGame(game: ScheduleGame): ScheduleGameSummary
{
	return {
		gamePk: game.gamePk,
		gameDate: game.officialDate ?? game.gameDate.slice(0, 10),
		officialDate: game.officialDate ?? game.gameDate.slice(0, 10),
		startTime: game.gameDate,
		status: mapStatus(game.status),
		teams: {
			home: {
				...mapTeam(game.teams.home.team),
				record: mapRecord(game.teams.home.leagueRecord),
			},
			away: {
				...mapTeam(game.teams.away.team),
				record: mapRecord(game.teams.away.leagueRecord),
			},
		},
		venue: game.venue ? {
			id: game.venue.id,
			name: game.venue.name,
		} : null,
		linescore: mapLinescore(game.linescore),
		probablePitchers: {
			away: mapProbable(game.teams.away.probablePitcher, seasonPitching(game.teams.away.probablePitcher)),
			home: mapProbable(game.teams.home.probablePitcher, seasonPitching(game.teams.home.probablePitcher)),
		},
		decisions: mapDecisions(game.decisions),
		live: mapScheduleLive(game.status.codedGameState ?? "", game.linescore),
	};
}

/** Picks the requested date out of the response; empty day when absent. */
export function mapScheduleResponse(
	response: ScheduleResponse,
	date: string,
	fetchedAt: string,
	windowMode: ScheduleDay["windowMode"] = "cache",
): Unversioned<ScheduleDay>
{
	const day = response.dates.find((entry) => entry.date === date) ?? response.dates[0];
	return {
		date: day?.date ?? date,
		games: (day?.games ?? []).map(mapScheduleGame),
		fetchedAt,
		windowMode,
	};
}

/**
 * Every day from `startDate` to `endDate` out of one range answer (S124), in order. MLB's `dates`
 * lists only days that have games, so a day it leaves out is a day with no games, never another
 * day's games: each day is matched by its exact date, unlike {@link mapScheduleResponse}'s
 * single-day fallback to `dates[0]`, which stays as it is for the one-day path.
 */
export function mapScheduleRange(
	response: ScheduleResponse,
	startDate: string,
	endDate: string,
	fetchedAt: string,
	windowMode: ScheduleDay["windowMode"] = "cache",
): Unversioned<ScheduleDay>[]
{
	const byDate = new Map(response.dates.map((entry) => [entry.date, entry]));
	return datesBetween(startDate, endDate).map((date) => ({
		date,
		games: (byDate.get(date)?.games ?? []).map(mapScheduleGame),
		fetchedAt,
		windowMode,
	}));
}
