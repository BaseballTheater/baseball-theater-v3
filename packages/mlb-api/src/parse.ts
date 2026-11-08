/**
 * Runtime validation for the upstream payloads.
 *
 * The schemas model the recorded payloads to near-total field coverage and let
 * MLB's extra keys through unvalidated — a required field going missing must
 * throw, but a new upstream field must not break the parse. `coverage.test.ts`
 * is the strict layer: it fails when a recorded path is neither modeled here
 * nor explained in `coverage-ignore.ts`.
 */
import { z } from "zod";
import type { GameContentResponse } from "./content.js";
import type { LiveFeedResponse } from "./live.js";
import type { PeopleResponse } from "./people.js";
import type { GraphContentResponse } from "./graphql-content.js";
import type { PlayMetricsResponse } from "./playmetrics.js";
import type { ScheduleResponse } from "./schedule.js";
import type { SeasonsResponse } from "./seasons.js";
import type { StandingsResponse } from "./standings.js";

/**
 * Branches MLB has only ever returned `null` or empty in every recorded
 * payload. Passing the value through beats guessing a shape from no samples.
 */
const unmodeled = z.unknown();

const mlbLinkSchema = z.object({
	id: z.number(),
	link: z.string().optional(),
});

const mlbRefSchema = mlbLinkSchema.extend({
	name: z.string(),
});

const springLeagueSchema = mlbRefSchema.extend({
	abbreviation: z.string().optional(),
});

const leagueRecordSchema = z.object({
	wins: z.number(),
	losses: z.number(),
	ties: z.number().optional(),
	pct: z.string(),
});

const teamRecordSchema = z.object({
	wins: z.number().optional(),
	losses: z.number().optional(),
	winningPercentage: z.string().optional(),
	gamesPlayed: z.number().optional(),
	divisionLeader: z.boolean().optional(),
	leagueRecord: leagueRecordSchema.optional(),
	conferenceGamesBack: z.string().optional(),
	divisionGamesBack: z.string().optional(),
	leagueGamesBack: z.string().optional(),
	sportGamesBack: z.string().optional(),
	springLeagueGamesBack: z.string().optional(),
	wildCardGamesBack: z.string().optional(),
	records: z.object({}).optional(),
});

const teamSchema = mlbRefSchema.extend({
	abbreviation: z.string().optional(),
	teamName: z.string().optional(),
	clubName: z.string().optional(),
	shortName: z.string().optional(),
	locationName: z.string().optional(),
	franchiseName: z.string().optional(),
	teamCode: z.string().optional(),
	fileCode: z.string().optional(),
	firstYearOfPlay: z.string().optional(),
	allStarStatus: z.string().optional(),
	active: z.boolean().optional(),
	league: mlbRefSchema.optional(),
	division: mlbRefSchema.optional(),
	sport: mlbRefSchema.optional(),
	springLeague: springLeagueSchema.optional(),
	venue: mlbRefSchema.optional(),
	springVenue: mlbLinkSchema.optional(),
	season: z.number().optional(),
	record: teamRecordSchema.optional(),
});

const statusSchema = z.object({
	abstractGameState: z.string(),
	detailedState: z.string(),
	codedGameState: z.string().optional(),
	statusCode: z.string().optional(),
	abstractGameCode: z.string().optional(),
	startTimeTBD: z.boolean().optional(),
});

const venueSchema = mlbRefSchema.extend({
	active: z.boolean().optional(),
	season: z.string().optional(),
	location: z
		.object({
			city: z.string().optional(),
			state: z.string().optional(),
			stateAbbrev: z.string().optional(),
			country: z.string().optional(),
			address1: z.string().optional(),
			postalCode: z.string().optional(),
			elevation: z.number().optional(),
			azimuthAngle: z.number().optional(),
			defaultCoordinates: z
				.object({
					latitude: z.number().optional(),
					longitude: z.number().optional(),
				})
				.optional(),
		})
		.optional(),
	timeZone: z
		.object({
			id: z.string().optional(),
			offset: z.number().optional(),
			offsetAtGameTime: z.number().optional(),
			tz: z.string().optional(),
		})
		.optional(),
	fieldInfo: z
		.object({
			capacity: z.number().optional(),
			turfType: z.string().optional(),
			roofType: z.string().optional(),
			leftLine: z.number().optional(),
			leftCenter: z.number().optional(),
			center: z.number().optional(),
			rightCenter: z.number().optional(),
			rightLine: z.number().optional(),
		})
		.optional(),
});

const positionSchema = z.object({
	code: z.string().optional(),
	name: z.string().optional(),
	type: z.string().optional(),
	abbreviation: z.string().optional(),
});

const codedDescriptionSchema = z.object({
	code: z.string(),
	description: z.string(),
});

// --- Stat lines ---------------------------------------------------------------

const statLineCoreSchema = z.object({
	age: z.number().optional(),
	airOuts: z.number().optional(),
	atBats: z.number().optional(),
	baseOnBalls: z.number().optional(),
	catchersInterference: z.number().optional(),
	caughtStealing: z.number().optional(),
	caughtStealingPercentage: z.string().optional(),
	doubles: z.number().optional(),
	flyOuts: z.number().optional(),
	gamesPlayed: z.number().optional(),
	groundIntoDoublePlay: z.number().optional(),
	groundIntoTriplePlay: z.number().optional(),
	groundOuts: z.number().optional(),
	groundOutsToAirouts: z.string().optional(),
	hitByPitch: z.number().optional(),
	hits: z.number().optional(),
	homeRuns: z.number().optional(),
	intentionalWalks: z.number().optional(),
	leftOnBase: z.number().optional(),
	lineOuts: z.number().optional(),
	pickoffs: z.number().optional(),
	plateAppearances: z.number().optional(),
	popOuts: z.number().optional(),
	rbi: z.number().optional(),
	runs: z.number().optional(),
	sacBunts: z.number().optional(),
	sacFlies: z.number().optional(),
	stolenBasePercentage: z.string().optional(),
	stolenBases: z.number().optional(),
	strikeOuts: z.number().optional(),
	totalBases: z.number().optional(),
	triples: z.number().optional(),
	note: z.string().optional(),
	summary: z.string().optional(),
});

