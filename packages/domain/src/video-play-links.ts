/**
 * Which play each video shows (S95; owner, 2026-10-30: "The ones with plays associated should
 * have a link to the play in question. And yes, we should associate the ABS ones."). The one
 * place a video gets its `playId` (ADR-025): the content mapper hands over MLB's `guid` as the
 * video's `playId`, and this keeps it, adds S94's `playIdRef`, and matches what is left of the
 * ABS challenge clips to S93's challenges. A clip that shows no single play (a Statcast graphic,
 * the recap) stays unlinked rather than guessed by player or title.
 */
import type { AtBat } from "./plays.js";
import type {
	GamePlayMetrics, MediaHighlight, VideoPlayRef,
} from "./types.js";

/** MLB's taxonomy tag on an ABS challenge clip. */
const ABS_TAG = "abs";

/**
 * Each pitch's `playId` → the `atBatIndex` of the at-bat it was thrown in. A video's `playId`
 * names a pitch (S95), while S93's play metrics are per at-bat, so anything that joins the two
 * goes through this one lookup (ADR-025): `videoPlayLinks` to check a link, the impact rank (S98)
 * to find a clip's win probability. Pitches with no `playId` are left out.
 */
export function atBatIndexByPitch(plays: readonly AtBat[]): Map<string, number>
{
	return new Map(plays.flatMap((atBat) => atBat.pitches.filter((p) => p.playId).map((p) => [p.playId as string, atBat.about.atBatIndex] as const)));
}

/** What an ABS clip's title says the challenge did: overturned, confirmed, or nothing. */
function titledOutcome(title: string): boolean | null
{
	if (/\boverturned\b/i.test(title)) return true;
	if (/\bconfirmed\b/i.test(title)) return false;
	return null;
}

/**
 * Each video with its play, in this order:
 * 1. MLB's own link from the content feed (`guid`, already the video's `playId`) when it names a pitch;
 * 2. S94's `playIdRef` for the video;
 * 3. for an ABS challenge clip still unlinked, the ABS-challenge at-bat (S93's `absChallenge`) no
 *    other ABS clip has claimed whose challenging team is one the clip features and whose outcome
 *    is the one its title states — only when exactly one fits; two that fit link neither.
 * A challenge links to its challenged pitch, or the at-bat's last pitch when the review was on the
 * play. Any other `playId` (an older recording's video-file id) is dropped. Running it again on
 * its own output changes nothing.
 */
export function videoPlayLinks(
	videos: readonly MediaHighlight[],
	plays: readonly AtBat[],
	playRefs: readonly VideoPlayRef[] = [],
	playMetrics?: GamePlayMetrics,
): MediaHighlight[]
{
	const atBatOfPitch = atBatIndexByPitch(plays);
	const refs = new Map(playRefs.map((ref) => [ref.videoId, ref.playId]));
	const linked = videos.map((video): MediaHighlight =>
	{
		const { playLink, ...rest } = video;
		const playId = [video.playId, refs.get(video.id)].find((id) => id != null && atBatOfPitch.has(id)) ?? null;
		return playId ? {
			...rest,
			playId,
			// Linking a game already linked (a stored fixture) keeps how each link was found.
			playLink: playId === video.playId && playLink ? playLink : "mlb",
		} : {
			...rest,
			playId: null,
		};
	});

	const isAbs = (video: MediaHighlight) => video.tags?.includes(ABS_TAG) ?? false;
	const claimed = new Set(linked.filter((video) => isAbs(video) && video.playId).map((video) => atBatOfPitch.get(video.playId!)));
	const challenged = new Set((playMetrics?.atBats ?? []).filter((m) => m.absChallenge).map((m) => m.atBatIndex));
	const byIndex = new Map(plays.map((atBat) => [atBat.about.atBatIndex, atBat]));
	return linked.map((video) =>
	{
		if (video.playId || !isAbs(video)) return video;
		const outcome = titledOutcome(video.title);
		const fits = [...challenged].filter((index) =>
		{
			const challenge = byIndex.get(index)?.challenge;
			return !claimed.has(index) && challenge !== undefined
				&& (video.teamIds ?? []).includes(challenge.teamId)
				&& (outcome === null || challenge.overturned === outcome);
		});
		if (fits.length !== 1) return video;
		const atBat = byIndex.get(fits[0]!)!;
		const playId = atBat.challenge!.playId ?? atBat.pitches.at(-1)?.playId;
		if (!playId) return video;
		claimed.add(fits[0]);
		return {
			...video,
			playId,
			playLink: "challenge",
		};
	});
}
