/**
 * Sign-in through Logto (S116; ADR-019): the `IdentityProvider` that turns the ID token Logto's
 * hosted sign-in gave the web app into BT's `IdentityClaims`. It checks the token itself, with
 * the Web Crypto API both Workers and Node have, so the Worker carries no JWT library: the
 * signature against the tenant's published keys (`<endpoint>/oidc/jwks`), the issuer
 * (`<endpoint>/oidc`), the audience (the web app's ID) and the expiry. Logto signs ID tokens with
 * an EC key (ES384 by default) and can be set to RSA, so both families verify.
 *
 * The keys are fetched once per isolate and fetched again when a token names a key id the cached
 * set doesn't hold, which is how a tenant's key rotation reaches a running Worker.
 */
// Types only (erased at build): the Web Crypto shapes, which Workers and Node share; the repo builds without the DOM lib.
import type { webcrypto } from "node:crypto";
import type { IdentityClaims, IdentityProvider } from "@bt/ports";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type LogtoSignInConfig = {
	/** The tenant's address as the web app reaches it, e.g. `https://auth.baseball.theater` (no trailing slash needed). */
	endpoint: string;
	/** The single-page app's ID: the audience every ID token must carry. */
	appId: string;
	/** Tests pass a stand-in that serves a locally made key; the Worker uses the global `fetch`. */
	fetch?: Fetch;
	now?: () => Date;
};

/** One key of a JSON Web Key Set, as `<endpoint>/oidc/jwks` lists it. */
type Jwk = webcrypto.JsonWebKey & { kid?: string };

/** Why an ID token was refused; the sign-in route answers it as a refused sign-in. */
export class IdTokenError extends Error
{
	constructor(reason: string)
	{
		super(`Logto ID token refused: ${reason}`);
		this.name = "IdTokenError";
	}
}

/** How each JWS `alg` Logto may use verifies with Web Crypto. */
const ALGORITHMS: Record<string, { import: webcrypto.EcKeyImportParams | webcrypto.RsaHashedImportParams;
	verify: webcrypto.EcdsaParams | webcrypto.AlgorithmIdentifier; }> = {
	ES256: {
		import: {
			name: "ECDSA",
			namedCurve: "P-256",
		},
		verify: {
			name: "ECDSA",
			hash: "SHA-256",
		},
	},
	ES384: {
		import: {
			name: "ECDSA",
			namedCurve: "P-384",
		},
		verify: {
			name: "ECDSA",
			hash: "SHA-384",
		},
	},
	ES512: {
		import: {
			name: "ECDSA",
			namedCurve: "P-521",
		},
		verify: {
			name: "ECDSA",
			hash: "SHA-512",
		},
	},
	RS256: {
		import: {
			name: "RSASSA-PKCS1-v1_5",
			hash: "SHA-256",
		},
		verify: {
			name: "RSASSA-PKCS1-v1_5",
		},
	},
	RS384: {
		import: {
			name: "RSASSA-PKCS1-v1_5",
			hash: "SHA-384",
		},
		verify: {
			name: "RSASSA-PKCS1-v1_5",
		},
	},
	RS512: {
		import: {
			name: "RSASSA-PKCS1-v1_5",
			hash: "SHA-512",
		},
		verify: {
			name: "RSASSA-PKCS1-v1_5",
		},
	},
};

/** A little clock slack for `exp`, so a token checked a moment after it was minted elsewhere isn't refused for drift. */
const CLOCK_SKEW_SECONDS = 60;

function base64UrlBytes(part: string): Uint8Array<ArrayBuffer>
{
	const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
	const binary = atob(base64);
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function base64UrlJson(part: string): Record<string, unknown>
{
	const value = JSON.parse(new TextDecoder().decode(base64UrlBytes(part))) as unknown;
	if (value === null || typeof value !== "object") throw new IdTokenError("a part is not a JSON object");
	return value as Record<string, unknown>;
}

/** `endpoint` without a trailing slash, so the issuer compares exactly. */
function trimEndpoint(endpoint: string): string
{
	return endpoint.replace(/\/+$/, "");
}

export class LogtoIdentityProvider implements IdentityProvider
{
	private keys: Jwk[] | undefined;
	private readonly endpoint: string;

	constructor(private readonly config: LogtoSignInConfig)
	{
		this.endpoint = trimEndpoint(config.endpoint);
	}

	/** The tenant's issuer, `<endpoint>/oidc`, which every ID token must name. */
	get issuer(): string
	{
		return `${this.endpoint}/oidc`;
	}

	async completeSignIn(credential: string): Promise<IdentityClaims>
	{
		const parts = credential.split(".");
		if (parts.length !== 3) throw new IdTokenError("not a JWT");
		const [headerPart = "", payloadPart = "", signaturePart = ""] = parts;
		const header = base64UrlJson(headerPart);
		const alg = typeof header.alg === "string" ? ALGORITHMS[header.alg] : undefined;
		if (!alg) throw new IdTokenError(`unsupported alg ${String(header.alg)}`);
		const key = await this.keyFor(typeof header.kid === "string" ? header.kid : undefined);
		const cryptoKey = await crypto.subtle.importKey("jwk", key, alg.import, false, ["verify"]);
		const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
		if (!await crypto.subtle.verify(alg.verify, cryptoKey, base64UrlBytes(signaturePart), signed)) throw new IdTokenError("bad signature");

		const claims = base64UrlJson(payloadPart);
		if (claims.iss !== this.issuer) throw new IdTokenError(`issuer ${String(claims.iss)} is not ${this.issuer}`);
		const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
		if (!audiences.includes(this.config.appId)) throw new IdTokenError("audience is not this app");
		const now = Math.floor((this.config.now?.() ?? new Date()).getTime() / 1000);
		if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < now) throw new IdTokenError("expired");
		if (typeof claims.sub !== "string" || !claims.sub) throw new IdTokenError("no subject");
		// Requested with the `email` scope (web AuthClient); BT refuses an account without one (S82).
		if (typeof claims.email !== "string" || !claims.email.trim()) throw new IdTokenError("no email");
		return {
			provider: "logto",
			subject: claims.sub,
			email: claims.email,
			emailVerified: claims.email_verified === true,
		};
	}

	/** The key `kid` names (or the only key when the token names none), refetching the set once when it's unknown. */
	private async keyFor(kid: string | undefined): Promise<Jwk>
	{
		const pick = (keys: Jwk[]) => (kid === undefined ? (keys.length === 1 ? keys[0] : undefined) : keys.find((key) => key.kid === kid));
		let key = this.keys ? pick(this.keys) : undefined;
		if (!key)
		{
			this.keys = await this.fetchKeys();
			key = pick(this.keys);
		}
		if (!key) throw new IdTokenError(`no published key ${kid ?? ""}`.trim());
		return key;
	}

	private async fetchKeys(): Promise<Jwk[]>
	{
		const response = await (this.config.fetch ?? fetch)(`${this.endpoint}/oidc/jwks`);
		if (!response.ok) throw new Error(`Logto JWKS: ${response.status}`);
		const body = await response.json() as { keys?: Jwk[] };
		return body.keys ?? [];
	}
}