const rateStatsSchema = z.object({
	avg: z.string().optional(),
	obp: z.string().optional(),
	slg: z.string().optional(),
	ops: z.string().optional(),
	babip: z.string().optional(),
	atBatsPerHomeRun: z.string().optional(),
});

const battingStatLineSchema = statLineCoreSchema.merge(rateStatsSchema);

const pitchingStatLineSchema = statLineCoreSchema.merge(rateStatsSchema).extend({
	balks: z.number().optional(),
	balls: z.number().optional(),
	battersFaced: z.number().optional(),
	blownSaves: z.number().optional(),
	completeGames: z.number().optional(),
	earnedRuns: z.number().optional(),
	era: z.string().optional(),
	gamesFinished: z.number().optional(),
	gamesPitched: z.number().optional(),
	gamesStarted: z.number().optional(),
	hitBatsmen: z.number().optional(),
	hitsPer9Inn: z.string().optional(),
	holds: z.number().optional(),
	homeRunsPer9: z.string().optional(),
	inheritedRunners: z.number().optional(),
	inheritedRunnersScored: z.number().optional(),
	inningsPitched: z.string().optional(),
	losses: z.number().optional(),
	numberOfPitches: z.number().optional(),
	outs: z.number().optional(),
	passedBall: z.number().optional(),
	pitchesPerInning: z.string().optional(),
	pitchesThrown: z.number().optional(),
	runsScoredPer9: z.string().optional(),
	saveOpportunities: z.number().optional(),
	saves: z.number().optional(),
	shutouts: z.number().optional(),
	strikePercentage: z.string().optional(),
	strikeoutWalkRatio: z.string().optional(),
	strikeoutsPer9Inn: z.string().optional(),
	strikes: z.number().optional(),
	walksPer9Inn: z.string().optional(),
	whip: z.string().optional(),
	wildPitches: z.number().optional(),
	winPercentage: z.string().optional(),
	wins: z.number().optional(),
});

const fieldingStatLineSchema = z.object({
	assists: z.number().optional(),
	caughtStealing: z.number().optional(),
	caughtStealingPercentage: z.string().optional(),
	chances: z.number().optional(),
	errors: z.number().optional(),
	fielding: z.string().optional(),
	gamesStarted: z.number().optional(),
	passedBall: z.number().optional(),
	pickoffs: z.number().optional(),
	putOuts: z.number().optional(),
	stolenBasePercentage: z.string().optional(),
	stolenBases: z.number().optional(),
});

const statGroupsSchema = z.object({
	batting: battingStatLineSchema.optional(),
	pitching: pitchingStatLineSchema.optional(),
	fielding: fieldingStatLineSchema.optional(),
});

const statDisplayNameSchema = z.object({
	displayName: z.string().optional(),
});

// A hydrated split does not say which group it is in its type, so one line has
// to admit all three.
const playerStatLineSchema = pitchingStatLineSchema.merge(fieldingStatLineSchema);

// The sport ref inside a split omits `name` and sends `abbreviation` instead.
const statSplitSportRefSchema = mlbLinkSchema.extend({
	name: z.string().optional(),
	abbreviation: z.string().optional(),
});

const personSeasonSplitSchema = z.object({
	season: z.string().optional(),
	gameType: z.string().optional(),
	numTeams: z.number().optional(),
	team: mlbRefSchema.optional(),
	league: mlbRefSchema.optional(),
	sport: statSplitSportRefSchema.optional(),
	player: z
		.object({
			id: z.number(),
			fullName: z.string().optional(),
			link: z.string().optional(),
		})
		.optional(),
	stat: playerStatLineSchema.optional(),
});

const personStatSplitSchema = z.object({
	group: statDisplayNameSchema.optional(),
	type: statDisplayNameSchema.optional(),
	exemptions: z.array(unmodeled).optional(),
	stats: playerStatLineSchema.optional(),
	splits: z.array(personSeasonSplitSchema).optional(),
});

const personSchema = z.object({
	id: z.number(),
	link: z.string().optional(),
	fullName: z.string().optional(),
	firstName: z.string().optional(),
	lastName: z.string().optional(),
	middleName: z.string().optional(),
	boxscoreName: z.string().optional(),
	primaryNumber: z.string().optional(),
	primaryPosition: positionSchema.optional(),
	birthDate: z.string().optional(),
	birthCity: z.string().optional(),
	birthStateProvince: z.string().optional(),
	birthCountry: z.string().optional(),
	currentAge: z.number().optional(),
	height: z.string().optional(),
	weight: z.number().optional(),
	active: z.boolean().optional(),
	gender: z.string().optional(),
	isPlayer: z.boolean().optional(),
	isVerified: z.boolean().optional(),
	draftYear: z.number().optional(),
	mlbDebutDate: z.string().optional(),
	pronunciation: z.string().optional(),
	nickName: z.string().optional(),
	nameSuffix: z.string().optional(),
	nameTitle: z.string().optional(),
	nameSlug: z.string().optional(),
	nameFirstLast: z.string().optional(),
	nameMatrilineal: z.string().optional(),
	useName: z.string().optional(),
	useLastName: z.string().optional(),
	initLastName: z.string().optional(),
	firstLastName: z.string().optional(),
	lastFirstName: z.string().optional(),
	lastInitName: z.string().optional(),
	fullFMLName: z.string().optional(),
	fullLFMName: z.string().optional(),
	batSide: codedDescriptionSchema.optional(),
	pitchHand: codedDescriptionSchema.optional(),
	strikeZoneTop: z.number().optional(),
	strikeZoneBottom: z.number().optional(),
	stats: z.array(personStatSplitSchema).optional(),
});

const hotColdZoneSchema = z.object({
	zone: z.string().optional(),
	color: z.string().optional(),
	temp: z.string().optional(),
	value: z.string().optional(),
});

const hotColdZoneStatsSchema = z.object({
	stats: z
		.array(
			z.object({
				group: statDisplayNameSchema.optional(),
				type: statDisplayNameSchema.optional(),
				exemptions: z.array(unmodeled).optional(),
				splits: z
					.array(
						z.object({
							stat: z
								.object({
									name: z.string().optional(),
									zones: z.array(hotColdZoneSchema).optional(),
								})
								.optional(),
						}),
					)
					.optional(),
			}),
		)
		.optional(),
});

// --- Linescore ----------------------------------------------------------------

