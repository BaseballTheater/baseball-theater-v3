/**
 * `pnpm --filter @bt/functions record-fixtures -- --date=… --game=…`
 *
 * Re-records the committed fixture corpus from live MLB: the Stats API payloads
 * and MLB's play-metrics feed (`raw/playmetrics-<gamePk>.json`, from
 * `bdfed.stitch.mlbinfra.com`, S93), all through `rawEndpoints`. This is the one
 * network-touching entrypoint in the repo and is **never** run by CI or
 * `pnpm verify` — both stay on `FixtureMlbStatsClient`. Review the diff before
 * committing re-recorded payloads (see README).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpMlbStatsClient } from "../adapters/http/mlb.js";
import {
	recordNormalized,
	recordRaw,
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
