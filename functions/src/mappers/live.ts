/**
 * Pure upstream → BT mappers for the live feed (play-by-play + Statcast).
 *
 * Highlights are sourced from the content endpoint (`/game/{pk}/content`), not
 * the live feed hydrate — the live feed carries no playback URLs. See
 * `./content.ts`.
 */
import type {
	AtBat,
	AtBatChallenge,
	BoxscoreBatter,
	GameBoxscore,
	GameLive,
	GameSnapshot,
	PitchEvent,
	ScheduleGameSummary,
	Unversioned,
} from "@bt/domain";
import { isLiveStatus } from "@bt/domain";
import type {
	LiveBoxscore,
	LiveBoxscoreTeam,
	LiveFeedResponse,
	LiveGamePlay,
	LiveGamePlayEvent,
	PitchData as UpstreamPitchData,
} from "@bt/mlb-api";
import {
	mapDecisions, mapLinescore, mapProbable, mapRecord, mapStatus, mapTeam,
} from "./schedule.js";

function mapPitchData(pitch: UpstreamPitchData | undefined): PitchEvent["pitchData"]
{
	const coords = pitch?.coordinates;
	if (!pitch || !coords || coords.pX === undefined || coords.pZ === undefined)
	{
		return null;
	}
	return {
		startSpeed: pitch.startSpeed ?? 0,
		endSpeed: pitch.endSpeed ?? 0,
		strikeZoneTop: pitch.strikeZoneTop ?? 0,
		strikeZoneBottom: pitch.strikeZoneBottom ?? 0,
		zone: pitch.zone ?? null,
		plateTime: pitch.plateTime ?? null,
		extension: pitch.extension ?? null,
		coordinates: {
			pX: coords.pX,
			pZ: coords.pZ,
			x0: coords.x0 ?? 0,
			y0: coords.y0 ?? 0,
			z0: coords.z0 ?? 0,
			vx0: coords.vX0 ?? 0,
			vy0: coords.vY0 ?? 0,
			vz0: coords.vZ0 ?? 0,
			ax: coords.aX ?? 0,
			ay: coords.aY ?? 0,
			az: coords.aZ ?? 0,
			pfxX: coords.pfxX ?? 0,
			pfxZ: coords.pfxZ ?? 0,
		},
		breaks: pitch.breaks
			? {
				breakAngle: pitch.breaks.breakAngle ?? 0,
				breakLength: pitch.breaks.breakLength ?? 0,
				spinRate: pitch.breaks.spinRate ?? 0,
				breakHorizontal: pitch.breaks.breakHorizontal ?? null,
				breakVertical: pitch.breaks.breakVertical ?? null,
			}
			: null,
	};
}

export function mapPitchEvent(event: LiveGamePlayEvent): PitchEvent
{
	return {
		pitchNumber: event.pitchNumber ?? event.index,
		playId: event.playId ?? "",
		startTime: event.startTime ?? "",
		details: {
			call: event.details?.call?.code ?? null,
			callDescription: event.details?.call?.description ?? null,
			type: event.details?.type?.code ?? null,
			typeDescription: event.details?.type?.description ?? null,
			isBall: event.details?.isBall ?? false,
			isStrike: event.details?.isStrike ?? false,
			isInPlay: event.details?.isInPlay ?? false,
			ballColor: event.details?.ballColor ?? null,
		},
		count: {
			balls: event.count?.balls ?? 0,
			strikes: event.count?.strikes ?? 0,
			outs: event.count?.outs ?? 0,
		},
		pitchData: mapPitchData(event.pitchData),
		hitData: event.hitData
			? {
				launchSpeed: event.hitData.launchSpeed ?? 0,
				launchAngle: event.hitData.launchAngle ?? 0,
				totalDistance: event.hitData.totalDistance ?? 0,
				trajectory: event.hitData.trajectory ?? "",
				coordinates: {
					coordX: event.hitData.coordinates?.coordX ?? 0,
					coordY: event.hitData.coordinates?.coordY ?? 0,
				},
			}
			: null,
	};
}

