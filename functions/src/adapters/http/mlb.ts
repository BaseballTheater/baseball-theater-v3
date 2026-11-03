/**
 * Live MLB Stats API adapter.
 *
 * Opt-in only: `local-server.ts` keeps `FixtureMlbStatsClient` as the default
 * and constructs this one when `BT_USE_LIVE_MLB=1`. Fixtures stay the CI path
 * so `pnpm verify` never needs network.
 *
 * Highlights come from the content endpoint (`/api/v1/game/{gamePk}/content`);
 * the live feed hydrate carries no playback URLs.
 */
import type {
	GameGraphContent,
	GamePlayMetrics,
	GameSnapshot,
	PlayerProfile,
	ScheduleDay,
	SeasonCalendar,
	StandingsSnapshot,
	Unversioned,
} from "@bt/domain";
import { rankHighlightsByImpact } from "@bt/domain";
import type { GameContentResponse, GameDiffPatchResponse } from "@bt/mlb-api";
import {
	parseGameContentResponse,
	parseGameDiffPatchResponse,
	parseGraphContentResponse,
	parseGameTimestamps,
	parseLiveFeedResponse,
	parsePeopleResponse,
	parsePlayMetricsResponse,
	parseScheduleResponse,
	parseSeasonsResponse,
	parseStandingsResponse,
} from "@bt/mlb-api";
import type { MlbStatsClient } from "@bt/ports";
import { mapContentHighlights, mapRecap } from "../../mappers/content.js";
import { mapGraphContent } from "../../mappers/graph-content.js";
import { mapPeople } from "../../mappers/players.js";
import { mapStandings } from "../../mappers/standings.js";
import { mapLiveFeed } from "../../mappers/live.js";
import { mapPlayMetrics } from "../../mappers/play-metrics.js";
import { mapScheduleResponse } from "../../mappers/schedule.js";
import { mapSeasonCalendar } from "../../mappers/season-calendar.js";

const DEFAULT_BASE_URL = "https://statsapi.mlb.com";

/** An upstream request: the URL, and any headers it needs beyond `accept`. */
export type MlbRequest = {
	url: string;
	headers?: Record<string, string>;
};

/**
 * MLB's GraphQL game content for one game (S94): the persisted query `getGamesByGamePks`
 * on `data-graph.mlb.com`, as mlb.com's game pages ask it. The hash, the variables and the
 * `x-client-name: mlb` and `content-type: application/json` headers (without either the
 * gateway answers 400 with an empty body) live
 * only here; the recorder (S14) records the same request. MLB can retire the hash at any time,
 * so callers treat the answer as optional.
 */
export function graphContentRequest(gamePk: number): MlbRequest
{
	const extensions = {
		persistedQuery: {
			operationName: "getGamesByGamePks",
			sha256Hash: "e12a5c2692406844d5f15f52ce7754208f53da81867de7d3e9e773611f4a040a",
			version: 1,
		},
	};
	const variables = {
		gameRecapTags: ["game-recap"],
		relatedArticleTags: ["storytype-article"],
		gamePks: [gamePk],
		locale: "EN_US",
		contentSource: "MLB",
	};
	const query = new URLSearchParams({
		operationName: "getGamesByGamePks",
		extensions: JSON.stringify(extensions),
		variables: JSON.stringify(variables),
	});
	return {
		url: `https://data-graph.mlb.com/graphql/?${query}`,
		headers: {
			"x-client-name": "mlb",
			"content-type": "application/json",
		},
	};
}

/**
 * MLB's play-metrics feed (S93): an internal mlb.com source on its own host, not the Stats
 * API, asked for every category. `highLeverage=false` only empties the top-level list; each
 * at-bat still says `isHighLeverage`. The recorder (S14) records the same URL.
 */
export function playMetricsUrl(gamePk: number): string
{
	return `https://bdfed.stitch.mlbinfra.com/bdfed/playMetrics/${gamePk}?keyMoments=true&scoringPlays=true&homeRuns=true&strikeouts=true&hardHits=true&highLeverage=false&leadChange=true&winProb=true&absChallenge=true`;
}

/** One season's calendar (S111); the recorder (S14) records the same URL. */
export function seasonsUrl(season: number, baseUrl = DEFAULT_BASE_URL): string
{
	return `${baseUrl}/api/v1/seasons/${season}?sportId=1`;
}

/** One season's World Series schedule (S111): its last listed game is the season's final. */
export function worldSeriesUrl(season: number, baseUrl = DEFAULT_BASE_URL): string
{
	return `${baseUrl}/api/v1/schedule?sportId=1&gameType=W&season=${season}`;
}

const SCHEDULE_HYDRATE =
	"team,linescore(matchup,runners),flags,liveLookin,review,decisions,person,probablePitcher,stats,game(content(media(featured,epg),summary))";

export interface HttpMlbStatsClientOptions {
	baseUrl?: string;
	/** Injected in tests; defaults to global `fetch`. */
	fetchImpl?: typeof fetch;
	now?: () => Date;
}

export class HttpMlbStatsClient implements MlbStatsClient
{
	private readonly baseUrl: string;
	private readonly fetchImpl: typeof fetch;
	private readonly now: () => Date;

	constructor(options: HttpMlbStatsClientOptions = {})
	{
		this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
		this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
		this.now = options.now ?? (() => new Date());
	}

