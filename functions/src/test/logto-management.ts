/**
 * A stand-in for one Logto tenant's Management API (S116 AC 4, AC 5): the client-credentials
 * token endpoint, users, one application and the sign-in experience, kept in memory, with every
 * request recorded. Nothing reaches Logto.
 */

export type ManagementCall = { method: string;
	path: string;
	body?: unknown; };

export type StandInUser = { id: string;
	primaryEmail: string | null;
	isSuspended: boolean; };

export type ManagementStandIn = {
	fetch(input: string, init?: RequestInit): Promise<Response>;
	calls: ManagementCall[];
	users: Map<string, StandInUser>;
	applications: Map<string, { oidcClientMetadata: { redirectUris: string[];
		postLogoutRedirectUris: string[]; }; }>;
	signInExperience: Record<string, unknown>;
	tokensIssued(): number;
};

/** A tenant `tenantId` whose machine-to-machine app is `appId` / `secret`; a token request with other credentials is a 401. */
export function createManagementStandIn(tenantId: string, appId = "m2m-app", secret = "m2m-secret"): ManagementStandIn
{
	const base = `https://${tenantId}.logto.app`;
	let tokens = 0;
	const state: ManagementStandIn = {
		calls: [],
		users: new Map(),
		applications: new Map(),
		signInExperience: {
			signUp: {
				identifiers: ["username"],
				password: true,
				verify: false,
			},
			signIn: {
				methods: [],
			},
			color: {
				primaryColor: "#000000",
			},
		},
		tokensIssued: () => tokens,
		async fetch(input, init = {})
		{
			const method = init.method ?? "GET";
			const url = new URL(input);
			const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) as unknown : undefined;
			state.calls.push({
				method,
				path: `${url.pathname}${url.search}`,
				...body !== undefined && {
					body,
				},
			});
			if (url.origin !== base) return new Response("wrong host", {
				status: 421,
			});
			if (url.pathname === "/oidc/token")
			{
				const form = new URLSearchParams(String(init.body));
				const auth = new Headers(init.headers).get("Authorization");
				if (auth !== `Basic ${btoa(`${appId}:${secret}`)}` || form.get("grant_type") !== "client_credentials" || form.get("resource") !== `${base}/api` || form.get("scope") !== "all")
				{
					return new Response("invalid_client", {
						status: 401,
					});
				}
				tokens++;
				return Response.json({
					access_token: `token-${tokens}`,
					expires_in: 3600,
				});
			}
			if (!new Headers(init.headers).get("Authorization")?.startsWith("Bearer token-")) return new Response("unauthorized", {
				status: 401,
			});
			const users = /^\/api\/users$/.exec(url.pathname);
			if (users && method === "GET")
			{
				const page = Number(url.searchParams.get("page") ?? 1);
				const size = Number(url.searchParams.get("page_size") ?? 20);
				return Response.json([...state.users.values()].slice((page - 1) * size, page * size));
			}
			const user = /^\/api\/users\/([^/]+)(\/is-suspended)?$/.exec(url.pathname);
			if (user)
			{
				const id = decodeURIComponent(user[1]!);
				const found = state.users.get(id);
				if (!found) return new Response("not found", {
					status: 404,
				});
				if (user[2] && method === "PATCH")
				{
					found.isSuspended = (body as { isSuspended: boolean }).isSuspended;
					return Response.json(found);
				}
				if (!user[2] && method === "DELETE")
				{
					state.users.delete(id);
					return new Response(null, {
						status: 204,
					});
				}
			}
			const app = /^\/api\/applications\/([^/]+)$/.exec(url.pathname);
			if (app)
			{
				const found = state.applications.get(decodeURIComponent(app[1]!));
				if (!found) return new Response("not found", {
					status: 404,
				});
				if (method === "PATCH")
				{
					const patch = body as { oidcClientMetadata: typeof found.oidcClientMetadata };
					found.oidcClientMetadata = {
						...found.oidcClientMetadata,
						...patch.oidcClientMetadata,
					};
				}
				return Response.json(found);
			}
			if (url.pathname === "/api/sign-in-exp")
			{
				if (method === "PATCH") Object.assign(state.signInExperience, body);
				return Response.json(state.signInExperience);
			}
			return new Response("not found", {
				status: 404,
			});
		},
	};
	return state;
}