const linescoreInningLineSchema = z.object({
	runs: z.number().optional(),
	hits: z.number().optional(),
	errors: z.number().optional(),
	leftOnBase: z.number().optional(),
});

const linescoreInningSchema = z.object({
	num: z.number(),
	ordinalNum: z.string(),
	home: linescoreInningLineSchema.optional(),
	away: linescoreInningLineSchema.optional(),
});

const lineupSchema = z.object({
	batter: personSchema.optional(),
	onDeck: personSchema.optional(),
	inHole: personSchema.optional(),
	pitcher: personSchema.optional(),
	battingOrder: z.number().optional(),
	team: teamSchema.optional(),
});

const linescoreSchema = z.object({
	innings: z.array(linescoreInningSchema),
	teams: z
		.object({
			home: linescoreInningLineSchema.optional(),
			away: linescoreInningLineSchema.optional(),
		})
		.optional(),
	offense: lineupSchema
		.extend({
			first: personSchema.optional(),
			second: personSchema.optional(),
			third: personSchema.optional(),
		})
		.optional(),
	defense: lineupSchema
		.extend({
			catcher: personSchema.optional(),
			first: personSchema.optional(),
			second: personSchema.optional(),
			third: personSchema.optional(),
			shortstop: personSchema.optional(),
			left: personSchema.optional(),
			center: personSchema.optional(),
			right: personSchema.optional(),
		})
		.optional(),
	currentInning: z.number().optional(),
	currentInningOrdinal: z.string().optional(),
	inningState: z.string().optional(),
	inningHalf: z.string().optional(),
	isTopInning: z.boolean().optional(),
	scheduledInnings: z.number().optional(),
	balls: z.number().optional(),
	strikes: z.number().optional(),
	outs: z.number().optional(),
});

// --- Plays --------------------------------------------------------------------

const countSchema = z.object({
	balls: z.number().optional(),
	strikes: z.number().optional(),
	outs: z.number().optional(),
});

const reviewDetailsSchema = z.object({
	isOverturned: z.boolean().optional(),
	inProgress: z.boolean().optional(),
	reviewType: z.string().optional(),
	challengeTeamId: z.number().optional(),
	player: personSchema.optional(),
});

const playEventSchema = z.object({
	index: z.number(),
	isPitch: z.boolean(),
	isSubstitution: z.boolean().optional(),
	type: z.string().optional(),
	playId: z.string().optional(),
	pitchNumber: z.number().optional(),
	startTime: z.string().optional(),
	endTime: z.string().optional(),
	count: countSchema.optional(),
	player: personSchema.optional(),
	replacedPlayer: personSchema.optional(),
	position: positionSchema.optional(),
	battingOrder: z.string().optional(),
	reviewDetails: reviewDetailsSchema.optional(),
	details: z
		.object({
			call: codedDescriptionSchema.optional(),
			description: z.string().optional(),
			code: z.string().optional(),
			event: z.string().optional(),
			eventType: z.string().optional(),
			ballColor: z.string().optional(),
			trailColor: z.string().optional(),
			isInPlay: z.boolean().optional(),
			isStrike: z.boolean().optional(),
			isBall: z.boolean().optional(),
			isOut: z.boolean().optional(),
			isScoringPlay: z.boolean().optional(),
			hasReview: z.boolean().optional(),
			runnerGoing: z.boolean().optional(),
			fromCatcher: z.boolean().optional(),
			disengagementNum: z.number().optional(),
			awayScore: z.number().optional(),
			homeScore: z.number().optional(),
			violation: z
				.object({
					type: z.string().optional(),
					description: z.string().optional(),
					player: personSchema.optional(),
				})
				.optional(),
			type: z
				.object({
					code: z.string().optional(),
					description: z.string().optional(),
				})
				.optional(),
		})
		.optional(),
	pitchData: z
		.object({
			startSpeed: z.number().optional(),
			endSpeed: z.number().optional(),
			strikeZoneTop: z.number().optional(),
			strikeZoneBottom: z.number().optional(),
			strikeZoneWidth: z.number().optional(),
			strikeZoneDepth: z.number().optional(),
			zone: z.number().optional(),
			typeConfidence: z.number().optional(),
			plateTime: z.number().optional(),
			extension: z.number().optional(),
			coordinates: z
				.object({
					pX: z.number().optional(),
					pZ: z.number().optional(),
					x: z.number().optional(),
					y: z.number().optional(),
					x0: z.number().optional(),
					y0: z.number().optional(),
					z0: z.number().optional(),
					vX0: z.number().optional(),
					vY0: z.number().optional(),
					vZ0: z.number().optional(),
					aX: z.number().optional(),
					aY: z.number().optional(),
					aZ: z.number().optional(),
					pfxX: z.number().optional(),
					pfxZ: z.number().optional(),
				})
				.optional(),
			breaks: z
				.object({
					breakAngle: z.number().optional(),
					breakLength: z.number().optional(),
					breakY: z.number().optional(),
					breakVertical: z.number().optional(),
					breakVerticalInduced: z.number().optional(),
					breakHorizontal: z.number().optional(),
					spinRate: z.number().optional(),
					spinDirection: z.number().optional(),
				})
				.optional(),
		})
		.optional(),
	hitData: z
		.object({
			launchSpeed: z.number().optional(),
			launchAngle: z.number().optional(),
			totalDistance: z.number().optional(),
			trajectory: z.string().optional(),
			hardness: z.string().optional(),
			location: z.string().optional(),
			coordinates: z
				.object({
					coordX: z.number().optional(),
					coordY: z.number().optional(),
				})
				.optional(),
		})
		.optional(),
});

const playResultSchema = z.object({
	type: z.string().optional(),
	event: z.string().optional(),
	eventType: z.string().optional(),
	description: z.string().optional(),
	rbi: z.number().optional(),
	awayScore: z.number().optional(),
	homeScore: z.number().optional(),
	isOut: z.boolean().optional(),
});

const playAboutSchema = z.object({
	atBatIndex: z.number(),
	halfInning: z.string(),
	isTopInning: z.boolean(),
	inning: z.number(),
	isComplete: z.boolean().optional(),
	isScoringPlay: z.boolean().optional(),
	hasReview: z.boolean().optional(),
	hasOut: z.boolean().optional(),
	captivatingIndex: z.number().optional(),
	startTime: z.string().optional(),
	endTime: z.string().optional(),
});

