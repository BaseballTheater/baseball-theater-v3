import {
	describe, expect, it,
} from "vitest";
import { atBatInningLabel } from "./inning.js";
import type { AtBat } from "./plays.js";
import { atBatOfPlay, videosByAtBat } from "./video-play-links.js";

const atBat = (atBatIndex: number, inning: number, halfInning: "top" | "bottom", pitchIds: string[]) => ({
	about: {
		atBatIndex,
		inning,
		halfInning,
	},
	pitches: pitchIds.map((playId) => ({
		playId,
	})),
}) as unknown as AtBat;
const plays = [atBat(0, 1, "top", ["a", "b"]), atBat(1, 3, "bottom", ["c"]), atBat(2, 11, "top", ["d"])];
const video = (id: string, playId: string | null) => ({
	id,
	playId,
});

describe("video play context (S97)", () =>
{
	it("atBatInningLabel: Top / Bot with an ordinal", () =>
	{
		expect(atBatInningLabel(plays[0]!)).toBe("Top 1st");
		expect(atBatInningLabel(plays[1]!)).toBe("Bot 3rd");
		expect(atBatInningLabel(plays[2]!)).toBe("Top 11th");
	});

	it("atBatOfPlay: the at-bat a pitch id is in; undefined for none or an unknown id", () =>
	{
		expect(atBatOfPlay(plays, "b")).toBe(plays[0]);
		expect(atBatOfPlay(plays, "c")).toBe(plays[1]);
		expect(atBatOfPlay(plays, "zzz")).toBeUndefined();
		expect(atBatOfPlay(plays, null)).toBeUndefined();
		expect(atBatOfPlay(plays, undefined)).toBeUndefined();
	});

	it("videosByAtBat: each at-bat's videos in the order given; unlinked videos counted nowhere", () =>
	{
		const map = videosByAtBat([video("v1", "b"), video("v2", null), video("v3", "a"), video("v4", "c"), video("v5", "zzz")], plays);
		expect([...map.keys()]).toEqual([0, 1]);
		expect(map.get(0)!.map((v) => v.id)).toEqual(["v1", "v3"]);
		expect(map.get(1)!.map((v) => v.id)).toEqual(["v4"]);
	});
});
