import {
	describe, expect, it,
} from "vitest";
import { recapHeading } from "./recap.js";

const RECAP = {
	headline: "Conforto clubs Cubs' 200th homer in close win",
	text: "CHICAGO -- …",
};

describe("recapHeading (S75)", () =>
{
	it("is \"Recap\" with scores hidden", () =>
	{
		expect(recapHeading(RECAP, true)).toBe("Recap");
	});

	it("is MLB's headline with scores shown", () =>
	{
		expect(recapHeading(RECAP, false)).toBe(RECAP.headline);
	});
});