/**
 * The at-bat's challenge (S95), from `reviewDetails` on the play itself or on one of its events
 * (823823: the play for at-bats 34, 69, 83; a pitch for 39 and 82). Only a review MLB credits to
 * a challenging team counts.
 */
function mapChallenge(play: LiveGamePlay): AtBatChallenge | undefined
{
	const onEvent = play.playEvents.find((event) => event.reviewDetails?.challengeTeamId !== undefined);
	const review = play.reviewDetails?.challengeTeamId !== undefined ? play.reviewDetails : onEvent?.reviewDetails;
	if (review?.challengeTeamId === undefined) return undefined;
	return {
		teamId: review.challengeTeamId,
		overturned: review.isOverturned ?? false,
		playId: review === onEvent?.reviewDetails && onEvent.isPitch && onEvent.playId ? onEvent.playId : null,
	};
}

export function mapAtBat(play: LiveGamePlay): AtBat
{
	const challenge = mapChallenge(play);
	return {
		about: {
			atBatIndex: play.about.atBatIndex,
			halfInning: play.about.isTopInning ? "top" : "bottom",
			inning: play.about.inning,
			isComplete: play.about.isComplete ?? false,
			isScoringPlay: play.about.isScoringPlay ?? false,
		},
		result: {
			event: play.result.event ?? "",
			description: play.result.description ?? "",
			eventType: play.result.eventType ?? "",
			isOut: play.result.isOut ?? false,
			rbi: play.result.rbi ?? 0,
			awayScore: play.result.awayScore ?? null,
			homeScore: play.result.homeScore ?? null,
		},
		matchup: {
			batter: {
				id: play.matchup?.batter?.id ?? 0,
				fullName: play.matchup?.batter?.fullName ?? "",
			},
			pitcher: {
				id: play.matchup?.pitcher?.id ?? 0,
				fullName: play.matchup?.pitcher?.fullName ?? "",
			},
			batSide: play.matchup?.batSide?.code ?? null,
			pitchHand: play.matchup?.pitchHand?.code ?? null,
		},
		count: {
			balls: play.count?.balls ?? 0,
			strikes: play.count?.strikes ?? 0,
			outs: play.count?.outs ?? 0,
		},
		pitches: play.playEvents.filter((event) => event.isPitch).map(mapPitchEvent),
		...challenge && {
			challenge,
		},
	};
}

/**
 * A team's batting lines in batting order (S2): everyone MLB lists with a batting-order
 * slot, starters and substitutes alike; pitchers who never batted have none and are left
 * out. MLB's `batters` array is already in order of appearance.
 */
export function mapBoxscoreBatting(team: LiveBoxscoreTeam | undefined): BoxscoreBatter[]
{
	return (team?.batters ?? []).flatMap((id) =>
	{
		const player = team?.players?.[`ID${id}`];
		if (!player?.battingOrder) return [];
		const line = player.stats?.batting;
		return [{
			id,
			fullName: player.person?.fullName ?? "",
			position: player.position?.abbreviation ?? "",
			battingOrder: player.battingOrder,
			atBats: line?.atBats ?? 0,
			runs: line?.runs ?? 0,
			hits: line?.hits ?? 0,
			rbi: line?.rbi ?? 0,
			baseOnBalls: line?.baseOnBalls ?? 0,
			strikeOuts: line?.strikeOuts ?? 0,
			avg: player.seasonStats?.batting?.avg ?? null,
		}];
	});
}

/**
 * The box score (S2), or `undefined` before MLB has one. `info` keeps MLB's own
 * label/value lines, minus the bare date line that has no value.
 */
export function mapBoxscore(boxscore: LiveBoxscore | undefined): GameBoxscore | undefined
{
	if (!boxscore?.teams) return undefined;
	return {
		teams: {
			away: {
				batting: mapBoxscoreBatting(boxscore.teams.away),
			},
			home: {
				batting: mapBoxscoreBatting(boxscore.teams.home),
			},
		},
		info: (boxscore.info ?? []).flatMap((line) => (line.label && line.value ? [{
			label: line.label,
			value: line.value,
		}] : [])),
	};
}