	async fetchSchedule(date: string): Promise<Unversioned<ScheduleDay>>
	{
		const url = `${this.baseUrl}/api/v1/schedule?sportId=1&date=${date}&hydrate=${SCHEDULE_HYDRATE}`;
		const payload = parseScheduleResponse(await this.getJson(url));
		return mapScheduleResponse(payload, date, this.now().toISOString(), "active");
	}

	async fetchGame(gamePk: number): Promise<Unversioned<GameSnapshot>>
	{
		const feedUrl = `${this.baseUrl}/api/v1.1/game/${gamePk}/feed/live`;
		const feed = parseLiveFeedResponse(await this.getJson(feedUrl));
		const snapshot = mapLiveFeed(feed, this.now().toISOString(), "active");
		const [content, playMetrics, graph] = await Promise.all([this.fetchContent(gamePk), this.fetchPlayMetrics(gamePk), this.fetchGameGraphContent(gamePk)]);
		return {
			...snapshot,
			highlights: content ? rankHighlightsByImpact(mapContentHighlights(content)) : [],
			recap: content ? mapRecap(content) : undefined,
			...playMetrics && {
				playMetrics,
			},
			...graph?.videoPlayRefs.length && {
				videoPlayRefs: graph.videoPlayRefs,
			},
			...graph?.relatedArticles.length && {
				relatedArticles: graph.relatedArticles,
			},
		};
	}

	async fetchStandings(date: string): Promise<StandingsSnapshot>
	{
		const url = `${this.baseUrl}/api/v1/standings?leagueId=103,104&date=${date}&hydrate=team`;
		const payload = parseStandingsResponse(await this.getJson(url));
		return {
			...mapStandings(payload, date, this.now().toISOString()),
			windowMode: "active",
		};
	}

	async fetchPlayers(ids: number[]): Promise<PlayerProfile[]>
	{
		if (ids.length === 0) return [];
		const season = this.now().getUTCFullYear();
		const hydrate = `stats(group=[hitting,pitching],type=[season],season=${season})`;
		const url = `${this.baseUrl}/api/v1/people?personIds=${ids.join(",")}&hydrate=${encodeURIComponent(hydrate)}`;
		return mapPeople(parsePeopleResponse(await this.getJson(url)));
	}

	async fetchGameTimestamps(gamePk: number): Promise<string[]>
	{
		const url = `${this.baseUrl}/api/v1.1/game/${gamePk}/feed/live/timestamps`;
		return parseGameTimestamps(await this.getJson(url));
	}

	async fetchGameDiffPatch(
		gamePk: number,
		startTimecode: string,
		endTimecode: string,
	): Promise<GameDiffPatchResponse>
	{
		const url = `${this.baseUrl}/api/v1.1/game/${gamePk}/feed/live/diffPatch?startTimecode=${startTimecode}&endTimecode=${endTimecode}`;
		return parseGameDiffPatchResponse(await this.getJson(url));
	}

	/** Content is best-effort: a game with no cut highlights still resolves. */
	async fetchGameContent(gamePk: number): Promise<GameSnapshot["highlights"]>
	{
		const content = await this.fetchContent(gamePk);
		return content ? rankHighlightsByImpact(mapContentHighlights(content)) : [];
	}

	/**
	 * The game's content payload (highlights and the editorial recap, S10), or
	 * `undefined` when it can't be had — content is best-effort, never a reason a
	 * game fails to load.
	 */
	/** MLB's GraphQL game content, mapped; null when the call fails, can't be parsed or adds nothing (S94 AC 5). */
	async fetchGameGraphContent(gamePk: number): Promise<GameGraphContent | null>
	{
		try
		{
			const { url, headers } = graphContentRequest(gamePk);
			return mapGraphContent(parseGraphContentResponse(await this.getJson(url, headers)), gamePk);
		}
		catch
		{
			return null;
		}
	}

	/** The play-metrics feed, mapped; null when it fails, can't be parsed or has no at-bats (S93 AC 5). */
	async fetchPlayMetrics(gamePk: number): Promise<GamePlayMetrics | null>
	{
		try
		{
			return mapPlayMetrics(parsePlayMetricsResponse(await this.getJson(playMetricsUrl(gamePk))));
		}
		catch
		{
			return null;
		}
	}

	/** The season's calendar with its World Series final (S111); null when unpublished or unreachable. */
	async fetchSeasonCalendar(season: number): Promise<SeasonCalendar | null>
	{
		try
		{
			const [seasons, worldSeries] = await Promise.all([
				this.getJson(seasonsUrl(season, this.baseUrl)),
				this.getJson(worldSeriesUrl(season, this.baseUrl)),
			]);
			return mapSeasonCalendar(parseSeasonsResponse(seasons), parseScheduleResponse(worldSeries));
		}
		catch
		{
			return null;
		}
	}

	private async fetchContent(gamePk: number): Promise<GameContentResponse | undefined>
	{
		const url = `${this.baseUrl}/api/v1/game/${gamePk}/content?language=en`;
		try
		{
			return parseGameContentResponse(await this.getJson(url));
		}
		catch
		{
			return undefined;
		}
	}

	private async getJson(url: string, headers: Record<string, string> = {}): Promise<unknown>
	{
		const response = await this.fetchImpl(url, {
			headers: {
				accept: "application/json",
				...headers,
			},
		});
		if (!response.ok)
		{
			throw new Error(`MLB Stats API ${response.status} for ${url}`);
		}
		return await response.json();
	}
}
