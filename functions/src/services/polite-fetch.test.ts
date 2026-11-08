/**
 * The backfill's pacer (S122 AC 6) on a fake clock and a fake fetch: no test waits real time
 * or touches the network. The fake clock fires its timers in time order, one at a time, only
 * once everything else has settled, so start times read off it are the pacer's own.
 */
import {
	describe, expect, it,
} from "vitest";
import type { Clock } from "./polite-fetch.js";
import {
	BACKOFF_BASE_MS, MAX_IN_FLIGHT_PER_HOST, OLD_GAP_MS, PoliteFetch, RECENT_GAP_MS, RETRY_ATTEMPTS, retryAfterMs,
} from "./polite-fetch.js";

class FakeClock implements Clock
{
	private t = 0;
	private timers: { at: number;
		resolve: () => void; }[] = [];

	now(): number
	{
		return this.t;
	}

	sleep(ms: number): Promise<void>
	{
		return new Promise((resolve) => this.timers.push({
			at: this.t + ms,
			resolve,
		}));
	}

	/** Runs timers in time order until `work` settles. */
	async run<T>(work: Promise<T>): Promise<T>
	{
		let settled = false;
		const watched = work.finally(() =>
		{
			settled = true;
		});
		// Handled here so a rejection waits for the caller instead of reporting as unhandled.
		watched.catch(() => undefined);
		for (;;)
		{
			await new Promise((resolve) => setImmediate(resolve));
			if (settled) return watched;
			this.timers.sort((a, b) => a.at - b.at);
			const next = this.timers.shift();
			if (!next) throw new Error("fake clock: nothing left to run and the work never settled");
			this.t = Math.max(this.t, next.at);
			next.resolve();
		}
	}
}

type Seen = { host: string;
	start: number;
	end: number; };

/** A fake fetch where each request takes `takesMs` of fake time and answers `answer(url, attempt)`. */
function fakeFetch(clock: FakeClock, takesMs: number, answer: (url: URL, attempt: number) => Response = () => new Response("{}"))
{
	const seen: Seen[] = [];
	const attempts = new Map<string, number>();
	let inFlight = new Map<string, number>();
	let maxInFlight = new Map<string, number>();
	const impl: typeof fetch = async (input) =>
	{
		const url = new URL(String(input));
		const host = url.hostname;
		const start = clock.now();
		inFlight.set(host, (inFlight.get(host) ?? 0) + 1);
		maxInFlight.set(host, Math.max(maxInFlight.get(host) ?? 0, inFlight.get(host)!));
		await clock.sleep(takesMs);
		inFlight.set(host, inFlight.get(host)! - 1);
		seen.push({
			host,
			start,
			end: clock.now(),
		});
		const attempt = (attempts.get(url.toString()) ?? 0) + 1;
		attempts.set(url.toString(), attempt);
		return answer(url, attempt);
	};
	return {
		impl,
		seen,
		maxInFlight: () => maxInFlight,
		reset: () =>
		{
			inFlight = new Map();
			maxInFlight = new Map();
		},
	};
}

const HOSTS = ["https://statsapi.mlb.com/a", "https://bdfed.stitch.mlbinfra.com/b", "https://data-graph.mlb.com/c"];

function startsOf(seen: Seen[], host: string): number[]
{
	return seen.filter((s) => s.host === host).map((s) => s.start).sort((a, b) => a - b);
}

function gapsOf(starts: number[]): number[]
{
	return starts.slice(1).map((start, i) => start - starts[i]!);
}