const playSchema = z.object({
	result: playResultSchema,
	about: playAboutSchema,
	count: countSchema.optional(),
	matchup: z
		.object({
			batter: personSchema.optional(),
			pitcher: personSchema.optional(),
			batSide: codedDescriptionSchema.optional(),
			pitchHand: codedDescriptionSchema.optional(),
			postOnFirst: personSchema.optional(),
			postOnSecond: personSchema.optional(),
			postOnThird: personSchema.optional(),
			batterHotColdZones: z.array(hotColdZoneSchema).optional(),
			pitcherHotColdZones: z.array(hotColdZoneSchema).optional(),
			batterHotColdZoneStats: hotColdZoneStatsSchema.optional(),
			pitcherHotColdZoneStats: hotColdZoneStatsSchema.optional(),
			splits: z
				.object({
					batter: z.string().optional(),
					pitcher: z.string().optional(),
					menOnBase: z.string().optional(),
				})
				.optional(),
		})
		.optional(),
	runners: z
		.array(
			z.object({
				movement: z
					.object({
						originBase: z.string().nullable().optional(),
						start: z.string().nullable().optional(),
						end: z.string().nullable().optional(),
						outBase: z.string().nullable().optional(),
						isOut: z.boolean().nullable().optional(),
						outNumber: z.number().nullable().optional(),
					})
					.optional(),
				details: z
					.object({
						event: z.string().optional(),
						eventType: z.string().optional(),
						movementReason: z.string().nullable().optional(),
						runner: personSchema.optional(),
						responsiblePitcher: personSchema.nullable().optional(),
						isScoringEvent: z.boolean().optional(),
						rbi: z.boolean().optional(),
						earned: z.boolean().optional(),
						teamUnearned: z.boolean().optional(),
						playIndex: z.number().optional(),
					})
					.optional(),
				credits: z
					.array(
						z.object({
							player: personSchema.optional(),
							position: positionSchema.optional(),
							credit: z.string().optional(),
						}),
					)
					.optional(),
			}),
		)
		.optional(),
	reviewDetails: reviewDetailsSchema.optional(),
	playEvents: z.array(playEventSchema),
	atBatIndex: z.number().optional(),
	pitchIndex: z.array(z.number()).optional(),
	actionIndex: z.array(z.number()).optional(),
	runnerIndex: z.array(z.number()).optional(),
	playEndTime: z.string().optional(),
});

/**
 * The schedule hydrate trims plays: `homeRuns[]` and `previousPlay` arrive
 * without the at-bat bookkeeping and without pitch events.
 */
const scheduleTrimmedPlaySchema = playSchema.extend({
	about: playAboutSchema.partial().optional(),
	playEvents: z.array(playEventSchema).optional(),
});

// --- Content ------------------------------------------------------------------

const playbackSchema = z.object({
	name: z.string(),
	url: z.string(),
	width: z.string().optional(),
	height: z.string().optional(),
});

const keywordSchema = z.object({
	type: z.string().optional(),
	value: z.string().optional(),
	displayName: z.string().optional(),
});

const imageSchema = z.object({
	title: z.string().optional(),
	altText: z.string().nullable().optional(),
	templateUrl: z.string().optional(),
	cuts: z
		.array(
			z.object({
				aspectRatio: z.string().optional(),
				width: z.number().optional(),
				height: z.number().optional(),
				src: z.string().optional(),
				at2x: z.string().optional(),
				at3x: z.string().optional(),
			}),
		)
		.optional(),
});

const highlightItemSchema = z.object({
	id: z.string().optional(),
	guid: z.string().optional(),
	type: z.string().optional(),
	state: z.string().optional(),
	date: z.string().optional(),
	title: z.string(),
	headline: z.string().optional(),
	seoTitle: z.string().optional(),
	slug: z.string().optional(),
	blurb: z.string(),
	description: z.string().optional(),
	duration: z.string().optional(),
	kicker: z.string().optional(),
	mediaPlaybackId: z.string().optional(),
	mediaPlaybackUrl: z.string().optional(),
	cclocationVtt: z.string().optional(),
	image: imageSchema.optional(),
	keywordsAll: z.array(keywordSchema).optional(),
	keywordsDisplay: z.array(keywordSchema).optional(),
	noIndex: z.boolean().optional(),
	playbacks: z.array(playbackSchema),
});

const highlightListSchema = z.object({
	title: z.string().optional(),
	items: z.array(highlightItemSchema),
});

const editorialSlotSchema = z.object({
	mlb: z
		.object({
			type: z.string().optional(),
			state: z.string().optional(),
			date: z.string().optional(),
			headline: z.string().optional(),
			seoTitle: z.string().optional(),
			seoKeywords: z.string().optional(),
			slug: z.string().optional(),
			blurb: z.string().optional(),
			body: z.string().optional(),
			url: z.string().optional(),
			image: imageSchema.optional(),
			photo: imageSchema.optional(),
			contributors: z
				.array(z.object({
					name: z.string().optional(),
					twitter: z.string().optional(),
				}))
				.optional(),
			keywordsAll: z.array(keywordSchema).optional(),
			keywordsDisplay: z.array(keywordSchema).optional(),
			media: highlightItemSchema.optional(),
		})
		.optional(),
});

const editorialSchema = z.object({
	// Unused slots come back as `null` rather than being omitted.
	preview: editorialSlotSchema.nullable().optional(),
	recap: editorialSlotSchema.nullable().optional(),
	wrap: editorialSlotSchema.nullable().optional(),
	articles: unmodeled.optional(),
});

const highlightsWrapperSchema = z.object({
	highlights: highlightListSchema.nullable().optional(),
	gameCenter: highlightListSchema.nullable().optional(),
	scoreboard: highlightListSchema.nullable().optional(),
	scoreboardPreview: highlightListSchema.nullable().optional(),
	live: highlightListSchema.nullable().optional(),
	milestone: highlightListSchema.nullable().optional(),
});

const storyRefSchema = z.object({
	dapiURL: z.string().optional(),
	state: z.string().optional(),
	keywordsAll: z.array(keywordSchema).optional(),
	keywordsDisplay: z.array(keywordSchema).optional(),
});

