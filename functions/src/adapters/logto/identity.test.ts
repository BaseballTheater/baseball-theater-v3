/**
 * S116 AC 1: the Logto `IdentityProvider` checks an ID token's signature against the tenant's
 * JWKS, its issuer, audience and expiry, and needs an email. Tokens are signed with a locally
 * made key whose JWKS a fetch stand-in serves; nothing reaches Logto.
 */
import {
	describe, expect, it,
} from "vitest";
import {
	createTestTenant, TEST_LOGTO_APP_ID, TEST_LOGTO_ENDPOINT,
} from "../../test/logto-tokens.js";
import { IdTokenError, LogtoIdentityProvider } from "./identity.js";

async function setup()
{
	const tenant = await createTestTenant();
	const provider = new LogtoIdentityProvider({
		endpoint: `${TEST_LOGTO_ENDPOINT}/`,
		appId: TEST_LOGTO_APP_ID,
		fetch: tenant.fetch,
	});
	return {
		tenant,
		provider,
	};
}

describe("LogtoIdentityProvider (S116)", () =>
{
	it("S116 AC 1: a valid ID token signs in as { provider: logto, subject: sub, email, emailVerified }", async () =>
	{
		const { tenant, provider } = await setup();
		expect(provider.issuer).toBe(`${TEST_LOGTO_ENDPOINT}/oidc`);
		expect(await provider.completeSignIn(await tenant.sign())).toEqual({
			provider: "logto",
			subject: "logto-user-1",
			email: "fan@example.test",
			emailVerified: true,
		});
		// An unverified address passes through as unverified; an audience list that holds the app is fine.
		expect(await provider.completeSignIn(await tenant.sign({
			email_verified: false,
			aud: ["other", TEST_LOGTO_APP_ID],
		}))).toMatchObject({
			emailVerified: false,
		});
		// The keys are fetched once and reused.
		expect(tenant.jwksFetches()).toBe(1);
	});

	it("S116 AC 1: refuses a bad signature, issuer, audience, an expired token and a token without an email", async () =>
	{
		const { tenant, provider } = await setup();
		const other = await createTestTenant();
		const now = Math.floor(Date.now() / 1000);
		const refused = [
			await other.sign(),
			await tenant.sign({
				iss: "https://evil.test/oidc",
			}),
			await tenant.sign({
				aud: "another-app",
			}),
			await tenant.sign({
				exp: now - 3600,
			}),
			await tenant.sign({
				email: undefined,
			}),
			await tenant.sign({
				email: " ",
			}),
			await tenant.sign({
				sub: "",
			}),
			await tenant.sign({}, {
				alg: "none",
			}),
			await tenant.sign({}, {
				kid: "rotated-away",
			}),
			"not-a-jwt",
			"e30.bnVsbA.sig",
		];
		for (const token of refused)
		{
			await expect(provider.completeSignIn(token), token).rejects.toThrow(IdTokenError);
		}
	});

	it("S116 AC 1: a JWKS the tenant can't serve fails the sign-in", async () =>
	{
		const tenant = await createTestTenant();
		const provider = new LogtoIdentityProvider({
			endpoint: "https://elsewhere.test",
			appId: TEST_LOGTO_APP_ID,
			fetch: tenant.fetch,
		});
		await expect(provider.completeSignIn(await tenant.sign())).rejects.toThrow(/JWKS: 404/);
	});
});