describe("PoliteFetch (S122 AC 6)", () =>
{
	it("in flight: never more than 2 requests at once per host, each host counted separately", async () =>
	{
		const clock = new FakeClock();
		const fake = fakeFetch(clock, 10_000);
		const polite = new PoliteFetch({
			today: "2026-11-08",
			fetchImpl: fake.impl,
			clock,
		});
		const all = HOSTS.flatMap((base) => Array.from({
			length: 8,
		}, (_, i) => polite.fetch(`${base}/${i}`)));
		await clock.run(Promise.all(all));
		expect(MAX_IN_FLIGHT_PER_HOST).toBe(2);
		for (const host of ["statsapi.mlb.com", "bdfed.stitch.mlbinfra.com", "data-graph.mlb.com"])
		{
			expect(fake.maxInFlight().get(host)).toBe(2);
			expect(startsOf(fake.seen, host)).toHaveLength(8);
		}
		// The three hosts ran side by side: the first request to each started at once.
		expect(fake.seen.filter((s) => s.start === 0)).toHaveLength(3);
	});

	it("gap: request starts to one host are at least the recent gap apart", async () =>
	{
		const clock = new FakeClock();
		const fake = fakeFetch(clock, 10);
		const polite = new PoliteFetch({
			today: "2026-11-08",
			fetchImpl: fake.impl,
			clock,
		});
		polite.setDay("2026-07-04");
		expect(polite.gapMs).toBe(RECENT_GAP_MS);
		await clock.run(Promise.all(Array.from({
			length: 6,
		}, (_, i) => polite.fetch(`${HOSTS[0]}/${i}`))));
		const gaps = gapsOf(startsOf(fake.seen, "statsapi.mlb.com"));
		expect(gaps).toHaveLength(5);
		for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(RECENT_GAP_MS);
		expect(RECENT_GAP_MS).toBeGreaterThanOrEqual(1000);
	});

	it("older: games more than 10 years before today get the longer gap, and the flags override both", async () =>
	{
		const clock = new FakeClock();
		const fake = fakeFetch(clock, 10);
		const polite = new PoliteFetch({
			today: "2026-11-08",
			fetchImpl: fake.impl,
			clock,
		});
		polite.setDay("2016-11-08");
		expect(polite.gapMs).toBe(RECENT_GAP_MS);
		polite.setDay("2016-11-07");
		expect(polite.gapMs).toBe(OLD_GAP_MS);
		expect(OLD_GAP_MS).toBeGreaterThanOrEqual(3000);
		await clock.run(Promise.all(Array.from({
			length: 4,
		}, (_, i) => polite.fetch(`${HOSTS[1]}/${i}`))));
		for (const gap of gapsOf(startsOf(fake.seen, "bdfed.stitch.mlbinfra.com"))) expect(gap).toBeGreaterThanOrEqual(OLD_GAP_MS);

		const custom = new PoliteFetch({
			today: "2026-11-08",
			clock,
			recentGapMs: 2_500,
			oldGapMs: 9_000,
		});
		expect(custom.gapMs).toBe(2_500);
		custom.setDay("1950-05-01");
		expect(custom.gapMs).toBe(9_000);
	});

	it("429: a throttled request is retried after an exponential per-host backoff, and other hosts carry on", async () =>
	{
		const clock = new FakeClock();
		const fake = fakeFetch(clock, 10, (url, attempt) => url.hostname === "statsapi.mlb.com" && attempt <= 2 ? new Response("slow down", {
			status: 429,
		}) : new Response(JSON.stringify({
			ok: url.pathname,
		})));
		const lines: string[] = [];
		const polite = new PoliteFetch({
			today: "2026-11-08",
			fetchImpl: fake.impl,
			clock,
			log: (line) => lines.push(line),
		});
		const [throttled, other] = await clock.run(Promise.all([polite.fetch(`${HOSTS[0]}/x`), polite.fetch(`${HOSTS[2]}/y`)]));
		expect(throttled.status).toBe(200);
		expect(await throttled.json()).toEqual({
			ok: "/a/x",
		});
		expect(other.status).toBe(200);
		const starts = startsOf(fake.seen, "statsapi.mlb.com");
		expect(starts).toHaveLength(3);
		// First backoff is the base, the second twice that.
		expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(BACKOFF_BASE_MS);
		expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(2 * BACKOFF_BASE_MS);
		expect(startsOf(fake.seen, "data-graph.mlb.com")).toEqual([0]);
		expect(lines.join("\n")).toContain("statsapi.mlb.com: answered 429");
	});

	it("429: throttling is retried past the retry limit — a day is never given up for it", async () =>
	{
		const clock = new FakeClock();
		const fake = fakeFetch(clock, 1, (_url, attempt) => attempt <= RETRY_ATTEMPTS + 2 ? new Response("", {
			status: 429,
			headers: {
				"retry-after": "1",
			},
		}) : new Response("{}"));
		const polite = new PoliteFetch({
			today: "2026-11-08",
			fetchImpl: fake.impl,
			clock,
		});
		const response = await clock.run(polite.fetch(`${HOSTS[0]}/z`));
		expect(response.status).toBe(200);
		expect(fake.seen).toHaveLength(RETRY_ATTEMPTS + 3);
	});

	it("Retry-After: the wait MLB asks for is honored, in seconds or as a date", async () =>
	{
		expect(retryAfterMs("120", 0)).toBe(120_000);
		expect(retryAfterMs("Thu, 01 Jan 1970 00:01:00 GMT", 0)).toBe(60_000);
		expect(retryAfterMs("soon", 0)).toBeUndefined();
		expect(retryAfterMs(null, 0)).toBeUndefined();

		const clock = new FakeClock();
		const fake = fakeFetch(clock, 0, (_url, attempt) => attempt === 1 ? new Response("", {
			status: 429,
			headers: {
				"retry-after": "90",
			},
		}) : new Response("{}"));
		const polite = new PoliteFetch({
			today: "2026-11-08",
			fetchImpl: fake.impl,
			clock,
		});
		await clock.run(polite.fetch(`${HOSTS[0]}/r`));
		const starts = startsOf(fake.seen, "statsapi.mlb.com");
		expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(90_000);
	});

	it("5xx: a server error backs off and retries, then is answered as it is after the retry limit", async () =>
	{
		const clock = new FakeClock();
		const recovering = fakeFetch(clock, 1, (_url, attempt) => attempt === 1 ? new Response("", {
			status: 503,
		}) : new Response("{}"));
		const polite = new PoliteFetch({
			today: "2026-11-08",
			fetchImpl: recovering.impl,
			clock,
		});
		expect((await clock.run(polite.fetch(`${HOSTS[1]}/m`))).status).toBe(200);
		expect(recovering.seen).toHaveLength(2);

		const broken = fakeFetch(clock, 1, () => new Response("", {
			status: 500,
		}));
		const stubborn = new PoliteFetch({
			today: "2026-11-08",
			fetchImpl: broken.impl,
			clock,
		});
		expect((await clock.run(stubborn.fetch(`${HOSTS[1]}/m`))).status).toBe(500);
		expect(broken.seen).toHaveLength(RETRY_ATTEMPTS);
	});

	it("5xx: a dropped connection is retried, then rethrown after the retry limit; a 204 passes through", async () =>
	{
		const clock = new FakeClock();
		let calls = 0;
		const polite = new PoliteFetch({
			today: "2026-11-08",
			clock,
			fetchImpl: async () =>
			{
				calls++;
				throw new Error("socket hang up");
			},
		});
		await expect(clock.run(polite.fetch(`${HOSTS[0]}/d`))).rejects.toThrow("socket hang up");
		expect(calls).toBe(RETRY_ATTEMPTS);

		const empty = new PoliteFetch({
			today: "2026-11-08",
			clock,
			fetchImpl: async () => new Response(null, {
				status: 204,
			}),
		});
		expect((await clock.run(empty.fetch(new Request(`${HOSTS[0]}/e`)))).status).toBe(204);
	});
});