/**
 * The live moment (S63): runners from `linescore.offense`, batter and pitcher from
 * the current play's matchup — only while the game is in progress (`isLiveStatus`),
 * since a final or scheduled game has no one on base or at the plate.
 */
export function mapLive(feed: LiveFeedResponse): GameLive | null
{
	if (!isLiveStatus(feed.gameData.status.codedGameState ?? "")) return null;
	const offense = feed.liveData.linescore?.offense;
	const matchup = feed.liveData.plays.currentPlay?.matchup;
	return {
		runners: {
			first: offense?.first?.id ?? null,
			second: offense?.second?.id ?? null,
			third: offense?.third?.id ?? null,
		},
		batterId: matchup?.batter?.id ?? null,
		pitcherId: matchup?.pitcher?.id ?? null,
	};
}

/**
 * Maps the live feed onto a `GameSnapshot`. Highlights come from the content
 * endpoint, so callers merge those in separately (see `mapContentHighlights`).
 */
export function mapLiveFeed(
	feed: LiveFeedResponse,
	fetchedAt: string,
	windowMode: GameSnapshot["windowMode"] = "cache",
): Unversioned<GameSnapshot>
{
	const { gameData, liveData } = feed;
	const officialDate =
		gameData.datetime?.officialDate ?? gameData.datetime?.originalDate ?? "";
	return {
		gamePk: feed.gamePk,
		gameDate: officialDate,
		officialDate,
		status: mapStatus(gameData.status),
		teams: {
			home: mapTeam(gameData.teams.home),
			away: mapTeam(gameData.teams.away),
		},
		venue: {
			id: gameData.venue.id,
			name: gameData.venue.name,
		},
		linescore: mapLinescore(liveData.linescore),
		highlights: [],
		plays: liveData.plays.allPlays.map(mapAtBat),
		boxscore: mapBoxscore(liveData.boxscore),
		live: mapLive(feed),
		fetchedAt,
		windowMode,
	};
}

/**
 * A scoreboard summary from the live feed (S65) — how a game looks on the scoreboard
 * at any moment of its recorded replay, before, during or after it. Records and
 * probables come from `gameData`; each probable's season line from the boxscore;
 * the live moment is `mapLive` plus the count.
 */
export function mapLiveFeedSummary(feed: LiveFeedResponse): ScheduleGameSummary
{
	const { gameData, liveData } = feed;
	const snapshot = mapLiveFeed(feed, "");
	const live = mapLive(feed);
	const probable = (side: "away" | "home") =>
	{
		const person = gameData.probablePitchers?.[side];
		const season = person ? liveData.boxscore?.teams?.[side]?.players?.[`ID${person.id}`]?.seasonStats?.pitching : undefined;
		return mapProbable(person, season);
	};
	return {
		gamePk: snapshot.gamePk,
		gameDate: snapshot.gameDate,
		officialDate: snapshot.officialDate,
		startTime: gameData.datetime?.dateTime,
		status: snapshot.status,
		teams: {
			home: {
				...snapshot.teams.home,
				record: mapRecord(gameData.teams.home.record),
			},
			away: {
				...snapshot.teams.away,
				record: mapRecord(gameData.teams.away.record),
			},
		},
		venue: snapshot.venue,
		linescore: snapshot.linescore,
		probablePitchers: {
			away: probable("away"),
			home: probable("home"),
		},
		decisions: mapDecisions(liveData.decisions),
		live: live ? {
			...live,
			batterName: liveData.plays.currentPlay?.matchup?.batter?.fullName ?? null,
			pitcherName: liveData.plays.currentPlay?.matchup?.pitcher?.fullName ?? null,
			balls: liveData.linescore?.balls ?? null,
			strikes: liveData.linescore?.strikes ?? null,
			outs: liveData.linescore?.outs ?? null,
		} : null,
	};
}
