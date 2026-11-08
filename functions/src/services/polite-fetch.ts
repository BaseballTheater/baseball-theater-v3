/**
 * A `fetch` that is gentle on MLB (S122 AC 6; owner, 2026-11-07: "I think I would keep it to
 * something like 2 request threads per domain"; "I don't want to be a bad citizen, don't hit the
 * API too hard"). Each host (statsapi.mlb.com, bdfed.stitch.mlbinfra.com, data-graph.mlb.com)
 * is paced on its own: at most {@link MAX_IN_FLIGHT_PER_HOST} requests in flight, a minimum gap
 * between request starts, longer for games more than {@link OLD_GAME_YEARS} years old, and an
 * exponential per-host backoff on a 429 or 5xx that honors `Retry-After` (waiting at least as
 * long as it asks, never less than the exponential step). Throttling (429) is
 * retried for as long as it takes, so a day is never given up because MLB asked us to slow
 * down; a 5xx or a dropped connection is retried {@link RETRY_ATTEMPTS} times and then
 * answered as it is, so a host that always errors on old games can't stall the walk.
 *
 * The backfill hands this to `HttpMlbStatsClient` as its `fetchImpl`, so the adapter's own
 * requests are what is paced. The clock is injected, so the tests run on a fake one.
 */
import { yearsBefore } from "@bt/domain";

/** At most this many requests to one host at once (owner: "2 request threads per domain"). */
export const MAX_IN_FLIGHT_PER_HOST = 2;
/** The least time between two request starts to one host, for games within {@link OLD_GAME_YEARS} years. */
export const RECENT_GAP_MS = 1_000;
/** The same for older games, which nobody is watching live and MLB serves from colder storage. */
export const OLD_GAP_MS = 3_000;
/** Games more than this many years before today are paced with {@link OLD_GAP_MS}. */
export const OLD_GAME_YEARS = 10;
/** The first backoff after a 429 or 5xx without `Retry-After`; it doubles per failure in a row. */
export const BACKOFF_BASE_MS = 5_000;
/** The longest single backoff. */
export const BACKOFF_MAX_MS = 10 * 60_000;
/** A 5xx or a dropped connection is tried this many times before it is answered as it is. */
export const RETRY_ATTEMPTS = 6;

/** Time as the pacer sees it: real in the command, fake in the tests. */
export type Clock = {
	now(): number;
	sleep(ms: number): Promise<void>;
};

/** The wall clock and `setTimeout`, for the command; tests hand {@link PoliteFetch} a fake one instead. */
export const realClock: Clock = {
	now: () => Date.now(),
	sleep: (ms) => new Promise((resolve) =>
	{
		setTimeout(resolve, ms);
	}),
};

/**
 * How a {@link PoliteFetch} is built. Only `today` is required; the rest default to the real
 * network and clock and to the owner's pacing, and are overridden by the command's flags
 * (`--gap-ms`, `--old-gap-ms`) or by tests, which always pass a fake `fetchImpl`.
 */
export type PoliteFetchOptions = {
	/** MLB's today (`mlbToday`): the 10-year line is measured from it. */
	today: string;
	/** The `fetch` actually sent; defaults to the global one (the network). */
	fetchImpl?: typeof fetch;
	/** Time and sleeping; defaults to {@link realClock}. */
	clock?: Clock;
	/** Gap between starts for recent games; defaults to {@link RECENT_GAP_MS}. */
	recentGapMs?: number;
	/** Gap between starts for old games; defaults to {@link OLD_GAP_MS}. */
	oldGapMs?: number;
	/** Requests in flight per host; defaults to {@link MAX_IN_FLIGHT_PER_HOST}. */
	maxInFlight?: number;
	/** Where backoff lines go (the command prints them). */
	log?: (line: string) => void;
};

/** Statuses a `Response` may not carry a body with. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

type HostState = {
	inFlight: number;
	waiters: (() => void)[];
	/** The earliest the next request may start, by the gap. */
	nextStartAt: number;
	/** The earliest the next request may start, by a backoff. */
	blockedUntil: number;
	/** Failures (429, 5xx, dropped) in a row, for the exponential backoff. */
	failures: number;
};