const contentMediaSchema = z.object({
	epg: unmodeled.optional(),
	epgAlternate: z.array(highlightListSchema).optional(),
	featuredMedia: z.object({
		id: z.string().optional(),
	}).optional(),
	previewStory: z
		.object({
			mlb: storyRefSchema.optional(),
			items: z.array(storyRefSchema).optional(),
		})
		.optional(),
	milestones: unmodeled.optional(),
	freeGame: z.boolean().optional(),
	enhancedGame: z.boolean().optional(),
});

const contentSummarySchema = z.object({
	hasPreviewArticle: z.boolean().optional(),
	hasRecapArticle: z.boolean().optional(),
	hasWrapArticle: z.boolean().optional(),
	hasHighlightsVideo: z.boolean().optional(),
});

const gameContentResponseSchema = z.object({
	copyright: z.string().optional(),
	link: z.string().optional(),
	editorial: editorialSchema.optional(),
	highlights: highlightsWrapperSchema.optional(),
	media: contentMediaSchema.optional(),
	summary: contentSummarySchema.optional(),
	gameNotes: z.object({}).optional(),
});

// --- Schedule -----------------------------------------------------------------

const broadcastSchema = mlbRefSchema.extend({
	type: z.string().optional(),
	language: z.string().optional(),
	homeAway: z.string().optional(),
	isNational: z.boolean().optional(),
	callSign: z.string().optional(),
	mediaId: z.string().optional(),
	gameDateBroadcastGuid: z.string().optional(),
	broadcastDate: z.string().optional(),
	availableForStreaming: z.boolean().optional(),
	freeGame: z.boolean().optional(),
	freeGameStatus: z.boolean().optional(),
	mvpdAuthRequired: z.boolean().optional(),
	preGameShow: z.string().optional(),
	postGameShow: z.boolean().optional(),
	tags: z.array(z.string()).optional(),
	availability: z
		.object({
			availabilityId: z.number().optional(),
			availabilityCode: z.string().optional(),
			availabilityText: z.string().optional(),
		})
		.optional(),
	mediaState: z
		.object({
			mediaStateId: z.number().optional(),
			mediaStateCode: z.string().optional(),
			mediaStateText: z.string().optional(),
		})
		.optional(),
	videoResolution: z
		.object({
			code: z.string().optional(),
			resolutionShort: z.string().optional(),
			resolutionFull: z.string().optional(),
		})
		.optional(),
	colorSpace: z
		.object({
			code: z.string().optional(),
			colorSpaceFull: z.string().optional(),
		})
		.optional(),
});

const gameFlagsSchema = z.object({
	noHitter: z.boolean().optional(),
	perfectGame: z.boolean().optional(),
	awayTeamNoHitter: z.boolean().optional(),
	awayTeamPerfectGame: z.boolean().optional(),
	homeTeamNoHitter: z.boolean().optional(),
	homeTeamPerfectGame: z.boolean().optional(),
});

const usageCountSchema = z.object({
	remaining: z.number().optional(),
	used: z.number().optional(),
});

const gameReviewSchema = z.object({
	hasChallenges: z.boolean().optional(),
	away: usageCountSchema.optional(),
	home: usageCountSchema.optional(),
});

const decisionsSchema = z.object({
	winner: personSchema.optional(),
	loser: personSchema.optional(),
	save: personSchema.optional(),
});

const scheduleGameTeamSchema = z.object({
	team: teamSchema,
	score: z.number().optional(),
	isWinner: z.boolean().optional(),
	splitSquad: z.boolean().optional(),
	seriesNumber: z.number().optional(),
	springLeague: springLeagueSchema.optional(),
	leagueRecord: leagueRecordSchema.optional(),
	probablePitcher: personSchema.optional(),
});

const scheduleGameSchema = z.object({
	gamePk: z.number(),
	gameGuid: z.string().optional(),
	link: z.string().optional(),
	gameType: z.string().optional(),
	season: z.string().optional(),
	seasonDisplay: z.string().optional(),
	gameDate: z.string(),
	officialDate: z.string().optional(),
	status: statusSchema,
	teams: z.object({
		away: scheduleGameTeamSchema,
		home: scheduleGameTeamSchema,
	}),
	venue: venueSchema.optional(),
	linescore: linescoreSchema.optional(),
	decisions: decisionsSchema.optional(),
	homeRuns: z.array(scheduleTrimmedPlaySchema).optional(),
	previousPlay: scheduleTrimmedPlaySchema.optional(),
	content: z
		.object({
			link: z.string().optional(),
			editorial: editorialSchema.optional(),
			highlights: highlightsWrapperSchema.optional(),
			media: contentMediaSchema.optional(),
			summary: contentSummarySchema.optional(),
			gameNotes: z.object({}).optional(),
		})
		.optional(),
	isTie: z.boolean().optional(),
	gameNumber: z.number().optional(),
	doubleHeader: z.string().optional(),
	gamedayType: z.string().optional(),
	tiebreaker: z.string().optional(),
	calendarEventID: z.string().optional(),
	dayNight: z.string().optional(),
	scheduledInnings: z.number().optional(),
	inningBreakLength: z.number().optional(),
	reverseHomeAwayStatus: z.boolean().optional(),
	publicFacing: z.boolean().optional(),
	recordSource: z.string().optional(),
	ifNecessary: z.string().optional(),
	ifNecessaryDescription: z.string().optional(),
	seriesDescription: z.string().optional(),
	description: z.string().optional(),
	seriesGameNumber: z.number().optional(),
	gamesInSeries: z.number().optional(),
	seriesStatus: z
		.object({
			gameNumber: z.number().optional(),
			totalGames: z.number().optional(),
			wins: z.number().optional(),
			losses: z.number().optional(),
			isTied: z.boolean().optional(),
			isOver: z.boolean().optional(),
			abbreviation: z.string().optional(),
			shortName: z.string().optional(),
			shortDescription: z.string().optional(),
			description: z.string().optional(),
			result: z.string().optional(),
			winningTeam: teamSchema.optional(),
			losingTeam: teamSchema.optional(),
		})
		.optional(),
	broadcasts: z.array(broadcastSchema).optional(),
	flags: gameFlagsSchema.optional(),
	review: gameReviewSchema.optional(),
});

