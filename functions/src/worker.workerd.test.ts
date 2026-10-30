/**
 * S45: the API inside workerd — the runtime production uses — through the real Worker
 * entry and its composition, serving the bundled fixtures (no `node:fs`, no network).
 * Run with `pnpm --filter @bt/functions test:workerd`.
 */
import { SELF } from "cloudflare:test";
import {
	describe, expect, it,
} from "vitest";

describe("the Worker on workerd (S45)", () =>
{
	it("GET /api/v1/schedule?date=2024-07-04 is 200 with the fixture day", async () =>
	{
		const res = await SELF.fetch("http://bt.test/api/v1/schedule?date=2024-07-04");
		expect(res.status).toBe(200);
		const day = await res.json() as { date: string;
			games: unknown[]; };
		expect(day.date).toBe("2024-07-04");
		expect(day.games.length).toBeGreaterThan(0);
	});

	it("GET /api/v1/games/744834 is 200 with the fixture game", async () =>
	{
		const res = await SELF.fetch("http://bt.test/api/v1/games/744834");
		expect(res.status).toBe(200);
		const game = await res.json() as { gamePk: number };
		expect(game.gamePk).toBe(744834);
	});
});
