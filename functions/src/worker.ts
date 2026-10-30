/**
 * The API as a Cloudflare Worker (S45; ADR-017). `fetch` serves `/api/*` through the
 * same Fetch-standard `handleApiRequest` the Node server adapts; everything else is
 * the web app, served from `web/dist` by the assets binding before the Worker runs
 * (`wrangler.jsonc`). `scheduled` is the cron trigger's ingest tick (ADR-002 cadence)
 * until S48's ingest Durable Object takes it over. Composition lives in `worker-app.ts`.
 */
import { handleApiRequest } from "./handlers/api.js";
import { tickIngest } from "./services/ingest.js";
import { tickAllowed, workerApp } from "./worker-app.js";
import type { WorkerEnv } from "./worker-app.js";

/** The part of the Workers `ExecutionContext` this Worker uses. */
type WorkerContext = { waitUntil(promise: Promise<unknown>): void };

export default {
	async fetch(request: Request, env: WorkerEnv): Promise<Response>
	{
		const app = workerApp(env);
		await app.ready;
		return handleApiRequest(request, app.context);
	},

	/** One ingest pass over in-window games; in local dev only with `BT_INGEST_TICK=1`. */
	async scheduled(_controller: unknown, env: WorkerEnv, ctx: WorkerContext): Promise<void>
	{
		if (!tickAllowed(env)) return;
		const app = workerApp(env);
		await app.ready;
		ctx.waitUntil(tickIngest(app.ingest));
	},
};