/** `Retry-After` in milliseconds from `now`: seconds, or an HTTP date; undefined when absent or unreadable. */
export function retryAfterMs(header: string | null, now: number): number | undefined
{
	if (!header) return undefined;
	const seconds = Number(header);
	if (Number.isFinite(seconds) && header.trim() !== "") return Math.max(0, seconds * 1000);
	const at = Date.parse(header);
	return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/**
 * The paced `fetch` itself: one per backfill run, its {@link PoliteFetch.fetch} handed to
 * `HttpMlbStatsClient`, and {@link PoliteFetch.setDay} told each day so old games get the
 * longer gap. Pacing state is kept per host and lives only as long as the run.
 */
export class PoliteFetch
{
	private readonly hosts = new Map<string, HostState>();
	private readonly fetchImpl: typeof fetch;
	private readonly clock: Clock;
	private readonly recentGapMs: number;
	private readonly oldGapMs: number;
	private readonly maxInFlight: number;
	private readonly oldBefore: string;
	private readonly log: (line: string) => void;
	private currentGapMs: number;

	constructor(options: PoliteFetchOptions)
	{
		this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
		this.clock = options.clock ?? realClock;
		this.recentGapMs = options.recentGapMs ?? RECENT_GAP_MS;
		this.oldGapMs = options.oldGapMs ?? OLD_GAP_MS;
		this.maxInFlight = options.maxInFlight ?? MAX_IN_FLIGHT_PER_HOST;
		this.oldBefore = yearsBefore(options.today, OLD_GAME_YEARS);
		this.log = options.log ?? (() => undefined);
		this.currentGapMs = this.recentGapMs;
	}

	/** Tells the pacer which day's games are being asked for, which picks the gap. */
	setDay(day: string): void
	{
		this.currentGapMs = day < this.oldBefore ? this.oldGapMs : this.recentGapMs;
	}

	/** The gap now in force between request starts to one host. */
	get gapMs(): number
	{
		return this.currentGapMs;
	}

	/** The paced `fetch`, bound so it can be handed over as a `fetchImpl`. */
	readonly fetch: typeof fetch = (input, init) => this.request(input, init);

	private host(name: string): HostState
	{
		let state = this.hosts.get(name);
		if (!state)
		{
			state = {
				inFlight: 0,
				waiters: [],
				nextStartAt: 0,
				blockedUntil: 0,
				failures: 0,
			};
			this.hosts.set(name, state);
		}
		return state;
	}

	/** Waits for a slot (in flight below the cap) and then for the gap and any backoff. */
	private async acquire(state: HostState): Promise<void>
	{
		while (state.inFlight >= this.maxInFlight)
		{
			await new Promise<void>((resolve) => state.waiters.push(resolve));
		}
		state.inFlight++;
		// Nothing is reserved while sleeping: a backoff or another start can land meanwhile, so
		// each wake checks again, and only the request that actually starts moves the gap on.
		for (;;)
		{
			const now = this.clock.now();
			const start = Math.max(now, state.nextStartAt, state.blockedUntil);
			if (start <= now)
			{
				// No await between this check and the reservation, so no other request can slip in.
				state.nextStartAt = now + this.currentGapMs;
				return;
			}
			await this.sleepUntil(start);
		}
	}

	private async sleepUntil(at: number): Promise<void>
	{
		const wait = at - this.clock.now();
		if (wait > 0) await this.clock.sleep(wait);
	}

	private release(state: HostState): void
	{
		state.inFlight--;
		state.waiters.shift()?.();
	}

	private backOff(state: HostState, host: string, why: string, retryAfter: number | undefined): void
	{
		// Never shorter than the exponential step: `Retry-After: 0` on repeated 429s must not turn into a tight loop.
		const delay = Math.max(retryAfter ?? 0, Math.min(BACKOFF_BASE_MS * 2 ** state.failures, BACKOFF_MAX_MS));
		state.failures++;
		state.blockedUntil = Math.max(state.blockedUntil, this.clock.now() + delay);
		this.log(`${host}: ${why}; backing off ${Math.round(delay / 1000)} s`);
	}

	private async request(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response>
	{
		const url = new URL(input instanceof Request ? input.url : String(input));
		const state = this.host(url.hostname);
		let retries = 0;
		for (;;)
		{
			await this.acquire(state);
			let response: Response;
			try
			{
				const answered = await this.fetchImpl(input, init);
				// Read the body inside the slot: a request is in flight until its answer is in.
				const body = await answered.arrayBuffer();
				response = new Response(NULL_BODY_STATUSES.has(answered.status) ? null : body, {
					status: answered.status,
					statusText: answered.statusText,
					headers: answered.headers,
				});
			}
			catch (error)
			{
				this.release(state);
				if (++retries >= RETRY_ATTEMPTS) throw error;
				this.backOff(state, url.hostname, `request failed (${error instanceof Error ? error.message : String(error)})`, undefined);
				continue;
			}
			this.release(state);
			const throttled = response.status === 429;
			if (throttled || response.status >= 500)
			{
				if (!throttled && ++retries >= RETRY_ATTEMPTS) return response;
				this.backOff(state, url.hostname, `answered ${response.status}`, retryAfterMs(response.headers.get("retry-after"), this.clock.now()));
				continue;
			}
			state.failures = 0;
			return response;
		}
	}
}
