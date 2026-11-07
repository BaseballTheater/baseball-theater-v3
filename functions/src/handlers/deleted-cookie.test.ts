/**
 * The deletion cookie (S87; standings-search-settings A5): a successful delete sets
 * it, `/api/v1/me` reports it once as `account_deleted`, and any `/me` that sees it
 * clears it (owner, 2026-10-29: "Until seen once"; "Drop it (clear on any /me)").
 * Requests go straight to the Fetch handler so they can carry a `Cookie` header.
 */
import { ACCOUNT_DELETION_PHRASE } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import { DELETED_COOKIE, DELETED_COOKIE_VALUE } from "../services/cookies.js";
import { withAccountServer } from "./account-harness.js";
import type { AccountHarness } from "./account-harness.js";
import { handleApiRequest } from "./api.js";

const COOKIE = `${DELETED_COOKIE}=${DELETED_COOKIE_VALUE}`;

function call(h: AccountHarness, method: string, path: string, opts: { token?: string;
	cookie?: string;
	body?: unknown;
	origin?: string; } = {}): Promise<Response>
{
	const headers = new Headers();
	if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
	if (opts.cookie) headers.set("Cookie", opts.cookie);
	if (opts.body !== undefined) headers.set("Content-Type", "application/json");
	return handleApiRequest(new Request(`${opts.origin ?? "http://localhost:8787"}${path}`, {
		method,
		headers,
		body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
	}), h.ctx);
}

const deleteAs = (h: AccountHarness, token: string, phrase = ACCOUNT_DELETION_PHRASE, origin?: string) => call(h, "POST", "/api/v1/me/delete", {
	token,
	body: {
		phrase,
	},
	origin,
});

describe("POST /api/v1/me/delete sets the deletion cookie (S87)", () =>
{
	it("delete: a successful deletion sets one HttpOnly, SameSite=Strict, Path=/ browser-session cookie, not Secure over http", async () =>
	{
		await withAccountServer(async (h) =>
		{
			const res = await deleteAs(h, await h.sessionFor("fan-1"));
			expect(res.status).toBe(200);
			const cookies = res.headers.getSetCookie();
			expect(cookies).toHaveLength(1);
			const [cookie] = cookies;
			expect(cookie).toMatch(new RegExp(`^${DELETED_COOKIE}=${DELETED_COOKIE_VALUE};`));
			expect(cookie).toContain("HttpOnly");
			expect(cookie).toContain("SameSite=Strict");
			expect(cookie).toContain("Path=/");
			expect(cookie).not.toMatch(/Max-Age|Expires/i);
			expect(cookie).not.toContain("Secure");
		});
	});

	it("delete: over HTTPS the cookie is also Secure", async () =>
	{
		await withAccountServer(async (h) =>
		{
			const res = await deleteAs(h, await h.sessionFor("fan-1"), ACCOUNT_DELETION_PHRASE, "https://next.baseball.theater");
			expect(res.headers.getSetCookie()[0]).toContain("Secure");
		});
	});

	it("delete: a refused deletion (400, 401) sets no cookie", async () =>
	{
		await withAccountServer(async (h) =>
		{
			const wrong = await deleteAs(h, await h.sessionFor("fan-1"), "nope");
			expect(wrong.status).toBe(400);
			expect(wrong.headers.getSetCookie()).toEqual([]);
			const anonymous = await call(h, "POST", "/api/v1/me/delete", {
				body: {
					phrase: ACCOUNT_DELETION_PHRASE,
				},
			});
			expect(anonymous.status).toBe(401);
			expect(anonymous.headers.getSetCookie()).toEqual([]);
		});
	});
});

describe("GET /api/v1/me reports it once (S87)", () =>
{
	it("/me: signed out with the cookie answers 401 account_deleted and clears it; without it, plain 401", async () =>
	{
		await withAccountServer(async (h) =>
		{
			const first = await call(h, "GET", "/api/v1/me", {
				cookie: COOKIE,
			});
			expect(first.status).toBe(401);
			expect(await first.json()).toEqual({
				error: "account_deleted",
			});
			expect(first.headers.getSetCookie()[0]).toMatch(new RegExp(`^${DELETED_COOKIE}=; Max-Age=0;.*HttpOnly`));

			const second = await call(h, "GET", "/api/v1/me");
			expect(second.status).toBe(401);
			expect(await second.json()).toEqual({
				error: "unauthorized",
			});
			expect(second.headers.getSetCookie()).toEqual([]);
		});
	});

	it("/me: the session of the deleted account itself, with the cookie, answers account_deleted", async () =>
	{
		await withAccountServer(async (h) =>
		{
			const token = await h.sessionFor("fan-1");
			expect((await deleteAs(h, token)).status).toBe(200);
			const res = await call(h, "GET", "/api/v1/me", {
				token,
				cookie: COOKIE,
			});
			expect(res.status).toBe(401);
			expect(await res.json()).toEqual({
				error: "account_deleted",
			});
		});
	});

	it("/me: signed in, the cookie is discarded and the account answers 200", async () =>
	{
		await withAccountServer(async (h) =>
		{
			const res = await call(h, "GET", "/api/v1/me", {
				token: await h.sessionFor("fan-2"),
				cookie: `other=1; ${COOKIE}`,
			});
			expect(res.status).toBe(200);
			expect(res.headers.getSetCookie()[0]).toMatch(new RegExp(`^${DELETED_COOKIE}=; Max-Age=0;`));
		});
	});
});

describe("the cookie names nothing personal (S87, ADR-028)", () =>
{
	it("marker: its value is a fixed marker, never the uid or the email", async () =>
	{
		await withAccountServer(async (h) =>
		{
			const res = await deleteAs(h, await h.sessionFor("fan-1", "fan-1@example.test"));
			const cookie = res.headers.getSetCookie()[0] ?? "";
			expect(cookie.split(";")[0]).toBe(`${DELETED_COOKIE}=${DELETED_COOKIE_VALUE}`);
			expect(cookie).not.toContain("fan-1");
		});
	});
});
