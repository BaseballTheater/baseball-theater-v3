/**
 * S116 AC 5: production's deploy registers the web app's redirect and sign-out addresses (from
 * production's `BT_APP_ORIGIN`) and the email one-time-code sign-in through the Management API,
 * idempotently: run twice against a stand-in tenant, the second run changes nothing.
 */
import { readFileSync } from "node:fs";
import {
	describe, expect, it,
} from "vitest";
import { LogtoManagementApi } from "../adapters/logto/admin.js";
import { createManagementStandIn } from "../test/logto-management.js";
import { parseWranglerConfig } from "./bootstrap.js";
import {
	EMAIL_CODE_SIGN_IN, productionLogtoTarget, registerLogtoApp,
} from "./logto.js";

const WRANGLER = parseWranglerConfig(readFileSync(new URL("../../../wrangler.jsonc", import.meta.url), "utf8"));

describe("production's Logto app settings (S116)", () =>
{
	it("S116 AC 5: production's target comes from env.production in wrangler.jsonc, and only production names a Logto tenant", () =>
	{
		const target = productionLogtoTarget(WRANGLER);
		expect(target).toEqual({
			appId: WRANGLER.env!.production!.vars!.LOGTO_APP_ID,
			origin: "https://next.baseball.theater",
			tenantId: "rnrngs",
		});
		expect(WRANGLER.env!.production!.vars!.LOGTO_ENDPOINT).toBe("https://auth.baseball.theater");
		for (const env of ["preview", "staging"] as const)
		{
			expect(Object.keys(WRANGLER.env![env]!.vars!).filter((name) => name.startsWith("LOGTO"))).toEqual([]);
		}
		expect(() => productionLogtoTarget({
			env: {
				production: {
					vars: {
						BT_APP_ORIGIN: "https://x.test",
					},
				},
			},
		})).toThrow(/names no LOGTO_APP_ID, LOGTO_TENANT_ID/);
	});

	it("S116 AC 5: run twice, the first sets the URIs and the email code sign-in and the second changes nothing", async () =>
	{
		const tenant = createManagementStandIn("rnrngs");
		tenant.applications.set("spa", {
			oidcClientMetadata: {
				redirectUris: [],
				postLogoutRedirectUris: [],
			},
		});
		const api = new LogtoManagementApi({
			tenantId: "rnrngs",
			appId: "m2m-app",
			secret: "m2m-secret",
			fetch: tenant.fetch,
		});
		const target = {
			appId: "spa",
			origin: "https://next.baseball.theater",
			tenantId: "rnrngs",
		};

		expect(await registerLogtoApp(api, target)).toEqual(["redirect and sign-out URIs for https://next.baseball.theater", "email one-time-code sign-in"]);
		expect(tenant.applications.get("spa")!.oidcClientMetadata).toEqual({
			redirectUris: ["https://next.baseball.theater/sign-in/callback"],
			postLogoutRedirectUris: ["https://next.baseball.theater/", "https://next.baseball.theater/settings"],
		});
		expect(tenant.signInExperience.signIn).toEqual(EMAIL_CODE_SIGN_IN);
		expect(tenant.signInExperience.signUp).toEqual({
			identifiers: ["email"],
			password: false,
			verify: true,
		});
		// What BT doesn't set is left as it was.
		expect(tenant.signInExperience.color).toEqual({
			primaryColor: "#000000",
		});

		const writes = () => tenant.calls.filter((call) => call.method !== "GET" && !call.path.startsWith("/oidc/"));
		const before = writes().length;
		expect(await registerLogtoApp(api, target)).toEqual([]);
		expect(writes().length).toBe(before);
		// Every call went to the tenant's own address; none to the custom domain.
		expect(tenant.calls.every((call) => call.path.startsWith("/api/") || call.path === "/oidc/token")).toBe(true);
	});
});
