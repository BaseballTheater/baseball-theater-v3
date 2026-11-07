/**
 * The download routes over a real HTTP server (S80, ADR-028, owner 2026-10-27):
 * a request stores every registered store's export as a file that ages out in
 * 14 days and answers its id and expiry only; at most two requests in rolling
 * 24 hours; the file is its owner's alone; the account gets one email linking
 * to BT, never the data.
 */
import type {
	ApiErrorResponse, MeDownloadFileResponse, MeDownloadResponse,
} from "@bt/domain";
import { downloadExpiresAt } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import { DEV_EMAIL } from "../adapters/fixtures/auth.js";
import { APP_ORIGIN_SECRET, DEFAULT_APP_ORIGIN } from "../services/data-downloads.js";
import { DOWNLOADS_STORE, USERS_STORE } from "../services/personal-data.js";
import type { AccountHarness } from "./account-harness.js";
import { HARNESS_START, withAccountServer } from "./account-harness.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function requested(h: AccountHarness, token: string): Promise<MeDownloadResponse>
{
	const res = await h.post("/api/v1/me/download", {}, token);
	expect(res.status).toBe(200);
	return await res.json() as MeDownloadResponse;
}

describe("POST /api/v1/me/download", () =>
{
	it("request stores every registered store's export keyed by name, expiring 14 days on, and answers only its id and expiry", async () =>
	{
		await withAccountServer(async (h) =>
		{
			const token = await h.sessionFor("fan-1");
			const body = await requested(h, token);
			expect(body).toEqual({
				id: expect.any(String),
				expiresAt: downloadExpiresAt(HARNESS_START),
			});
			expect(body.expiresAt).toBe("2026-11-10T12:00:00.000Z");

			const file = await h.account.downloads.file("fan-1", body.id, HARNESS_START) as Record<string, unknown>;
			expect(Object.keys(file)).toEqual(h.account.stores.map((s) => s.name));
			expect(file[USERS_STORE]).toMatchObject({
				profile: {
					uid: "fan-1",
					email: DEV_EMAIL,
				},
			});
			// The download store exports records only, so no download holds a file; this one had nothing before it.
			expect(file[DOWNLOADS_STORE]).toBeNull();
		});
	});

	it("request is 401 signed out", async () =>
	{
		await withAccountServer(async (h) =>
		{
			expect((await h.post("/api/v1/me/download", {})).status).toBe(401);
			expect((await h.get("/api/v1/me/download")).status).toBe(401);
			expect((await h.get("/api/v1/me/download/anything")).status).toBe(401);
		});
	});

	it("refuses a third request inside rolling 24 hours with 429 and the next allowed time; 24 hours after the earliest succeeds", async () =>
	{
		await withAccountServer(async (h) =>
		{
			const token = await h.sessionFor("fan-1");
			await requested(h, token);
			h.advance(2 * HOUR);
			await requested(h, token);
			h.advance(HOUR);

			const refused = await h.post("/api/v1/me/download", {}, token);
			expect(refused.status).toBe(429);
			const nextAllowedAt = new Date(HARNESS_START.getTime() + DAY).toISOString();
			expect(await refused.json() as ApiErrorResponse).toEqual({
				error: "download_limit",
				hint: "two downloads per rolling 24 hours",
				nextAllowedAt,
			});
			// Another user's limit is their own.
			await requested(h, await h.sessionFor("fan-2"));

			h.advance(DAY - 3 * HOUR - 1);
			expect((await h.post("/api/v1/me/download", {}, token)).status).toBe(429);
			h.advance(1);
			await requested(h, token);
			expect(h.account.mailer.sent.filter((m) => m.uid === "fan-1")).toHaveLength(3);
		});
	});
});

