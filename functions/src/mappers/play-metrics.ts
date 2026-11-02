/**
 * Pure upstream → BT mapper for MLB's play-metrics feed (S93). Each at-bat keeps the win
 * probability after it, how much it moved, MLB's at-bat-level flags and its Statcast
 * contact; the feed's play events and thresholds stay upstream. A response with no at-bats
 * maps to null, so the game is served without the field.
 */
import type { AtBatMetrics, GamePlayMetrics } from "@bt/domain";
import type { AtBatPlayMetrics, PlayMetricsResponse } from "@bt/mlb-api";

function mapAtBat(atBat: AtBatPlayMetrics): AtBatMetrics
{
	return {
		atBatIndex: atBat.atBatIndex,
		homeWinProbability: atBat.homeTeamWinProbability ?? null,
		awayWinProbability: atBat.awayTeamWinProbability ?? null,
		homeWinProbabilityAdded: atBat.homeTeamWinProbabilityAdded ?? null,
		awayWinProbabilityAdded: atBat.awayTeamWinProbabilityAdded ?? null,
		// The at-bat-level flags: the feed's play-level ones describe a single event within it.
		keyMoment: atBat.atBatIsKeyMoment ?? atBat.isKeyMoment ?? false,
		leadChange: atBat.atBatIsTieOrLeadChange ?? false,
		scoring: atBat.isScoringAtBat ?? false,
		homeRun: atBat.isHomeRun ?? false,
		hardHit: atBat.isHardHit ?? false,
		strikeout: atBat.isStrikeout ?? false,
		highLeverage: atBat.isHighLeverage ?? false,
		absChallenge: atBat.isAbsChallenge ?? false,
		hitData: {
			launchSpeed: atBat.hitData?.launchSpeed ?? null,
			launchAngle: atBat.hitData?.launchAngle ?? null,
			totalDistance: atBat.hitData?.totalDistance ?? null,
		},
	};
}

/** The game's play metrics in at-bat order, or null when the feed has no at-bats. */
export function mapPlayMetrics(response: PlayMetricsResponse): GamePlayMetrics | null
{
	const atBats = (response.allPlayMetrics ?? []).map(mapAtBat).sort((a, b) => a.atBatIndex - b.atBatIndex);
	return atBats.length === 0 ? null : {
		atBats,
	};
}
