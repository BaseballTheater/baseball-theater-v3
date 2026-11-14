import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, renderHook, waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { stubMeApi } from "../test/meApi.js";
import type { AuthClientLoader } from "./SessionProvider.js";
import { SessionProvider } from "./SessionProvider.js";
import type { LogtoSdk } from "./AuthClient.js";
import { createAuthClient } from "./AuthClient.js";
import {
	ACCOUNT_QUERY_KEY, DEV_SIGN_IN_TOKEN, useSession,
} from "./session.js";
import type * as StorageModule from "../storage/storage.js";
import { clearPersonalData } from "../storage/storage.js";
import { getSessionToken, setSessionToken } from "./token.js";

// The real storage, with clearPersonalData watched so sign-out can be shown to call it (ADR-028).
vi.mock("../storage/storage.js", async (importOriginal) =>
{
	const actual = await importOriginal<typeof StorageModule>();
	return {
		...actual,
		clearPersonalData: vi.fn(actual.clearPersonalData),
	};
});

function renderSession(queryClient = createQueryClient(), authClient?: AuthClientLoader)
{
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>
			<SessionProvider {...authClient && {
				authClient,
			}}>{children}</SessionProvider>
		</QueryClientProvider>
	);
	return renderHook(() => useSession(), {
		wrapper,
	});
}