describe("GET /api/v1/me/download and /:downloadId", () =>
{
	it("reads the current download (id and expiry) and fetches its file for its owner", async () =>
	{
		await withAccountServer(async (h) =>
		{
			const token = await h.sessionFor("fan-1");
			await requested(h, token);
			h.advance(HOUR);
			const newest = await requested(h, token);

			const current = await h.get("/api/v1/me/download", token);
			expect(current.status).toBe(200);
			expect(await current.json()).toEqual(newest);

			const res = await h.get(`/api/v1/me/download/${newest.id}`, token);
			expect(res.status).toBe(200);
			const file = await res.json() as MeDownloadFileResponse;
			expect(file.id).toBe(newest.id);
			expect(file.expiresAt).toBe(newest.expiresAt);
			expect(Object.keys(file.stores)).toEqual(h.account.stores.map((s) => s.name));
			// The newer download lists the earlier one's record, not its file.
			expect(file.stores[DOWNLOADS_STORE]).toEqual([expect.objectContaining({
				uid: "fan-1",
				createdAt: HARNESS_START.toISOString(),
			})]);
		});
	});

	it("current download and file are 404 for another user, an expired download, or none", async () =>
	{
		await withAccountServer(async (h) =>
		{
			const token = await h.sessionFor("fan-1");
			// None.
			expect((await h.get("/api/v1/me/download", token)).status).toBe(404);
			expect((await h.get("/api/v1/me/download/no-such-download", token)).status).toBe(404);

			const { id } = await requested(h, token);
			// Another user.
			const other = await h.sessionFor("fan-2");
			expect((await h.get(`/api/v1/me/download/${id}`, other)).status).toBe(404);
			expect((await h.get("/api/v1/me/download", other)).status).toBe(404);

			// Expired: fetchable until 14 days on, gone at that instant (signed in afresh: a session doesn't last 14 days).
			h.advance(14 * DAY - 1);
			const later = await h.sessionFor("fan-1");
			expect((await h.get(`/api/v1/me/download/${id}`, later)).status).toBe(200);
			h.advance(1);
			expect((await h.get(`/api/v1/me/download/${id}`, later)).status).toBe(404);
			expect((await h.get("/api/v1/me/download", later)).status).toBe(404);
			expect(await h.account.downloads.file("fan-1", id, new Date(HARNESS_START.getTime() + 14 * DAY))).toBeNull();
		});
	});
});

describe("download email", () =>
{
	it("sends one email to the account's address with a link to BT's Settings and no exported data", async () =>
	{
		await withAccountServer(async (h) =>
		{
			const token = await h.sessionFor("fan-1");
			const { id, expiresAt } = await requested(h, token);
			expect(h.account.mailer.sent).toHaveLength(1);
			const [message] = h.account.mailer.sent;
			expect(message).toMatchObject({
				uid: "fan-1",
				to: DEV_EMAIL,
			});
			expect(message!.text).toContain(`${DEFAULT_APP_ORIGIN}/settings`);
			expect(message!.text).toContain(expiresAt);
			// No data: not the file, its profile, its id, nor the address in the body.
			for (const leak of [id, "fan-1", DEV_EMAIL, "identities", "profile", "{"]) expect(message!.text).not.toContain(leak);
			expect(message!.subject).not.toContain("fan-1");
		});
	});

	it("links to the configured app origin", async () =>
	{
		await withAccountServer(async (h) =>
		{
			await requested(h, await h.sessionFor("fan-1"));
			expect(h.account.mailer.sent[0]!.text).toContain("https://next.baseball.theater/settings");
		}, {
			[APP_ORIGIN_SECRET]: "https://next.baseball.theater",
		});
	});

	it("sends the download-ready email for every successful request: every account has an address (S82)", async () =>
	{
		await withAccountServer(async (h) =>
		{
			const token = await h.sessionFor("fan-1", "fan-1@example.test");
			await requested(h, token);
			await requested(h, token);
			expect(h.account.mailer.sent.map((m) => m.to)).toEqual(["fan-1@example.test", "fan-1@example.test"]);
		});
	});
});
