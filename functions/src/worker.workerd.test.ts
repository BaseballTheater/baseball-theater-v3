/**
 * S45: the API inside workerd — the runtime production uses — through the real Worker
 * entry and its composition, serving the bundled fixtures (no `node:fs`, no network).
 * S114 AC 7: deployed (no `BT_LOCAL`), the same composition refuses a `dev:` sign-in.
 * S116 AC 2: where the vars name a Logto tenant, a Logto ID token signs in through
 * `POST /api/v1/sign-in` (the tenant is a stand-in serving a locally made key).
 * Run with `pnpm --filter @bt/functions test:workerd`.
 */
import { env, SELF } from "cloudflare:test";
import {
	describe, expect, it,
} from "vitest";
import { inDatabaseScope, scopedDatabase } from "./adapters/postgres/connect.js";
import { handleApiRequest } from "./handlers/api.js";
import {
	createTestTenant, TEST_LOGTO_APP_ID, TEST_LOGTO_ENDPOINT,
} from "./test/logto-tokens.js";
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

describe("Logto sign-in on deployed Workers (S116)", () =>
{
	it("S116 AC 2: a Logto ID token signs in through POST /api/v1/sign-in for BT's own session, and a dev: token is refused", async () =>
	{
		const tenant = await createTestTenant();
		const { BT_LOCAL: _local, ...deployed } = env as unknown as WorkerEnv;
		const workerEnv: WorkerEnv = {
			...deployed,
			LOGTO_ENDPOINT: TEST_LOGTO_ENDPOINT,
			LOGTO_APP_ID: TEST_LOGTO_APP_ID,
		};
		const app = createWorkerApp(workerEnv, scopedDatabase, {
			fetch: tenant.fetch,
		});
		const call = (path: string, init: RequestInit = {}) => inDatabaseScope(workerEnv.HYPERDRIVE, () => handleApiRequest(new Request(`http://bt.test${path}`, init), app.context));
		const signIn = (idToken: string) => call("/api/v1/sign-in", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				idToken,
			}),
		});

		// The web app reads the tenant and app from the Worker, not a copy of its own.
		expect(await (await call("/api/v1/sign-in")).json()).toEqual({
			logto: {
				endpoint: TEST_LOGTO_ENDPOINT,
				appId: TEST_LOGTO_APP_ID,
			},
		});

		const subject = `logto-${crypto.randomUUID()}`;
		const res = await signIn(await tenant.sign({
			sub: subject,
		}));
		expect(res.status).toBe(200);
		const { token } = await res.json() as { token: string };
		expect(token.startsWith("dev:")).toBe(false);
		const me = await call("/api/v1/me", {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});
		expect(me.status).toBe(200);
		expect(await me.json()).toMatchObject({
			email: "fan@example.test",
		});

		// A dev: token is neither a Logto ID token nor, deployed, a session.
		expect((await signIn("dev:test-user")).status).toBe(401);
		expect((await call("/api/v1/me", {
			headers: {
				Authorization: "Bearer dev:test-user",
			},
		})).status).toBe(401);
		expect((await signIn(await tenant.sign({
			aud: "another-app",
		}))).status).toBe(401);
		expect((await call("/api/v1/sign-in", {
			method: "POST",
			body: "{}",
		})).status).toBe(400);
	});

	it("S116 AC 2: without Logto vars there is no Logto sign-in (local dev, previews, staging until its tenant exists)", async () =>
	{
		const workerEnv = env as unknown as WorkerEnv;
		const app = createWorkerApp(workerEnv, scopedDatabase);
		const call = (path: string, init: RequestInit = {}) => inDatabaseScope(workerEnv.HYPERDRIVE, () => handleApiRequest(new Request(`http://bt.test${path}`, init), app.context));
		expect(await (await call("/api/v1/sign-in")).json()).toEqual({
			logto: null,
		});
		expect((await call("/api/v1/sign-in", {
			method: "POST",
			body: JSON.stringify({
				idToken: "dev:test-user",
			}),
		})).status).toBe(404);
	});
});
