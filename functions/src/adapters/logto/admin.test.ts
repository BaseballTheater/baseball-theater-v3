/**
 * S116 AC 4: the Logto `IdentityAdmin` lists, suspends and deletes accounts through the
 * Management API with the machine-to-machine app's client-credentials token. A stand-in tenant
 * answers; nothing reaches Logto.
 */
import {
	describe, expect, it,
} from "vitest";
import { createManagementStandIn } from "../../test/logto-management.js";
import { LogtoIdentityAdmin, LogtoManagementApi } from "./admin.js";

function setup(secret = "m2m-secret", now?: () => Date)
{
	const tenant = createManagementStandIn("tenant1");
	const api = new LogtoManagementApi({
		tenantId: "tenant1",
		appId: "m2m-app",
		secret,
		fetch: tenant.fetch,
		...now && {
			now,
		},
	});
	return {
		tenant,
		api,
		admin: new LogtoIdentityAdmin(api),
	};
}

describe("LogtoIdentityAdmin (S116)", () =>
{
	it("S116 AC 4: lists every account across pages, suspends one and deletes one, with one token", async () =>
	{
		const { tenant, admin } = setup();
		for (let i = 0; i < 101; i++) tenant.users.set(`u${i}`, {
			id: `u${i}`,
			primaryEmail: i === 0 ? null : `fan${i}@example.test`,
			isSuspended: false,
		});
		expect(admin.provider).toBe("logto");
		const accounts = await admin.listAccounts();
		expect(accounts).toHaveLength(101);
		expect(accounts[0]).toEqual({
			subject: "u0",
			email: "",
			disabled: false,
		});
		await admin.disableAccount("u1");
		expect(tenant.users.get("u1")?.isSuspended).toBe(true);
		expect(tenant.calls).toContainEqual({
			method: "PATCH",
			path: "/api/users/u1/is-suspended",
			body: {
				isSuspended: true,
			},
		});
		await admin.deleteAccount("u2");
		expect(tenant.users.has("u2")).toBe(false);
		expect(tenant.calls).toContainEqual({
			method: "DELETE",
			path: "/api/users/u2",
		});
		// Deleting an account that's already gone succeeds, so a retried deletion doesn't fail here.
		await admin.deleteAccount("u2");
		expect(tenant.tokensIssued()).toBe(1);
	});

	it("S116 AC 4: refreshes the token near its expiry and fails on bad credentials or a failed call", async () =>
	{
		let clock = new Date("2026-11-07T00:00:00Z");
		const { tenant, admin } = setup("m2m-secret", () => clock);
		await admin.listAccounts();
		clock = new Date(clock.getTime() + 3600_000);
		await admin.listAccounts();
		expect(tenant.tokensIssued()).toBe(2);
		await expect(admin.disableAccount("missing")).rejects.toThrow(/PATCH \/api\/users\/missing\/is-suspended: 404/);

		const wrong = setup("wrong-secret");
		await expect(wrong.admin.listAccounts()).rejects.toThrow(/Logto token: 401/);
	});
});
