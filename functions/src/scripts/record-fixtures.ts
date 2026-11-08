/**
 * `pnpm --filter @bt/functions record-fixtures -- --date=… --game=…`
 * `pnpm --filter @bt/functions record-fixtures -- --season=YYYY [--spring-date=YYYY-MM-DD]`
 *
 * The `--season` form records one season's calendar, World Series, final standings and (with
 * `--spring-date`) its spring training standings as of that day, through `seasonEndpoints` (S128).
 *
 * Re-records the committed fixture corpus from live MLB: the Stats API payloads
 * and MLB's play-metrics feed (`raw/playmetrics-<gamePk>.json`, from
 * `bdfed.stitch.mlbinfra.com`, S93) and its GraphQL game content
 * (`raw/graphql-content-<gamePk>.json`, from `data-graph.mlb.com`, S94), all through `rawEndpoints`. This is the one
 * network-touching entrypoint in the repo and is **never** run by CI or
 * `pnpm verify` — both stay on `FixtureMlbStatsClient`. Review the diff before
 * committing re-recorded payloads (see README).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpMlbStatsClient } from "../adapters/http/mlb.js";
import {
	recordEndpoints,
	recordNormalized,
	recordRaw,
	seasonEndpoints,
	type RecorderTarget,
} from "../services/recorder.js";

const FIXTURES_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../fixtures",
);

function arg(name: string): string | undefined
{
	const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
	return hit?.split("=")[1];
}

async function main(): Promise<void>
{
	const season = arg("season");
	if (season)
	{
		const written = await recordEndpoints(seasonEndpoints(Number(season), arg("spring-date")), arg("out") ?? FIXTURES_ROOT);
		for (const file of written) console.log(`wrote raw/${file}`);
		return;
	}
	const date = arg("date");
	const game = arg("game");
	if (!date || !game)
	{
		console.error(
			"usage: record-fixtures --date=YYYY-MM-DD --game=<gamePk> [--players=1,2,3] [--out=<dir>]",
		);
		process.exit(2);
	}

	const target: RecorderTarget = {
		date,
		gamePk: Number(game),
		playerIds: arg("players")?.split(",").map(Number).filter(Number.isFinite) ?? [],
	};
	const outDir = arg("out") ?? FIXTURES_ROOT;

	const raw = await recordRaw(target, outDir);
	const normalized = await recordNormalized(new HttpMlbStatsClient(), target, outDir);
	for (const file of [...raw.map((f) => `raw/${f}`), ...normalized])
	{
		console.log(`wrote ${file}`);
	}
}

await main();
