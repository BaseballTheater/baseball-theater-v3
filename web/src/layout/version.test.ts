import {
	describe, expect, it,
} from "vitest";
import {
	VERSION_LINE, buildInfo, versionLine,
} from "./version.js";

describe("versionLine (S60, S56 A2, #47)", () =>
{
	it("prints {release} ({7-char commit}) with no label, as A2 draws it", () =>
	{
		expect(versionLine("v3.2.0", "c46e8531f0a2b9d7e6c5")).toBe("v3.2.0 (c46e853)");
	});

	it("prints unreleased for a deployed commit no pull request merged", () =>
	{
		expect(versionLine("unreleased", "c46e8531f0a2b9d7e6c5")).toBe("unreleased (c46e853)");
	});

	it("falls back to dev when nothing was injected (tests skip vite.config.ts)", () =>
	{
		expect(VERSION_LINE).toBe("dev (unknown)");
	});
});

describe("buildInfo (#47): what vite.config.ts injects", () =>
{
	const git = () => "abc1234";

	it("takes the release a deploy looked up, and the commit Actions names", () =>
	{
		expect(buildInfo({
			BT_RELEASE: "v3.2.0",
			GITHUB_SHA: "40767e905e0717628d110902c1d45d3de9625e1a",
		}, git)).toEqual({
			release: "v3.2.0",
			commit: "40767e9",
		});
	});

	it("says dev for any build that looked nothing up, whatever the run number", () =>
	{
		expect(buildInfo({
			GITHUB_RUN_NUMBER: "193",
			GITHUB_SHA: "40767e905e0717628d110902c1d45d3de9625e1a",
		}, git).release).toBe("dev");
		expect(buildInfo({
			BT_RELEASE: "  ",
		}, git).release).toBe("dev");
	});

	it("keeps a milestone name with spaces, trimmed", () =>
	{
		expect(buildInfo({
			BT_RELEASE: " Spring cleanup 2 ",
		}, git).release).toBe("Spring cleanup 2");
	});

	it("prefers BT_COMMIT (a preview's head commit) over GITHUB_SHA (its test merge)", () =>
	{
		expect(buildInfo({
			BT_COMMIT: "1111111222222233333334444444555555566666",
			GITHUB_SHA: "40767e905e0717628d110902c1d45d3de9625e1a",
		}, git).commit).toBe("1111111");
	});

	it("asks git outside Actions, and says unknown when git can't answer", () =>
	{
		expect(buildInfo({}, git).commit).toBe("abc1234");
		expect(buildInfo({}, () =>
		{
			throw new Error("not a checkout");
		}).commit).toBe("unknown");
	});
});
