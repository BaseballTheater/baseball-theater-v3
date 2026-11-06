/**
 * S45: the API inside workerd — the runtime production uses — through the real Worker
 * entry and its composition, serving the bundled fixtures (no `node:fs`, no network).
 * S114 AC 7: deployed (no `BT_LOCAL`), the same composition refuses a `dev:` sign-in.
 * Run with `pnpm --filter @bt/functions test:workerd`.
 */
import { env, SELF } from "cloudflare:test";
import {
	describe, expect, it,
} from "vitest";
import { inDatabaseScope, scopedDatabase } from "./adapters/postgres/connect.js";
import { handleApiRequest } from "./handlers/api.js";
import { createWorkerApp } from "./worker-app.js";
import type { WorkerEnv } from "./worker-app.js";

describe("the Worker on workerd (S45)", () =>
{
	it("GET /api/v1/schedule?date=2024-07-04 is 200 with the fixture day", async () =>
	{
		const res = await SELF.fetch("http://bt.test/api/v1/schedule?date=2024-07-04");
		expect(res.status).toBe(200);
		const day = await res.json() as { date: string;
			games: unknown[]; };
		expect(day.date).toBe("2024-07-04");
		expect(day.games.length).toBeGreaterThan(0);
	});

	it("GET /api/v1/games/744834 is 200 with the fixture game", async () =>
	{
		const res = await SELF.fetch("http://bt.test/api/v1/games/744834");
		expect(res.status).toBe(200);
		const game = await res.json() as { gamePk: number };
		expect(game.gamePk).toBe(744834);
	});
});

describe("dev sign-in on deployed Workers (S114)", () =>
{
	// Each app is the Worker's own composition on its own env: the shared `workerApp` is built once
	// per isolate from the test pool's env, which sets BT_LOCAL like `pnpm dev`.
	const meAs = async (workerEnv: WorkerEnv) =>
	{
		const app = createWorkerApp(workerEnv, scopedDatabase);
		const res = await inDatabaseScope(workerEnv.HYPERDRIVE, () => handleApiRequest(new Request("http://bt.test/api/v1/me", {
			headers: {
				Authorization: "Bearer dev:test-user",
			},
		}), app.context));
		return res.status;
	};

	it("S114 AC 7: Bearer dev:test-user is refused without BT_LOCAL and accepted with it", async () =>
	{
		const { BT_LOCAL: _local, ...deployed } = env as unknown as WorkerEnv;
		expect(await meAs(deployed)).toBe(401);
		expect(await meAs({
			...deployed,
			BT_LOCAL: "1",
		})).toBe(200);
	});
});
