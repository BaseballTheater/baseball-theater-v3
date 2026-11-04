/**
 * S98 on 823823: `withGameExtras` (both adapters' one assembly step) ranks the videos by how much
 * their play swung the odds of winning, with S93's play metrics in hand, and falls back to the
 * keyword order when there are none.
 */
import type { AtBatMetrics, MediaHighlight } from "@bt/domain";
import { atBatIndexByPitch, rankHighlightsByImpact } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { withGameExtras } from "./game-extras.js";

const client = new FixtureMlbStatsClient();

/** The percentage points a clip's play swung the game, or null for a clip with no measured play. */
async function swings(highlights: MediaHighlight[]): Promise<(number | null)[]>
{
	const game = await client.fetchGame(823823);
	const metrics = await client.fetchPlayMetrics(823823);
	const atBat = atBatIndexByPitch(game.plays);
	const byAtBat = new Map<number, AtBatMetrics>(metrics!.atBats.map((m) => [m.atBatIndex, m]));
	return highlights.map((h) =>
	{
		const m = h.playId ? byAtBat.get(atBat.get(h.playId) ?? -1) : undefined;
		return m?.homeWinProbabilityAdded == null ? null : Math.abs(m.homeWinProbabilityAdded);
	});
}

describe("impact rank on the server (S98)", () =>
{
	it("S98 AC 2: on 823823 the largest win-probability swing is first, and Conine's two-run homer (+19.6%) is above the solo homers that swung less", async () =>
	{
		const game = await client.fetchGame(823823);
		const s = await swings(game.highlights);
		const measured = s.filter((v): v is number => v != null);
		expect(s[0]).toBe(Math.max(...measured));
		expect(game.highlights[0]?.title).toBe("Griffin Conine's two-run home run (15)");
		expect(s[0]).toBeCloseTo(19.6, 5);

		// Every measured clip comes before every unmeasured one, largest swing first.
		const firstUnmeasured = s.indexOf(null);
		expect(s.slice(firstUnmeasured).every((v) => v == null)).toBe(true);
		expect(measured).toEqual([...measured].sort((a, b) => b - a));

		const conine = game.highlights.findIndex((h) => h.title === "Griffin Conine's two-run home run (15)");
		const solos = game.highlights.map((h, i) => [h.title, i, s[i]] as const).filter(([title]) => /solo home run/i.test(title));
		expect(solos.length).toBeGreaterThan(0);
		for (const [title, index, swing] of solos)
		{
			expect(swing, title).not.toBeNull();
			expect(swing!, title).toBeLessThan(19.6);
			expect(index, title).toBeGreaterThan(conine);
		}
	});

	it("S98 AC 3: with no play metrics the order is today's keyword order", async () =>
	{
		const game = await client.fetchGame(823823);
		const graph = await client.fetchGameGraphContent(823823);
		const { playMetrics: _dropped, ...withoutMetrics } = game;
		const ranked = withGameExtras(withoutMetrics, null, graph).highlights;
		expect(ranked.map((h) => h.id)).toEqual(rankHighlightsByImpact(game.highlights).map((h) => h.id));
		// The same rule with no metrics at all: no clip moves for its play.
		expect(ranked.map((h) => h.id)).toEqual(rankHighlightsByImpact(ranked, {
			plays: game.plays,
		}).map((h) => h.id));
		expect(ranked[0]?.id).not.toBe(game.highlights[0]?.id);
	});
});