const scheduleResponseSchema = z.object({
	copyright: z.string().optional(),
	totalItems: z.number().optional(),
	totalEvents: z.number().optional(),
	totalGames: z.number().optional(),
	totalGamesInProgress: z.number().optional(),
	dates: z.array(
		z.object({
			date: z.string(),
			totalItems: z.number().optional(),
			totalEvents: z.number().optional(),
			totalGames: z.number().optional(),
			totalGamesInProgress: z.number().optional(),
			games: z.array(scheduleGameSchema),
			events: z.array(unmodeled).optional(),
		}),
	),
});

// --- Live feed ----------------------------------------------------------------

const boxscoreInfoLabelSchema = z.object({
	label: z.string().optional(),
	value: z.string().optional(),
});

const boxscorePlayerSchema = z.object({
	person: personSchema.optional(),
	jerseyNumber: z.string().optional(),
	position: positionSchema.optional(),
	allPositions: z.array(positionSchema).optional(),
	status: codedDescriptionSchema.optional(),
	parentTeamId: z.number().optional(),
	battingOrder: z.string().optional(),
	stats: statGroupsSchema.optional(),
	seasonStats: statGroupsSchema.optional(),
	gameStatus: z
		.object({
			isCurrentBatter: z.boolean().optional(),
			isCurrentPitcher: z.boolean().optional(),
			isOnBench: z.boolean().optional(),
			isSubstitute: z.boolean().optional(),
		})
		.optional(),
});

const boxscoreTeamSchema = z.object({
	team: teamSchema.optional(),
	teamStats: statGroupsSchema.optional(),
	players: z.record(z.string(), boxscorePlayerSchema).optional(),
	batters: z.array(z.number()).optional(),
	pitchers: z.array(z.number()).optional(),
	bench: z.array(z.number()).optional(),
	bullpen: z.array(z.number()).optional(),
	battingOrder: z.array(z.number()).optional(),
	info: z
		.array(
			z.object({
				title: z.string().optional(),
				fieldList: z.array(boxscoreInfoLabelSchema).optional(),
			}),
		)
		.optional(),
	note: z.array(boxscoreInfoLabelSchema).optional(),
});

const boxscoreSchema = z.object({
	teams: z
		.object({
			away: boxscoreTeamSchema.optional(),
			home: boxscoreTeamSchema.optional(),
		})
		.optional(),
	officials: z
		.array(
			z.object({
				official: personSchema.optional(),
				officialType: z.string().optional(),
			}),
		)
		.optional(),
	info: z.array(boxscoreInfoLabelSchema).optional(),
	pitchingNotes: z.array(z.string()).optional(),
	topPerformers: z
		.array(
			z.object({
				player: boxscorePlayerSchema.optional(),
				type: z.string().optional(),
				gameScore: z.number().optional(),
				hittingGameScore: z.number().optional(),
			}),
		)
		.optional(),
});

const inningHitSchema = z.object({
	team: teamSchema.optional(),
	inning: z.number().optional(),
	pitcher: personSchema.optional(),
	batter: personSchema.optional(),
	coordinates: z
		.object({
			x: z.number().optional(),
			y: z.number().optional(),
		})
		.optional(),
	type: z.string().optional(),
	description: z.string().optional(),
});

// Every recorded feed returns `{}` for all three boards.
const leaderBoardSchema = z.object({});

const liveFeedResponseSchema = z.object({
	copyright: z.string().optional(),
	gamePk: z.number(),
	link: z.string().optional(),
	metaData: z
		.object({
			wait: z.number().optional(),
			timeStamp: z.string().optional(),
			gameEvents: z.array(z.string()).optional(),
			logicalEvents: z.array(z.string()).optional(),
		})
		.optional(),
	gameData: z.object({
		game: z
			.object({
				pk: z.number().optional(),
				type: z.string().optional(),
				doubleHeader: z.string().optional(),
				id: z.string().optional(),
				gamedayType: z.string().optional(),
				tiebreaker: z.string().optional(),
				gameNumber: z.number().optional(),
				calendarEventID: z.string().optional(),
				season: z.string().optional(),
				seasonDisplay: z.string().optional(),
			})
			.optional(),
		datetime: z
			.object({
				dateTime: z.string().optional(),
				originalDate: z.string().optional(),
				officialDate: z.string().optional(),
				dayNight: z.string().optional(),
				time: z.string().optional(),
				ampm: z.string().optional(),
			})
			.optional(),
		status: statusSchema,
		teams: z.object({
			away: teamSchema,
			home: teamSchema,
		}),
		venue: venueSchema,
		officialVenue: mlbLinkSchema.optional(),
		players: z.record(z.string(), personSchema).optional(),
		weather: z
			.object({
				condition: z.string().optional(),
				temp: z.string().optional(),
				wind: z.string().optional(),
			})
			.optional(),
		gameInfo: z
			.object({
				attendance: z.number().optional(),
				firstPitch: z.string().optional(),
				gameDurationMinutes: z.number().optional(),
			})
			.optional(),
		review: gameReviewSchema.optional(),
		flags: gameFlagsSchema.optional(),
		alerts: z.array(unmodeled).optional(),
		probablePitchers: z
			.object({
				away: personSchema.optional(),
				home: personSchema.optional(),
			})
			.optional(),
		officialScorer: personSchema.optional(),
		primaryDatacaster: personSchema.optional(),
		moundVisits: z
			.object({
				away: usageCountSchema.optional(),
				home: usageCountSchema.optional(),
			})
			.optional(),
		absChallenges: z
			.object({
				hasChallenges: z.boolean().optional(),
				away: z
					.object({
						remaining: z.number().optional(),
						usedSuccessful: z.number().optional(),
						usedFailed: z.number().optional(),
					})
					.optional(),
				home: z
					.object({
						remaining: z.number().optional(),
						usedSuccessful: z.number().optional(),
						usedFailed: z.number().optional(),
					})
					.optional(),
			})
			.optional(),
	}),
	liveData: z.object({
		plays: z.object({
			allPlays: z.array(playSchema),
			currentPlay: playSchema.optional(),
			scoringPlays: z.array(z.number()).optional(),
			playsByInning: z
				.array(
					z.object({
						startIndex: z.number().optional(),
						endIndex: z.number().optional(),
						top: z.array(z.number()).optional(),
						bottom: z.array(z.number()).optional(),
						hits: z
							.object({
								away: z.array(inningHitSchema).optional(),
								home: z.array(inningHitSchema).optional(),
							})
							.optional(),
					}),
				)
				.optional(),
		}),
		linescore: linescoreSchema,
		boxscore: boxscoreSchema.optional(),
		decisions: decisionsSchema.optional(),
		leaders: z
			.object({
				hitDistance: leaderBoardSchema.optional(),
				hitSpeed: leaderBoardSchema.optional(),
				pitchSpeed: leaderBoardSchema.optional(),
			})
			.optional(),
	}),
});

