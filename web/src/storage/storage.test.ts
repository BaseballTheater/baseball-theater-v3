import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import {
	clearPersonalData, readStored, STORAGE_KEYS, writeStored,
} from "./storage.js";

afterEach(() =>
{
	localStorage.clear();
	sessionStorage.clear();
	vi.restoreAllMocks();
});

describe("browser storage", () =>
{
	it("round-trips a labeled key and removes it on null", () =>
	{
		writeStored("bt.session", "token-1");
		expect(readStored("bt.session")).toBe("token-1");
		writeStored("bt.session", null);
		expect(readStored("bt.session")).toBeNull();
	});

	it("labels every key personal or not", () =>
	{
		for (const label of Object.values(STORAGE_KEYS)) expect(typeof label.personal).toBe("boolean");
	});

	it("clearPersonalData removes every personal key and leaves keys BT doesn't own", () =>
	{
		writeStored("bt.session", "token-1");
		localStorage.setItem("someone-else", "kept");
		clearPersonalData();
		expect(readStored("bt.session")).toBeNull();
		expect(localStorage.getItem("someone-else")).toBe("kept");
	});

	it("reads null and drops writes when storage throws", () =>
	{
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() =>
		{
			throw new Error("blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() =>
		{
			throw new Error("blocked");
		});
		expect(readStored("bt.session")).toBeNull();
		expect(() => writeStored("bt.session", "token-1")).not.toThrow();
	});

	it("S120 AC 5: the in-flight sign-in and its return path are the tab's own, and clearPersonalData clears both areas", () =>
	{
		for (const key of ["bt.signInReturnTo", "logto.signInSession", "logto.idToken", "logto.accessToken", "logto.refreshToken"] as const)
		{
			expect(STORAGE_KEYS[key]).toEqual({
				personal: true,
				area: "tab",
			});
		}
		writeStored("logto.signInSession", "pkce-of-this-tab");
		writeStored("bt.signInReturnTo", "/settings");
		writeStored("bt.session", "token-1");
		// Another tab's storage area is a different sessionStorage; the shared one never holds the sign-in.
		expect(sessionStorage.getItem("logto.signInSession")).toBe("pkce-of-this-tab");
		expect(sessionStorage.getItem("bt.signInReturnTo")).toBe("/settings");
		expect(Object.keys(localStorage)).toEqual(["bt.session"]);
		expect(readStored("logto.signInSession")).toBe("pkce-of-this-tab");

		clearPersonalData();
		expect(Object.keys(localStorage)).toEqual([]);
		expect(Object.keys(sessionStorage)).toEqual([]);
	});
});
