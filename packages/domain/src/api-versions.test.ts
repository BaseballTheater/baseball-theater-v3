import {
	describe, expect, it,
} from "vitest";
import {
	API_VERSIONS, apiVersionOf, deprecationHeaders,
} from "./api-versions.js";

describe("API version lifecycle (S28)", () =>
{
	it("lifecycle: v1 is the one published version and is supported", () =>
	{
		expect(API_VERSIONS).toEqual({
			v1: {
				status: "supported",
			},
		});
	});

	it("reads the version from a path, and nothing outside /api/<version>/", () =>
	{
		expect(apiVersionOf("/api/v1/schedule")).toBe("v1");
		expect(apiVersionOf("/api/v12/games/1")).toBe("v12");
		expect(apiVersionOf("/api/v2")).toBe("v2");
		expect(apiVersionOf("/health")).toBeNull();
		expect(apiVersionOf("/api/schedule")).toBeNull();
	});

	it("a deprecated version's headers: Deprecation as @epoch seconds, Sunset as an HTTP date; none otherwise", () =>
	{
		expect(deprecationHeaders({
			status: "deprecated",
			deprecatedOn: "2027-01-01",
			sunsetOn: "2027-04-01",
		})).toEqual({
			Deprecation: "@1798761600",
			Sunset: "Thu, 01 Apr 2027 00:00:00 GMT",
		});
		expect(deprecationHeaders({
			status: "supported",
		})).toEqual({});
		expect(deprecationHeaders({
			status: "sunset",
			sunsetOn: "2027-04-01",
		})).toEqual({});
	});
});