// --- standings ---------------------------------------------------------------
// Every games-back / elimination figure is a string, with `"-"` for "n/a".

const standingsRecordLineSchema = z.object({
	wins: z.number().optional(),
	losses: z.number().optional(),
	ties: z.number().optional(),
	pct: z.string().optional(),
});

const standingsTypedRecordSchema = standingsRecordLineSchema.extend({
	type: z.string().optional(),
});

const standingsRecordBreakdownSchema = z.object({
	splitRecords: z.array(standingsTypedRecordSchema).optional(),
	overallRecords: z.array(standingsTypedRecordSchema).optional(),
	expectedRecords: z.array(standingsTypedRecordSchema).optional(),
	divisionRecords: z
		.array(standingsRecordLineSchema.extend({
			division: mlbRefSchema.optional(),
		}))
		.optional(),
	leagueRecords: z
		.array(standingsRecordLineSchema.extend({
			league: mlbRefSchema.optional(),
		}))
		.optional(),
});

const standingsRecordEntrySchema = z.object({
	team: teamSchema.optional(),
	season: z.string().optional(),
	lastUpdated: z.string().optional(),
	streak: z
		.object({
			streakType: z.string().optional(),
			streakNumber: z.number().optional(),
			streakCode: z.string().optional(),
		})
		.optional(),
	leagueRecord: leagueRecordSchema.optional(),
	records: standingsRecordBreakdownSchema.optional(),

	wins: z.number().optional(),
	losses: z.number().optional(),
	winningPercentage: z.string().optional(),
	gamesPlayed: z.number().optional(),

	divisionRank: z.string().optional(),
	leagueRank: z.string().optional(),
	sportRank: z.string().optional(),

	gamesBack: z.string().optional(),
	wildCardGamesBack: z.string().optional(),
	leagueGamesBack: z.string().optional(),
	divisionGamesBack: z.string().optional(),
	sportGamesBack: z.string().optional(),
	conferenceGamesBack: z.string().optional(),
	springLeagueGamesBack: z.string().optional(),
	springLeagueRank: z.string().optional(),

	runsScored: z.number().optional(),
	runsAllowed: z.number().optional(),
	runDifferential: z.number().optional(),

	divisionLeader: z.boolean().optional(),
	divisionChamp: z.boolean().optional(),
	hasWildcard: z.boolean().optional(),
	clinched: z.boolean().optional(),
	clinchIndicator: z.string().optional(),
	wildCardRank: z.string().optional(),
	wildCardLeader: z.boolean().optional(),

	magicNumber: z.string().optional(),
	eliminationNumber: z.string().optional(),
	eliminationNumberSport: z.string().optional(),
	eliminationNumberLeague: z.string().optional(),
	eliminationNumberDivision: z.string().optional(),
	eliminationNumberConference: z.string().optional(),
	wildCardEliminationNumber: z.string().optional(),
});

const standingsResponseSchema = z.object({
	copyright: z.string().optional(),
	records: z
		.array(
			z.object({
				standingsType: z.string().optional(),
				league: mlbLinkSchema.optional(),
				division: mlbLinkSchema.optional(),
				sport: mlbLinkSchema.optional(),
				roundRobin: z.object({
					status: z.string().optional(),
				}).optional(),
				lastUpdated: z.string().optional(),
				teamRecords: z.array(standingsRecordEntrySchema).optional(),
			}),
		)
		.optional(),
});

// --- people ------------------------------------------------------------------

const peopleResponseSchema = z.object({
	copyright: z.string().optional(),
	people: z.array(personSchema).optional(),
});

/** Throws `ZodError` when a field BT depends on is missing or mistyped. */
export function parseScheduleResponse(input: unknown): ScheduleResponse
{
	return scheduleResponseSchema.parse(input);
}

export function parseLiveFeedResponse(input: unknown): LiveFeedResponse
{
	return liveFeedResponseSchema.parse(input);
}

export function parseGameContentResponse(input: unknown): GameContentResponse
{
	return gameContentResponseSchema.parse(input);
}

/** `GET /api/v1/standings` */
export function parseStandingsResponse(input: unknown): StandingsResponse
{
	return standingsResponseSchema.parse(input);
}

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const seasonSchema = z.object({
	seasonId: z.string(),
	hasWildcard: z.boolean().optional(),
	preSeasonStartDate: calendarDate.optional(),
	preSeasonEndDate: calendarDate.optional(),
	seasonStartDate: calendarDate.optional(),
	springStartDate: calendarDate.optional(),
	springEndDate: calendarDate.optional(),
	regularSeasonStartDate: calendarDate.optional(),
	lastDate1stHalf: calendarDate.optional(),
	allStarDate: calendarDate.optional(),
	firstDate2ndHalf: calendarDate.optional(),
	regularSeasonEndDate: calendarDate.optional(),
	postSeasonStartDate: calendarDate.optional(),
	postSeasonEndDate: calendarDate.optional(),
	seasonEndDate: calendarDate.optional(),
	offseasonStartDate: calendarDate.optional(),
	offSeasonEndDate: calendarDate.optional(),
	seasonLevelGamedayType: z.string().optional(),
	gameLevelGamedayType: z.string().optional(),
	qualifierPlateAppearances: z.number().optional(),
	qualifierOutsPitched: z.number().optional(),
});

const seasonsResponseSchema = z.object({
	copyright: z.string().optional(),
	seasons: z.array(seasonSchema),
});

/** `GET /api/v1/seasons/{season}?sportId=1` (S111): one season's calendar, or none if unpublished. */
export function parseSeasonsResponse(input: unknown): SeasonsResponse
{
	return seasonsResponseSchema.parse(input);
}

const playMetricsCountSchema = z.object({
	balls: z.number().optional(),
	strikes: z.number().optional(),
	outs: z.number().optional(),
});

