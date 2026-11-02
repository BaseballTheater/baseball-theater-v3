/**
 * MLB's play-metrics feed (`bdfed.stitch.mlbinfra.com/bdfed/playMetrics/{gamePk}`; S93):
 * what each at-bat meant — win probability before and after, and MLB's own flags for key
 * moments, lead changes, scoring, home runs, hard hits, strikeouts, high leverage and ABS
 * challenges. It is an internal feed behind mlb.com, not the documented Stats API, so it
 * may change without notice; BT treats it as optional.
 *
 * Split by purpose: the response's index lists (at-bat numbers per category), one at-bat's
 * metrics, and the play events inside an at-bat. Probabilities are percentages (0–100).
 */

/** A count before a pitch or an at-bat. */
export interface PlayMetricsCount {
	balls?: number;
	strikes?: number;
	outs?: number;
}

/** Statcast contact for a ball in play; each figure is null when nothing was measured. */
export interface PlayMetricsHitData {
	launchSpeed?: number | null;
	launchAngle?: number | null;
	totalDistance?: number | null;
}

/** A runner on a base, by MLB person id. */
export interface PlayMetricsRunner {
	id?: number;
}

/** Runners on base when a play happened. */
export interface PlayMetricsOffense {
	first?: PlayMetricsRunner;
	second?: PlayMetricsRunner;
	third?: PlayMetricsRunner;
}

/** One play inside an at-bat (a pitch, an advisory, a pickoff …). */
export interface PlayMetricsEvent {
	playIndex?: number;
	details?: {
		eventType?: string;
		awayScore?: number;
		homeScore?: number;
		isScoringPlay?: boolean;
	};
	preCount?: PlayMetricsCount;
	hitData?: PlayMetricsHitData;
	offense?: PlayMetricsOffense;
	/** A review on this play (e.g. `reviewType` for an ABS challenge). */
	reviewDetails?: {
		reviewType?: string;
	};
}

/** One at-bat's metrics, keyed by the live feed's `atBatIndex`. */
export interface AtBatPlayMetrics {
	atBatIndex: number;
	/** "top 1", "bottom 9" … */
	when?: string;
	halfInning?: string;
	preCount?: PlayMetricsCount;
	playEvents?: PlayMetricsEvent[];
	homeTeamWinProbability?: number;
	awayTeamWinProbability?: number;
	homeTeamWinProbabilityAdded?: number;
	awayTeamWinProbabilityAdded?: number;
	isTieOrLeadChangePlay?: boolean;
	atBatIsTieOrLeadChange?: boolean;
	hasTieOrLeadChangePlay?: boolean;
	isScoringPlay?: boolean;
	isScoringAtBat?: boolean;
	isHomeRun?: boolean;
	isHardHit?: boolean;
	isStrikeout?: boolean;
	isHighLeverage?: boolean;
	hasLargeWinProbChange?: boolean;
	isKeyMoment?: boolean;
	atBatHasLargeWinProbChange?: boolean;
	atBatIsKeyMoment?: boolean;
	hasPlayWithLargeWinProbChange?: boolean;
	hasPlayWithLargeKMWinProbChange?: boolean;
	playsKMWpaThreshold?: number | null;
	playsWpaThreshold?: number | null;
	/** Play indices within the at-bat that scored; null when none. */
	scoringPlayEvents?: number[] | null;
	/** Play indices within the at-bat that tied the game or changed the lead; null when none. */
	leadChangePlayEvents?: number[] | null;
	isAbsChallenge?: boolean;
	hitData?: PlayMetricsHitData;
}

/** The whole response: at-bat numbers per category, then every at-bat's metrics. */
export interface PlayMetricsResponse {
	scoringPlays?: number[];
	homeRuns?: number[];
	hardHits?: number[];
	strikeouts?: number[];
	leadChange?: number[];
	winProb?: number[];
	keyMoments?: number[];
	absChallenge?: number[];
	allPlayMetrics?: AtBatPlayMetrics[];
}
