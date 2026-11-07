/**
 * S116 AC 3: the `AuthClient` over a stand-in Logto SDK. It asks for the `email` scope, a fresh
 * sign-in every time (`prompt: "login"`), comes back to the callback route, hands over the ID
 * token and forgets it, and keeps the SDK's keys in BT's storage.
 */
import { SIGN_IN_CALLBACK_PATH } from "@bt/domain";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { jsonResponse } from "../test/jsonResponse.js";
import { clearPersonalData } from "../storage/storage.js";
import type { LogtoSdk, LogtoSdkFactory } from "./AuthClient.js";
import {
	createAuthClient, loadAuthClient, logtoConfig, logtoStorage,
} from "./AuthClient.js";

afterEach(() =>
{
	localStorage.clear();
	sessionStorage.clear();
	vi.unstubAllGlobals();
});

const TARGET = {
	endpoint: "https://auth.bt.test",
	appId: "spa",
};

/** A stand-in SDK that keeps what the real one would in the storage it is given. */
function standIn(): { factory: LogtoSdkFactory;
	sdk: () => LogtoSdk; }
{
	let made: LogtoSdk | undefined;
	return {
		factory: (_config, storage) =>
		{
			made = {
				signIn: vi.fn(async () => storage.setItem("signInSession", "pkce-state")),
				// Only an in-flight sign-in yields a token, as with the real SDK.
				handleSignInCallback: vi.fn(async () =>
				{
					if (!await storage.getItem("signInSession")) return;
					await storage.removeItem("signInSession");
					await storage.setItem("idToken", "id-token-1");
				}),
				getIdToken: () => storage.getItem("idToken"),
				clearAllTokens: vi.fn(async () =>
				{
					await storage.removeItem("idToken");
					await storage.removeItem("accessToken");
					await storage.removeItem("refreshToken");
				}),
				signOut: vi.fn(async () => undefined),
			};
			return made;
		},
		sdk: () => made!,
	};
}

describe("AuthClient (S116)", () =>
{
	it("S116 AC 3: asks Logto for the email scope, a fresh sign-in (prompt login) and the callback route", async () =>
	{
		expect(logtoConfig(TARGET)).toEqual({
			endpoint: TARGET.endpoint,
			appId: TARGET.appId,
			scopes: ["email"],
		});
		const { factory, sdk } = standIn();
		const client = createAuthClient(TARGET, "https://bt.test", factory);
		await client.signIn();
		expect(sdk().signIn).toHaveBeenCalledWith({
			redirectUri: `https://bt.test${SIGN_IN_CALLBACK_PATH}`,
			prompt: "login",
		});
		// The SDK's in-flight sign-in lives in BT's storage, not Logto's own keys.
		expect(localStorage.getItem("logto.signInSession")).toBe("pkce-state");
		expect(Object.keys(sessionStorage)).toEqual([]);
	});

	it("S116 AC 3: the callback answers the ID token once and leaves none of Logto's tokens behind; sign-out ends Logto's session", async () =>
	{
		const { factory, sdk } = standIn();
		const client = createAuthClient(TARGET, "https://bt.test", factory);
		await client.signIn();
		expect(await client.finishSignIn("https://bt.test/sign-in/callback?code=c&state=s")).toBe("id-token-1");
		expect(sdk().handleSignInCallback).toHaveBeenCalledWith("https://bt.test/sign-in/callback?code=c&state=s");
		expect(Object.keys(localStorage)).toEqual([]);
		await expect(client.finishSignIn("https://bt.test/sign-in/callback?code=c&state=s")).rejects.toThrow(/without an ID token/);
		await client.signOut("https://bt.test/settings");
		expect(sdk().signOut).toHaveBeenCalledWith("https://bt.test/settings");
	});

	it("S116 AC 3: every key Logto's SDK writes is a personal key, cleared with the rest on sign-out or deletion", async () =>
	{
		for (const key of ["idToken", "accessToken", "refreshToken", "signInSession"] as const) await logtoStorage.setItem(key, "x");
		expect(await logtoStorage.getItem("idToken")).toBe("x");
		clearPersonalData();
		expect(Object.keys(localStorage)).toEqual([]);
		expect(Object.keys(sessionStorage)).toEqual([]);
	});

	it("S116 AC 3: reads the tenant and app from the Worker, and none means no Logto sign-in", async () =>
	{
		const fetchMock = vi.fn(async () => jsonResponse({
			logto: null,
		}));
		vi.stubGlobal("fetch", fetchMock);
		expect(await loadAuthClient()).toBeNull();
		expect(await loadAuthClient()).toBeNull();
		// Asked once per page load.
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(new URL((fetchMock.mock.calls[0] as unknown as [Request])[0].url).pathname).toBe("/api/v1/sign-in");
	});
});