const playMetricsHitDataSchema = z.object({
	launchSpeed: z.number().nullable().optional(),
	launchAngle: z.number().nullable().optional(),
	totalDistance: z.number().nullable().optional(),
});

const playMetricsRunnerSchema = z.object({
	id: z.number().optional(),
});

const playMetricsEventSchema = z.object({
	playIndex: z.number().optional(),
	details: z
		.object({
			eventType: z.string().optional(),
			awayScore: z.number().optional(),
			homeScore: z.number().optional(),
			isScoringPlay: z.boolean().optional(),
		})
		.optional(),
	preCount: playMetricsCountSchema.optional(),
	hitData: playMetricsHitDataSchema.optional(),
	offense: z
		.object({
			first: playMetricsRunnerSchema.optional(),
			second: playMetricsRunnerSchema.optional(),
			third: playMetricsRunnerSchema.optional(),
		})
		.optional(),
	reviewDetails: z
		.object({
			reviewType: z.string().optional(),
		})
		.optional(),
});

const atBatPlayMetricsSchema = z.object({
	atBatIndex: z.number(),
	when: z.string().optional(),
	halfInning: z.string().optional(),
	preCount: playMetricsCountSchema.optional(),
	playEvents: z.array(playMetricsEventSchema).optional(),
	homeTeamWinProbability: z.number().optional(),
	awayTeamWinProbability: z.number().optional(),
	homeTeamWinProbabilityAdded: z.number().optional(),
	awayTeamWinProbabilityAdded: z.number().optional(),
	isTieOrLeadChangePlay: z.boolean().optional(),
	atBatIsTieOrLeadChange: z.boolean().optional(),
	hasTieOrLeadChangePlay: z.boolean().optional(),
	isScoringPlay: z.boolean().optional(),
	isScoringAtBat: z.boolean().optional(),
	isHomeRun: z.boolean().optional(),
	isHardHit: z.boolean().optional(),
	isStrikeout: z.boolean().optional(),
	isHighLeverage: z.boolean().optional(),
	hasLargeWinProbChange: z.boolean().optional(),
	isKeyMoment: z.boolean().optional(),
	atBatHasLargeWinProbChange: z.boolean().optional(),
	atBatIsKeyMoment: z.boolean().optional(),
	hasPlayWithLargeWinProbChange: z.boolean().optional(),
	hasPlayWithLargeKMWinProbChange: z.boolean().optional(),
	playsKMWpaThreshold: z.number().nullable().optional(),
	playsWpaThreshold: z.number().nullable().optional(),
	scoringPlayEvents: z.array(z.number()).nullable().optional(),
	leadChangePlayEvents: z.array(z.number()).nullable().optional(),
	isAbsChallenge: z.boolean().optional(),
	hitData: playMetricsHitDataSchema.optional(),
});

const playMetricsResponseSchema = z.object({
	scoringPlays: z.array(z.number()).optional(),
	homeRuns: z.array(z.number()).optional(),
	hardHits: z.array(z.number()).optional(),
	strikeouts: z.array(z.number()).optional(),
	leadChange: z.array(z.number()).optional(),
	winProb: z.array(z.number()).optional(),
	keyMoments: z.array(z.number()).optional(),
	absChallenge: z.array(z.number()).optional(),
	allPlayMetrics: z.array(atBatPlayMetricsSchema).optional(),
});

/** `GET bdfed.stitch.mlbinfra.com/bdfed/playMetrics/{gamePk}` (S93; an internal mlb.com feed). */
export function parsePlayMetricsResponse(input: unknown): PlayMetricsResponse
{
	return playMetricsResponseSchema.parse(input);
}

const graphContentTagSchema = z.object({
	slug: z.string().optional(),
	type: z.string().optional(),
	title: z.string().optional(),
	gamePk: z.number().optional(),
	team: z.object({
		id: z.number().optional(),
		__typename: z.string().optional(),
	}).optional(),
	__typename: z.string().optional(),
});

const graphContentArticleSchema = z.object({
	slug: z.string(),
	headline: z.string().optional(),
	blurb: z.string().optional(),
	description: z.string().nullable().optional(),
	contentDate: z.string().optional(),
	templateUrl: z.string().optional(),
	type: z.string().optional(),
	tags: z.array(graphContentTagSchema).optional(),
	__typename: z.string().optional(),
});

const graphContentVideoSchema = z.object({
	id: z.string(),
	slug: z.string().optional(),
	title: z.string().optional(),
	headline: z.string().optional(),
	blurb: z.string().optional(),
	description: z.string().nullable().optional(),
	accessibilityText: z.string().nullable().optional(),
	duration: z.string().optional(),
	guid: z.string().nullable().optional(),
	playIdRef: z.string().nullable().optional(),
	date: z.string().optional(),
	contentDate: z.string().optional(),
	preferredPlaybackScenarioURL: z.string().optional(),
	playbacks: z.array(z.object({
		name: z.string().optional(),
		url: z.string().optional(),
		__typename: z.string().optional(),
	})).optional(),
	thumbnail: z.object({
		templateUrl: z.string().optional(),
		__typename: z.string().optional(),
	}).optional(),
	tags: z.array(graphContentTagSchema).optional(),
	__typename: z.string().optional(),
});

const graphContentResponseSchema = z.object({
	data: z.object({
		getGamesByGamePks: z.array(z.object({
			gamePk: z.number(),
			gameDate: z.string().optional(),
			content: z.object({
				videoContent: z.array(graphContentVideoSchema).optional(),
				recapArticle: z.array(graphContentArticleSchema).optional(),
				relatedArticles: z.array(graphContentArticleSchema).optional(),
				__typename: z.string().optional(),
			}).nullable().optional(),
			__typename: z.string().optional(),
		})).optional(),
	}).optional(),
});

/** `GET data-graph.mlb.com/graphql/?operationName=getGamesByGamePks` (S94; MLB's GraphQL game content). */
export function parseGraphContentResponse(input: unknown): GraphContentResponse
{
	return graphContentResponseSchema.parse(input);
}

/** `GET /api/v1/people` */
export function parsePeopleResponse(input: unknown): PeopleResponse
{
	return peopleResponseSchema.parse(input);
}

/** `GET /api/v1.1/game/{gamePk}/feed/live/timestamps` — a bare string array. */
export function parseGameTimestamps(input: unknown): string[]
{
	return z.array(z.string()).parse(input);
}
