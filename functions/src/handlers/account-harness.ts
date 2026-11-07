/**
 * A real HTTP server over the API with signed-in accounts, for the download and
 * deletion route tests (S77, S80; the S46 `repository-contract.ts` precedent: a
 * test helper beside the code, not a copy in each test file).
 *
 * Sessions are BT-signed tokens from `signIn`, not `dev:` bearers: a `dev:`
 * bearer signs in afresh on every request, which would re-create a deleted
 * user. One clock drives the session signer, the deletion and the downloads,
 * so tests can step past the 10-minute, 24-hour and 14-day limits.
 */
import { createServer } from "node:http";
import {
	createDevAccountData, createDevAuth, DEV_EMAIL, StaticSecretsProvider,
} from "../adapters/fixtures/auth.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository,
	InMemoryGameRepository,
	InMemoryScheduleRepository,
	InMemorySettingsRepository,
} from "../adapters/memory/repos.js";
import { toNodeListener } from "../adapters/node/http.js";
import { signIn } from "../services/accounts.js";
import { createSessionSigner, SESSION_KEY_SECRET } from "../services/session.js";
import { handleApiRequest, type ApiContext } from "./api.js";

/** Where the shared clock starts. */
export const HARNESS_START = new Date("2026-10-27T12:00:00.000Z");

export type AccountHarness = {
	ctx: ApiContext;
	/** The dev account data, typed concretely so tests read the mailer's outbox and the identity admin. */
	account: ReturnType<typeof createDevAccountData>;
	/** Moves the shared clock forward. */
	advance(ms: number): void;
	/** Signs `uid` in now (a fresh `dev` identity link, with {@link DEV_EMAIL} unless `email` says otherwise) and returns its BT session token. */
	sessionFor(uid: string, email?: string): Promise<string>;
	get(path: string, token?: string): Promise<Response>;
	post(path: string, body: unknown, token?: string): Promise<Response>;
};

/** Runs `run` against a fresh server; `secrets` adds to the fixed session key (e.g. the app origin). */
export async function withAccountServer(run: (h: AccountHarness) => Promise<void>, secrets: Record<string, string> = {}): Promise<void>
{
	let now = HARNESS_START.getTime();
	const clock = () => new Date(now);
	const provider = new StaticSecretsProvider({
		[SESSION_KEY_SECRET]: "account-harness-key",
		...secrets,
	});
	const auth = {
		...createDevAuth(provider),
		sessions: createSessionSigner(provider, clock),
		now: clock,
	};
	const settings = new InMemorySettingsRepository();
	const account = {
		...createDevAccountData({
			users: auth.users,
			settings,
		}, provider),
		now: clock,
	};
	const ctx: ApiContext = {
		ingest: {
			mlb: new FixtureMlbStatsClient(),
			schedules: new InMemoryScheduleRepository(),
			games: new InMemoryGameRepository(),
			projections: new InMemoryGameProjectionRepository(),
		},
		auth,
		settings,
		account,
	};
	const listener = toNodeListener((request) => handleApiRequest(request, ctx));
	// No keep-alive: every harness signs the same session token (fixed key, clock and uid), so a pooled
	// connection to an earlier test's server on a reused port would answer for another test's users.
	const server = createServer((req, res) =>
	{
		res.shouldKeepAlive = false;
		return listener(req, res);
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const addr = server.address();
	if (!addr || typeof addr === "string") throw new Error("no port");
	const base = `http://127.0.0.1:${addr.port}`;
	const headers = (token?: string): Record<string, string> => (token ? {
		Authorization: `Bearer ${token}`,
	} : {});
	try
	{
		await run({
			ctx,
			account,
			advance: (ms) =>
			{
				now += ms;
			},
			sessionFor: async (uid, email = DEV_EMAIL) => (await signIn(auth, {
				provider: "dev",
				subject: uid,
				email,
				emailVerified: true,
				authTime: Math.floor(now / 1000),
			}, () => uid)).token,
			get: (path, token) => fetch(`${base}${path}`, {
				headers: headers(token),
			}),
			post: (path, body, token) => fetch(`${base}${path}`, {
				method: "POST",
				headers: {
					...headers(token),
					"Content-Type": "application/json",
				},
				body: typeof body === "string" ? body : JSON.stringify(body),
			}),
		});
	}
	finally
	{
		await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
	}
}
