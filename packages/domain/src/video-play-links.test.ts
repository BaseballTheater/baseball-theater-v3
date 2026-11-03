import {
	describe, expect, it,
} from "vitest";
import type { AtBat, AtBatChallenge } from "./plays.js";
import type { GamePlayMetrics, MediaHighlight } from "./types.js";
import { videoPlayLinks } from "./video-play-links.js";

/** An at-bat with one pitch per id, and its challenge if any. */
function atBat(index: number, pitchIds: string[], challenge?: AtBatChallenge): AtBat
{
	return {
		about: {
			atBatIndex: index,
			halfInning: "top",
			inning: 1,
			isComplete: true,
			isScoringPlay: false,
		},
		result: {
			event: "",
			description: "",
			eventType: "",
			isOut: false,
			rbi: 0,
			awayScore: null,
			homeScore: null,
		},
		matchup: {
			batter: {
				id: 1,
				fullName: "",
			},
			pitcher: {
				id: 2,
				fullName: "",
			},
			batSide: null,
			pitchHand: null,
		},
		count: {
			balls: 0,
			strikes: 0,
			outs: 0,
		},
		pitches: pitchIds.map((playId, i) => ({
			playId,
			pitchNumber: i + 1,
		})) as AtBat["pitches"],
		...challenge && {
			challenge,
		},
	};
}

function video(id: string, title: string, extra: Partial<MediaHighlight> = {}): MediaHighlight
{
	return {
		id,
		playId: null,
		title,
		blurb: null,
		duration: null,
		imageUrl: null,
		playbackUrl: null,
		...extra,
	};
}

const metrics = (...challenged: number[]): GamePlayMetrics => ({
	atBats: challenged.map((atBatIndex) => ({
		atBatIndex,
		absChallenge: true,
	})) as GamePlayMetrics["atBats"],
});

const SEA = 136;
const NYY = 147;

describe("videoPlayLinks (S95)", () =>
{
	it("keeps MLB's guid link when it names a pitch, and drops an id that names none", () =>
	{
		const [guid, stale] = videoPlayLinks([video("a", "Homer", {
			playId: "p1",
		}), video("b", "Old", {
			playId: "media-file-id",
		})], [atBat(0, ["p1"])]);
		expect(guid).toMatchObject({
			playId: "p1",
			playLink: "mlb",
		});
		expect(stale!.playId).toBeNull();
		expect(stale).not.toHaveProperty("playLink");
	});

	it("adds S94's playIdRef when the content feed links nothing", () =>
	{
		const [ref] = videoPlayLinks([video("a", "Clip")], [atBat(0, ["p1"])], [{
			videoId: "a",
			playId: "p1",
		}]);
		expect(ref).toMatchObject({
			playId: "p1",
			playLink: "mlb",
		});
	});

	it("matches an unlinked ABS clip to the one unclaimed challenge with its team and stated outcome", () =>
	{
		const plays = [
			atBat(3, ["a1", "a2"], {
				teamId: SEA,
				overturned: true,
				playId: "a1",
			}),
			atBat(7, ["b1"], {
				teamId: SEA,
				overturned: false,
				playId: null,
			}),
			atBat(9, ["c1"], {
				teamId: NYY,
				overturned: true,
				playId: null,
			}),
		];
		const [overturned, confirmed] = videoPlayLinks([
			video("o", "Ball 1 overturned after ABS challenge", {
				tags: ["abs"],
				teamIds: [SEA],
			}),
			video("c", "Strike 1 confirmed after ABS challenge", {
				tags: ["abs"],
				teamIds: [SEA, NYY],
			}),
		], plays, [], metrics(3, 7, 9));
		// The challenged pitch when the review sat on one; the at-bat's last pitch otherwise.
		expect(overturned).toMatchObject({
			playId: "a1",
			playLink: "challenge",
		});
		expect(confirmed).toMatchObject({
			playId: "b1",
			playLink: "challenge",
		});
	});

	it("an ABS clip already linked by MLB claims its challenge, so no other clip takes it", () =>
	{
		const plays = [atBat(3, ["a1"], {
			teamId: SEA,
			overturned: true,
			playId: null,
		})];
		const [, other] = videoPlayLinks([
			video("linked", "Walk after ABS challenge", {
				tags: ["abs"],
				playId: "a1",
			}),
			video("other", "Ball 1 overturned after ABS challenge", {
				tags: ["abs"],
				teamIds: [SEA],
			}),
		], plays, [], metrics(3));
		expect(other!.playId).toBeNull();
	});

	it("running it again on its own output changes nothing", () =>
	{
		const plays = [atBat(3, ["a1"], {
			teamId: SEA,
			overturned: true,
			playId: null,
		})];
		const once = videoPlayLinks([video("o", "Ball 1 overturned after ABS challenge", {
			tags: ["abs"],
			teamIds: [SEA],
		})], plays, [], metrics(3));
		expect(once[0]!.playLink).toBe("challenge");
		expect(videoPlayLinks(once, plays, [], metrics(3))).toEqual(once);
	});

	it("two challenges that both fit link neither", () =>
	{
		const plays = [
			atBat(3, ["a1"], {
				teamId: SEA,
				overturned: true,
				playId: null,
			}),
			atBat(7, ["b1"], {
				teamId: SEA,
				overturned: true,
				playId: null,
			}),
		];
		const [clip] = videoPlayLinks([video("o", "Ball 1 overturned after ABS challenge", {
			tags: ["abs"],
			teamIds: [SEA],
		})], plays, [], metrics(3, 7));
		expect(clip!.playId).toBeNull();
		expect(clip).not.toHaveProperty("playLink");
	});

	it("a clip that isn't an ABS clip is never matched to a challenge", () =>
	{
		const [clip] = videoPlayLinks([video("g", "Statcast: overturned", {
			teamIds: [SEA],
		})], [atBat(3, ["a1"], {
			teamId: SEA,
			overturned: true,
			playId: null,
		})], [], metrics(3));
		expect(clip!.playId).toBeNull();
	});
});
