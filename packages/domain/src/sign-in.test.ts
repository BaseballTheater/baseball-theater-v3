import {
	describe, expect, it,
} from "vitest";
import {
	logtoAppUris, SIGN_IN_CALLBACK_PATH, signOutReturnUri,
} from "./sign-in.js";

describe("Logto sign-in addresses (S116)", () =>
{
	it("derives the callback and sign-out addresses from one origin, with or without a trailing slash", () =>
	{
		const expected = {
			redirectUris: [`https://next.baseball.theater${SIGN_IN_CALLBACK_PATH}`],
			postLogoutRedirectUris: ["https://next.baseball.theater/", "https://next.baseball.theater/settings"],
		};
		expect(logtoAppUris("https://next.baseball.theater")).toEqual(expected);
		expect(logtoAppUris("https://next.baseball.theater/")).toEqual(expected);
	});

	it("returns a sign-out to Settings from Settings and to / from anywhere else", () =>
	{
		const uris = logtoAppUris("https://bt.test").postLogoutRedirectUris;
		expect(signOutReturnUri("https://bt.test", "/settings")).toBe("https://bt.test/settings");
		expect(signOutReturnUri("https://bt.test", "/games/2024-07-04")).toBe("https://bt.test/");
		expect(uris).toContain(signOutReturnUri("https://bt.test/", "/standings"));
	});
});
