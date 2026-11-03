/**
 * S48: the `game-ingest:<gamePk>` Durable Object inside workerd, the runtime production
 * uses, through the real `GAME_INGEST` binding from `wrangler.jsonc`: ensured twice it arms
 * one alarm, and its alarm polls the bundled fixture 745001 (a game in progress) and arms
 * the next. Run with `pnpm --filter @bt/functions test:workerd`.
 */
import {
	env, runDurableObjectAlarm, runInDurableObject,
} from "cloudflare:test";
import {
	describe, expect, it,
} from "vitest";

const ensure = (stub: ReturnType<typeof env.GAME_INGEST.get>) => stub.fetch("https://game-ingest/ensure?gamePk=745001", {
	method: "POST",
});

/**
 * The object's alarm, once one is set. The first poll is due at once, and workerd reports no
 * alarm while its handler runs — which now reads and writes Postgres (S51) — so read until the
 * handler has re-armed rather than once.
 */
async function armedAlarm(stub: ReturnType<typeof env.GAME_INGEST.get>): Promise<number | null>
{
	for (let attempt = 0; attempt < 50; attempt++)
	{
		const alarm = await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());
		if (alarm !== null) return alarm;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return null;
}

describe("GameIngestObject on workerd (S48)", () =>
{
	it("ensureRunning twice arms exactly one alarm; the alarm polls 745001 and arms the next", async () =>
	{
		const stub = env.GAME_INGEST.get(env.GAME_INGEST.idFromName("game-ingest:745001"));
		expect(await (await ensure(stub)).json()).toEqual({
			armed: true,
		});
		expect(await (await ensure(stub)).json()).toEqual({
			armed: false,
		});
		const first = await armedAlarm(stub);
		expect(first).not.toBeNull();

		expect(await runDurableObjectAlarm(stub)).toBe(true);
		const next = await runInDurableObject(stub, async (_instance, state) => ({
			alarm: await state.storage.getAlarm(),
			gamePk: await state.storage.get<number>("gamePk"),
		}));
		expect(next.gamePk).toBe(745001);
		expect(next.alarm).not.toBeNull();
		expect(next.alarm!).toBeGreaterThan(first!);
	});
});