beforeEach(() =>
{
	setSessionToken(null);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("SessionProvider", () =>
{
	it("starts signed out without asking the server when no token is stored", () =>
	{
		const fetchMock = stubMeApi();
		const { result } = renderSession();
		expect(result.current.status).toBe("signedOut");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("reads GET /api/v1/me with the stored token, through the client's middleware", async () =>
	{
		const fetchMock = stubMeApi();
		setSessionToken(DEV_SIGN_IN_TOKEN);
		const { result } = renderSession();
		expect(result.current.status).toBe("loading");
		await waitFor(() => expect(result.current.status).toBe("signedIn"));
		expect(result.current.status === "signedIn" && result.current.account).toMatchObject({
			uid: "test-user",
			email: "dev@local.test",
		});
		const request = fetchMock.mock.calls[0]?.[0] as Request;
		expect(new URL(request.url).pathname).toBe("/api/v1/me");
		expect(request.headers.get("Authorization")).toBe(`Bearer ${DEV_SIGN_IN_TOKEN}`);
	});

	it("reads a 401 as signed out and drops the stale token", async () =>
	{
		stubMeApi();
		setSessionToken("expired-session");
		const { result } = renderSession();
		await waitFor(() => expect(result.current.status).toBe("signedOut"));
		expect(getSessionToken()).toBeNull();
	});

	it("counts an unreachable server as signed out for now, keeping the token to retry later", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 503)));
		setSessionToken(DEV_SIGN_IN_TOKEN);
		const { result } = renderSession();
		await waitFor(() => expect(result.current.status).toBe("signedOut"));
		expect(getSessionToken()).toBe(DEV_SIGN_IN_TOKEN);
	});

	it("signs in as dev:test-user in development and invalidates account queries", async () =>
	{
		stubMeApi();
		const queryClient = createQueryClient();
		queryClient.setQueryData([...ACCOUNT_QUERY_KEY, "settings"], {
			hideScores: false,
		});
		const { result } = renderSession(queryClient);
		let leaving: boolean | undefined;
		await act(async () =>
		{
			leaving = await result.current.signIn();
		});
		// The page stays: a caller showing progress puts its control back.
		expect(leaving).toBe(false);
		expect(result.current.status).toBe("signedIn");
		expect(getSessionToken()).toBe(DEV_SIGN_IN_TOKEN);
		expect(queryClient.getQueryState([...ACCOUNT_QUERY_KEY, "settings"])?.isInvalidated).toBe(true);
	});

	it("S116 AC 3: does nothing on signIn() in a production build whose Worker offers no Logto (previews)", async () =>
	{
		vi.stubEnv("PROD", true);
		const fetchMock = vi.fn(async (request: Request) => (new URL(request.url).pathname === "/api/v1/sign-in" ? jsonResponse({
			logto: null,
		}) : jsonResponse({}, 401)));
		vi.stubGlobal("fetch", fetchMock);
		const { result } = renderSession();
		let leaving: boolean | undefined;
		await act(async () =>
		{
			leaving = await result.current.signIn();
		});
		expect(leaving).toBe(false);
		expect(result.current.status).toBe("signedOut");
		expect(getSessionToken()).toBeNull();
		expect(fetchMock.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual(["/api/v1/sign-in"]);
	});

	it("sign-out clears the session and every personal browser key, and removes account queries, keeping game data", async () =>
	{
		stubMeApi();
		setSessionToken(DEV_SIGN_IN_TOKEN);
		const queryClient = createQueryClient();
		queryClient.setQueryData([...ACCOUNT_QUERY_KEY, "settings"], {
			hideScores: true,
		});
		queryClient.setQueryData(["game", 744834], {
			gamePk: 744834,
		});
		const { result } = renderSession(queryClient);
		await waitFor(() => expect(result.current.status).toBe("signedIn"));

		act(() => result.current.signOut());
		expect(result.current.status).toBe("signedOut");
		expect(getSessionToken()).toBeNull();
		expect(clearPersonalData).toHaveBeenCalledOnce();
		expect(queryClient.getQueryData([...ACCOUNT_QUERY_KEY, "settings"])).toBeUndefined();
		expect(queryClient.getQueryData(["game", 744834])).toEqual({
			gamePk: 744834,
		});
	});

	it("S116 AC 3: locally (no Logto) signIn() is still the dev sign-in and signOut() ends no other session", async () =>
	{
		stubMeApi();
		const authClient = vi.fn(async () => null);
		const { result } = renderSession(createQueryClient(), authClient);
		await act(() => result.current.signIn());
		expect(getSessionToken()).toBe(DEV_SIGN_IN_TOKEN);
		act(() => result.current.signOut());
		await waitFor(() => expect(authClient).toHaveBeenCalledTimes(2));
		expect(result.current.status).toBe("signedOut");
	});

	it("useSession outside the provider is an error", () =>
	{
		expect(() => renderHook(() => useSession())).toThrow("SessionProvider");
	});
});

describe("SessionProvider with Logto (S116)", () =>
{
	/** A stand-in Logto SDK on the real AuthClient, keeping what the real SDK would in the storage it is given. */
	function logto()
	{
		let sdk: LogtoSdk | undefined;
		const client = createAuthClient({
			endpoint: "https://auth.bt.test",
			appId: "spa",
		}, location.origin, (_config, storage) =>
		{
			sdk = {
				signIn: vi.fn(async () => storage.setItem("signInSession", "pkce-state")),
				handleSignInCallback: vi.fn(async () =>
				{
					await storage.removeItem("signInSession");
					await storage.setItem("idToken", "logto-id-token");
					await storage.setItem("accessToken", "logto-access-token");
				}),
				getIdToken: () => storage.getItem("idToken"),
				// Left a no-op so sign-out is what has to clear the tokens.
				clearAllTokens: vi.fn(async () => undefined),
				signOut: vi.fn(async () => undefined),
			};
			return sdk;
		});
		return {
			loader: async () => client,
			sdk: () => sdk!,
		};
	}

	/** The API for a Logto sign-in: the ID token trades for BT's session, which /me accepts. */
	function stubSignInApi()
	{
		const fetchMock = vi.fn(async (request: Request): Promise<Response> =>
		{
			const path = new URL(request.url).pathname;
			if (path === "/api/v1/sign-in" && request.method === "POST")
			{
				const body = await request.json() as { idToken: string };
				return body.idToken === "logto-id-token" ? jsonResponse({
					token: "bt-session-1",
				}) : jsonResponse({
					error: "sign_in_refused",
				}, 401);
			}
			if (path === "/api/v1/me") return request.headers.get("Authorization") === "Bearer bt-session-1" ? jsonResponse({
				uid: "u1",
				email: "fan@example.test",
				role: "member",
				entitlements: {},
			}) : jsonResponse({
				error: "unauthorized",
			}, 401);
			return new Promise<Response>(() => undefined);
		});
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	}

	afterEach(() =>
	{
		localStorage.clear();
		sessionStorage.clear();
		window.history.replaceState(null, "", "/");
	});

	it("S116 AC 3: signIn() goes to Logto with prompt login, the callback hands the ID token to BT once, and sign-out ends both sessions and clears every key", async () =>
	{
		const fetchMock = stubSignInApi();
		const { loader, sdk } = logto();
		window.history.replaceState(null, "", "/settings");
		const { result } = renderSession(createQueryClient(), loader);

		let leaving: boolean | undefined;
		await act(async () =>
		{
			leaving = await result.current.signIn();
		});
		// The browser is leaving for Logto: a caller keeps showing its progress.
		expect(leaving).toBe(true);
		expect(sdk().signIn).toHaveBeenCalledWith(expect.objectContaining({
			redirectUri: `${location.origin}/sign-in/callback`,
			prompt: "login",
		}));
		// Nothing signed in yet: the browser would now be at Logto.
		expect(result.current.status).toBe("signedOut");

		const callback = `${location.origin}/sign-in/callback?code=c1&state=s1`;
		let returnTo = "";
		await act(async () =>
		{
			// The callback route's effect may run twice; BT gets the token once.
			const [first, second] = await Promise.all([result.current.finishSignIn(callback), result.current.finishSignIn(callback)]);
			returnTo = first;
			expect(second).toBe(first);
		});
		expect(returnTo).toBe("/settings");
		expect(result.current.status).toBe("signedIn");
		expect(getSessionToken()).toBe("bt-session-1");
		expect(fetchMock.mock.calls.filter(([request]) => new URL(request.url).pathname === "/api/v1/sign-in")).toHaveLength(1);
		expect(sdk().handleSignInCallback).toHaveBeenCalledOnce();

		act(() => result.current.signOut());
		await waitFor(() => expect(sdk().signOut).toHaveBeenCalledWith(`${location.origin}/settings`));
		expect(result.current.status).toBe("signedOut");
		// BT's session, Logto's keys and the sign-in's return path: nothing is left in either storage.
		expect(Object.keys(localStorage)).toEqual([]);
		expect(Object.keys(sessionStorage)).toEqual([]);
	});

	it("S116 AC 3: a refused ID token leaves the browser signed out", async () =>
	{
		stubSignInApi();
		const client = {
			signIn: vi.fn(async () => undefined),
			finishSignIn: vi.fn(async () => "a-forged-token"),
			signOut: vi.fn(async () => undefined),
		};
		const { result } = renderSession(createQueryClient(), async () => client);
		await act(async () =>
		{
			await expect(result.current.finishSignIn(`${location.origin}/sign-in/callback?code=bad`)).rejects.toThrow(/401/);
		});
		expect(result.current.status).toBe("signedOut");
		expect(getSessionToken()).toBeNull();
		await expect(renderSession(createQueryClient(), async () => null).result.current.finishSignIn("x")).rejects.toThrow(/no Logto/);
	});

	it("S120 AC 5: the in-flight sign-in and its return path are kept in this tab's sessionStorage, never the shared localStorage", async () =>
	{
		stubSignInApi();
		const { loader } = logto();
		window.history.replaceState(null, "", "/standings");
		const { result } = renderSession(createQueryClient(), loader);
		await act(() => result.current.signIn());
		expect(sessionStorage.getItem("bt.signInReturnTo")).toBe("/standings");
		expect(sessionStorage.getItem("logto.signInSession")).toBe("pkce-state");
		// Another tab starting its own sign-in has its own sessionStorage; nothing here is shared with it.
		expect(Object.keys(localStorage)).toEqual([]);

		let returnTo = "";
		await act(async () =>
		{
			returnTo = await result.current.finishSignIn(`${location.origin}/sign-in/callback?code=c5&state=s5`);
		});
		expect(returnTo).toBe("/standings");
		expect(sessionStorage.getItem("bt.signInReturnTo")).toBeNull();
		// Only BT's own session is shared between tabs.
		expect(Object.keys(localStorage)).toEqual(["bt.session"]);
	});

	it("S120 AC 6: on the callback, the startup load for the old token can't undo the new sign-in, however late it answers", async () =>
	{
		for (const late of ["401", "old account", "network error"] as const)
		{
			const signInApi = stubSignInApi();
			let answerOld: (() => void) | undefined;
			vi.stubGlobal("fetch", vi.fn(async (request: Request): Promise<Response> =>
			{
				if (new URL(request.url).pathname !== "/api/v1/me" || request.headers.get("Authorization") !== "Bearer bt-old") return signInApi(request);
				// The old token's /me answers only when the test says so, after the hand-off.
				return new Promise<Response>((resolve, reject) =>
				{
					answerOld = () =>
					{
						if (late === "network error") reject(new TypeError("offline"));
						else resolve(late === "401" ? jsonResponse({
							error: "unauthorized",
						}, 401) : jsonResponse({
							uid: "old-user",
							email: "old@example.test",
							role: "member",
							entitlements: {},
						}));
					};
				});
			}));
			setSessionToken("bt-old");
			window.history.replaceState(null, "", "/sign-in/callback?code=c6&state=s6");
			const client = {
				signIn: vi.fn(async () => undefined),
				finishSignIn: vi.fn(async () => "logto-id-token"),
				signOut: vi.fn(async () => undefined),
			};
			const { result, unmount } = renderSession(createQueryClient(), async () => client);
			await waitFor(() => expect(answerOld).toBeDefined());

			await act(async () =>
			{
				await result.current.finishSignIn(`${location.origin}/sign-in/callback?code=c6&state=s6&late=${late}`);
			});
			expect(result.current.status === "signedIn" && result.current.account.uid).toBe("u1");

			await act(async () =>
			{
				answerOld!();
				await new Promise((resolve) => setTimeout(resolve, 10));
			});
			expect(getSessionToken(), late).toBe("bt-session-1");
			expect(result.current.status === "signedIn" && result.current.account.uid, late).toBe("u1");
			unmount();
			setSessionToken(null);
		}
	});
});
