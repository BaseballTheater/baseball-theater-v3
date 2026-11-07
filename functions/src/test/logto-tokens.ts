/**
 * A stand-in Logto tenant for tests (S116): a key made locally, its JWKS served from a fetch
 * stand-in, and ID tokens signed with it. Nothing reaches Logto; the adapters under test see
 * the same JWKS route and token shape the real tenant serves.
 */
import type { webcrypto } from "node:crypto";

export const TEST_LOGTO_ENDPOINT = "https://auth.bt.test";
export const TEST_LOGTO_APP_ID = "test-spa-app";

export type TestTenant = {
	/** Signs `claims` over the default ID-token claims (issuer, audience, subject, email, a future expiry). */
	sign(claims?: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
	/** Serves `<endpoint>/oidc/jwks` with the tenant's public key; any other URL is a 404. */
	fetch(input: string): Promise<Response>;
	/** How many times the JWKS was fetched. */
	jwksFetches(): number;
};

function base64Url(bytes: Uint8Array | string): string
{
	const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
	let binary = "";
	for (const byte of data) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A tenant with one ES384 key (Logto's default) under `kid` "test-key". */
export async function createTestTenant(endpoint = TEST_LOGTO_ENDPOINT, appId = TEST_LOGTO_APP_ID): Promise<TestTenant>
{
	const pair = await crypto.subtle.generateKey({
		name: "ECDSA",
		namedCurve: "P-384",
	}, true, ["sign", "verify"]) as webcrypto.CryptoKeyPair;
	const jwk = {
		...await crypto.subtle.exportKey("jwk", pair.publicKey) as webcrypto.JsonWebKey,
		kid: "test-key",
		alg: "ES384",
		use: "sig",
	};
	let fetches = 0;
	return {
		async sign(claims = {}, header = {})
		{
			const now = Math.floor(Date.now() / 1000);
			const head = base64Url(JSON.stringify({
				alg: "ES384",
				typ: "JWT",
				kid: "test-key",
				...header,
			}));
			const body = base64Url(JSON.stringify({
				iss: `${endpoint}/oidc`,
				aud: appId,
				sub: "logto-user-1",
				email: "fan@example.test",
				email_verified: true,
				iat: now,
				exp: now + 3600,
				...claims,
			}));
			const signature = await crypto.subtle.sign({
				name: "ECDSA",
				hash: "SHA-384",
			}, pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
			return `${head}.${body}.${base64Url(new Uint8Array(signature))}`;
		},
		async fetch(input)
		{
			if (input !== `${endpoint}/oidc/jwks`) return new Response("not found", {
				status: 404,
			});
			fetches++;
			return Response.json({
				keys: [jwk],
			});
		},
		jwksFetches: () => fetches,
	};
}
