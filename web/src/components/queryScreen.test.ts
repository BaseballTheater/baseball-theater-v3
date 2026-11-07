import {
	describe, expect, it,
} from "vitest";
import { queryScreen } from "./queryScreen.js";

describe("queryScreen (S28: keep what's on screen)", () =>
{
	it("shows data already loaded even when a later refetch failed", () =>
	{
		expect(queryScreen({
			data: {
				games: [],
			},
			error: new Error("426"),
		})).toBe("data");
	});

	it("shows the error room only when there has never been data", () =>
	{
		expect(queryScreen({
			data: undefined,
			error: new Error("offline"),
		})).toBe("error");
	});

	it("is loading with neither data nor an error", () =>
	{
		expect(queryScreen({
			data: undefined,
			error: null,
		})).toBe("loading");
	});

	it("shows data with no error", () =>
	{
		expect(queryScreen({
			data: {
				divisions: [],
			},
			error: null,
		})).toBe("data");
	});
});
