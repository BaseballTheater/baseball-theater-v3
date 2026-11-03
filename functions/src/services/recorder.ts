/**
 * Fixture recorder — regenerates the committed corpus from upstream.
 *
 * Two recording paths, because the `MlbStatsClient` port returns domain types
 * and never surfaces upstream JSON (`packages/ports/src/mlb.ts`):
 *
 * - **raw** — verbatim upstream payloads. This one cannot go through the port,
 *   so `fetch` is injected directly. Bytes are written exactly as received
 *   (`response.text()`, no re-stringify) so `fixtures/raw/` stays byte-exact
 *   for the S23 coverage gate.
 * - **normalized** — `fixtures/`-shaped JSON, written through whichever
 *   `MlbStatsClient` adapter it is handed: `HttpMlbStatsClient` in production,
 *   a fake adapter under test.
 *
 * Neither path reaches the network on its own: the raw path fetches only
 * through the injected implementation, so a stubbed response records offline.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
	AtBat,
	GameSnapshot,
	Unversioned,
} from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";
import { graphContentRequest, playMetricsUrl } from "../adapters/http/mlb.js";

const DEFAULT_BASE_URL = "https://statsapi.mlb.com";

const SCHEDULE_HYDRATE =
	"team,linescore(matchup,runners),flags,liveLookin,review,decisions,person,probablePitcher,stats,game(content(media(featured,epg),summary))";

export interface RecorderTarget {
	date: string;
	gamePk: number;
	/** Player ids for the people/players payloads; empty skips them. */
	playerIds?: number[];
}

export interface RawRecorderOptions {
	baseUrl?: string;
	/** Injected in tests; defaults to global `fetch`. */
	fetchImpl?: typeof fetch;
}

/** One raw upstream payload: the `fixtures/raw/` basename, its URL, and any headers it needs beyond `accept`. */
export interface RawEndpoint {
	name: string;
	url: string;
	headers?: Record<string, string>;
}

/**
 * The six `fixtures/raw/<endpoint>-<key>.json` names consumed by
 * `packages/mlb-api/src/coverage.test.ts`. Re-recording keeps that gate and
 * the S22 prerequisite regenerable instead of orphaning them.
 */
export function rawEndpoints(
	target: RecorderTarget,
	baseUrl = DEFAULT_BASE_URL,
): RawEndpoint[]
{
	const { date, gamePk } = target;
	const ids = target.playerIds ?? [];
	const endpoints: RawEndpoint[] = [
		{
			name: `schedule-${date}`,
			url: `${baseUrl}/api/v1/schedule?sportId=1&date=${date}&hydrate=${SCHEDULE_HYDRATE}`,
		},
		{
			name: `live-${gamePk}`,
			url: `${baseUrl}/api/v1.1/game/${gamePk}/feed/live`,
		},
		{
			name: `content-${gamePk}`,
			url: `${baseUrl}/api/v1/game/${gamePk}/content?language=en`,
		},
		{
			name: `timestamps-${gamePk}`,
			url: `${baseUrl}/api/v1.1/game/${gamePk}/feed/live/timestamps`,
		},
		{
			// MLB's play-metrics feed (S93), on its own host: the URL the HTTP client asks.
			name: `playmetrics-${gamePk}`,
			url: playMetricsUrl(gamePk),
		},
		{
			// MLB's GraphQL game content (S94): the request the HTTP client makes, headers included.
			name: `graphql-content-${gamePk}`,
			...graphContentRequest(gamePk),
		},
		{
			name: `standings-${date}`,
			url: `${baseUrl}/api/v1/standings?leagueId=103,104&date=${date}&hydrate=team`,
		},
	];
	if (ids.length > 0)
	{
		endpoints.push({
			name: `people-${gamePk}`,
			url: `${baseUrl}/api/v1/people?personIds=${ids.join(",")}`,
		});
	}
	return endpoints;
}

/**
 * Raw path. Writes each upstream response verbatim into `<outDir>/raw/`.
 * Returns the basenames written, in order.
 */
export async function recordRaw(
	target: RecorderTarget,
	outDir: string,
	options: RawRecorderOptions = {},
): Promise<string[]>
{
	const doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
	const rawDir = path.join(outDir, "raw");
	await mkdir(rawDir, {
		recursive: true,
	});

	const written: string[] = [];
	for (const endpoint of rawEndpoints(target, options.baseUrl ?? DEFAULT_BASE_URL))
	{
		const response = await doFetch(endpoint.url, {
			headers: {
				accept: "application/json",
				...endpoint.headers,
			},
		});
		if (!response.ok)
		{
			throw new Error(`MLB Stats API ${response.status} for ${endpoint.url}`);
		}
		// Verbatim bytes — `fixtures/raw` is in .prettierignore and must stay exact.
		await writeFile(path.join(rawDir, `${endpoint.name}.json`), await response.text());
		written.push(`${endpoint.name}.json`);
	}
	return written;
}

async function writeJson(file: string, data: unknown): Promise<void>
{
	await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Normalized path. Writes the `fixtures/`-shaped files `FixtureMlbStatsClient`
 * reads back.
 *
 * `plays` is written as its own `plays-<gamePk>.json` and stripped from the
 * game file: `fetchGame` overwrites embedded plays with that separate file, so
 * inlining them would round-trip silently to `plays: []`.
 */
export async function recordNormalized(
	client: MlbStatsClient,
	target: RecorderTarget,
	outDir: string,
): Promise<string[]>
{
	const { date, gamePk } = target;
	await mkdir(outDir, {
		recursive: true,
	});
	const written: string[] = [];

	const schedule = await client.fetchSchedule(date);
	await writeJson(path.join(outDir, `schedule-${date}.json`), {
		date: schedule.date,
		games: schedule.games,
	});
	written.push(`schedule-${date}.json`);

	const game = await client.fetchGame(gamePk);
	const {
		fetchedAt: _f, windowMode: _w, plays, ...rest
	} = game;
	await writeJson(path.join(outDir, `game-${gamePk}.json`), rest);
	written.push(`game-${gamePk}.json`);

	await writeJson(path.join(outDir, `plays-${gamePk}.json`), (plays ?? []) as AtBat[]);
	written.push(`plays-${gamePk}.json`);

	const standings = await client.fetchStandings(date);
	await writeJson(path.join(outDir, `standings-${date}.json`), {
		date: standings.date,
		divisions: standings.divisions,
	});
	written.push(`standings-${date}.json`);

	const ids = target.playerIds ?? [];
	if (ids.length > 0)
	{
		await writeJson(
			path.join(outDir, `players-${gamePk}.json`),
			await client.fetchPlayers(ids),
		);
		written.push(`players-${gamePk}.json`);
	}
	return written;
}

export type RecordedGame = Omit<Unversioned<GameSnapshot>, "fetchedAt" | "windowMode">;
