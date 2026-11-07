/**
 * Logto's Management API (S116 AC 4, AC 5; ADR-019), reached by production's one
 * machine-to-machine app: the `IdentityAdmin` that lists, suspends and deletes fans' Logto
 * accounts (account deletion, S77, reaches Logto through it), and the calls production's deploy
 * makes to register the web app's addresses (`src/deploy/logto.ts`).
 *
 * Logto Cloud's Management API can't be reached through a custom domain (Logto docs, "Interact
 * with Management API", checked 2026-11-07): the token comes from the tenant's own address,
 * `https://<tenant>.logto.app/oidc/token`, with the client-credentials grant for the resource
 * `https://<tenant>.logto.app/api` and scope `all`, and every call goes to that address too. So
 * this takes the tenant ID (`LOGTO_TENANT_ID`, production's `rnrngs`), not `LOGTO_ENDPOINT`.
 */
import type { IdentityAccount, IdentityAdmin } from "@bt/ports";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type LogtoManagementConfig = {
	/** The tenant's ID, the first label of its `*.logto.app` address. */
	tenantId: string;
	/** The machine-to-machine app's ID and secret (Worker secrets `LOGTO_S2S_APP_ID`, `LOGTO_S2S_SECRET`). */
	appId: string;
	secret: string;
	/** Tests pass a stand-in; the Worker and the deploy script use the global `fetch`. */
	fetch?: Fetch;
	now?: () => Date;
};

/** Refresh the token this long before Logto says it expires, so a call never carries a stale one. */
const TOKEN_MARGIN_MS = 60_000;

/** Logto's largest page of users. */
const PAGE_SIZE = 100;

/**
 * An authenticated client for one tenant's Management API. The access token is fetched on the
 * first call and reused until shortly before it expires.
 */
export class LogtoManagementApi
{
	private token: { value: string;
		expiresAt: number; } | undefined;

	constructor(private readonly config: LogtoManagementConfig) {}

	/** `https://<tenant>.logto.app`, where the token endpoint and every Management API call live. */
	get base(): string
	{
		return `https://${this.config.tenantId}.logto.app`;
	}

	private get fetch(): Fetch
	{
		return this.config.fetch ?? fetch;
	}

	private now(): number
	{
		return (this.config.now?.() ?? new Date()).getTime();
	}

	/** The Management API access token from the client-credentials grant, cached until near its expiry. */
	async accessToken(): Promise<string>
	{
		if (this.token && this.token.expiresAt > this.now()) return this.token.value;
		const response = await this.fetch(`${this.base}/oidc/token`, {
			method: "POST",
			headers: {
				"Authorization": `Basic ${btoa(`${this.config.appId}:${this.config.secret}`)}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "client_credentials",
				resource: `${this.base}/api`,
				scope: "all",
			}).toString(),
		});
		if (!response.ok) throw new Error(`Logto token: ${response.status} ${await response.text()}`);
		const body = await response.json() as { access_token: string;
			expires_in?: number; };
		this.token = {
			value: body.access_token,
			expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 - TOKEN_MARGIN_MS,
		};
		return body.access_token;
	}

	/**
	 * One Management API call: `path` under `/api`, JSON in and out. Answers the raw response so
	 * callers can read headers or treat a status as success; any other non-OK status throws.
	 */
	async call(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<Response>
	{
		const response = await this.fetch(`${this.base}/api${path}`, {
			method,
			headers: {
				"Authorization": `Bearer ${await this.accessToken()}`,
				...body !== undefined && {
					"Content-Type": "application/json",
				},
			},
			...body !== undefined && {
				body: JSON.stringify(body),
			},
		});
		if (!response.ok && !okStatuses.includes(response.status)) throw new Error(`Logto ${method} /api${path}: ${response.status} ${await response.text()}`);
		return response;
	}

	/** A JSON answer from {@link call}. */
	async json<T>(method: string, path: string, body?: unknown): Promise<T>
	{
		return await (await this.call(method, path, body)).json() as T;
	}
}

/** A user as `GET /api/users` lists them (the fields BT reads). */
type LogtoUser = {
	id: string;
	primaryEmail: string | null;
	isSuspended: boolean;
};

/**
 * The `IdentityAdmin` for Logto accounts (provider `"logto"`): `GET /api/users`,
 * `PATCH /api/users/{id}/is-suspended` and `DELETE /api/users/{id}`. Composed only where
 * production's machine-to-machine secret is set (`worker-app.ts`).
 */
export class LogtoIdentityAdmin implements IdentityAdmin
{
	readonly provider = "logto";

	constructor(private readonly api: LogtoManagementApi) {}

	/** Every account, page by page until a page comes back short. */
	async listAccounts(): Promise<IdentityAccount[]>
	{
		const accounts: IdentityAccount[] = [];
		for (let page = 1; ; page++)
		{
			const users = await this.api.json<LogtoUser[]>("GET", `/users?page=${page}&page_size=${PAGE_SIZE}`);
			accounts.push(...users.map((user) => ({
				subject: user.id,
				email: user.primaryEmail ?? "",
				disabled: user.isSuspended,
			})));
			if (users.length < PAGE_SIZE) return accounts;
		}
	}

	/** Suspends the account: Logto refuses its sign-ins from then on. */
	async disableAccount(subject: string): Promise<void>
	{
		await this.api.call("PATCH", `/users/${encodeURIComponent(subject)}/is-suspended`, {
			isSuspended: true,
		});
	}

	/**
	 * Deletes the account for good. An account that is already gone (404) counts as deleted, so a
	 * deletion retried after a later step failed (S77) doesn't fail here.
	 */
	async deleteAccount(subject: string): Promise<void>
	{
		await this.api.call("DELETE", `/users/${encodeURIComponent(subject)}`, undefined, [404]);
	}
}
