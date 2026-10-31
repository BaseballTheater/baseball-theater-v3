/**
 * The API as a Cloudflare Worker (S45; ADR-017). `fetch` serves `/api/*` through the
 * same Fetch-standard `handleApiRequest` the Node server adapts; everything else is
 * the web app, served from `web/dist` by the assets binding before the Worker runs
 * (`wrangler.jsonc`). `scheduled` is the cron trigger: it ensures one
 * `game-ingest:<gamePk>` Durable Object per in-window game (S48; ADR-020), whose alarms
 * own the ADR-002 cadence. Composition lives in `worker-app.ts`.
 */
import { ensureGameIngest } from "./game-ingest-object.js";
import { handleApiRequest } from "./handlers/api.js";
import { ensureIngestRunning } from "./services/game-ingest.js";
import { tickAllowed, workerApp } from "./worker-app.js";
import type { WorkerEnv } from "./worker-app.js";

export { GameIngestObject } from "./game-ingest-object.js";

/** The part of the Workers `ExecutionContext` this Worker uses. */
type WorkerContext = { waitUntil(promise: Promise<unknown>): void };

export default {
	async fetch(request: Request, env: WorkerEnv): Promise<Response>
	{
		const app = workerApp(env);
		await app.ready;
		return handleApiRequest(request, app.context);
	},

	/**
	 * Ensures an ingest object (`ensureRunning`) for each in-window game; in local dev only
	 * with `BT_INGEST_TICK=1`, and only where the `GAME_INGEST` binding exists.
	 */
	async scheduled(_controller: unknown, env: WorkerEnv, ctx: WorkerContext): Promise<void>
	{
		const namespace = env.GAME_INGEST;
		if (!tickAllowed(env) || !namespace) return;
		const app = workerApp(env);
		await app.ready;
		ctx.waitUntil(ensureIngestRunning(app.ingest, (gamePk) => ensureGameIngest(namespace, gamePk)));
	},
};
