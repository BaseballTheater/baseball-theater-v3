/**
 * S19: the live stream for one game — newer versions only through the cache writer, a
 * refetch on a version gap, reconnect with backoff and `?since=`, the polling fallback,
 * and reconnecting on visible / online. A fake socket and fake timers drive it.
 */
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { jsonResponse } from "../test/jsonResponse.js";
import type { GamePayload } from "./game.js";
import {
	gameKey, gameQueryOptions, writeGame,
} from "./game.js";
import type { LiveSocket } from "./live-stream.js";
import {
	LIVE_TIMING, LiveGameStream, liveUrl, reconnectDelay,
} from "./live-stream.js";
import { createQueryClient } from "./queryClient.js";

const PK = 823823;

class FakeSocket implements LiveSocket
{
	onopen: LiveSocket["onopen"] = null;
	onmessage: LiveSocket["onmessage"] = null;
	onclose: LiveSocket["onclose"] = null;
	readonly close = vi.fn();

	constructor(readonly url: string) {}

	open(): void
	{
		this.onopen?.({});
	}

	deliver(version: number, extra: Partial<GamePayload> = {}): void
	{
		this.onmessage?.({
			data: JSON.stringify({
				gamePk: PK,
				version,
				...extra,
			}),
		});
	}

	drop(): void
	{
		this.onclose?.({});
	}
}

function stream(random = () => 0)
{
	const client = createQueryClient();
	const sockets: FakeSocket[] = [];
	const live = new LiveGameStream({
		gamePk: PK,
		client,
		write: (game) => writeGame(client, game),
		random,
		openSocket: (url) =>
		{
			const socket = new FakeSocket(url);
			sockets.push(socket);
			return socket;
		},
	});
	const cached = () => client.getQueryData<GamePayload>(gameKey(PK));
	return {
		client,
		sockets,
		live,
		cached,
		last: () => sockets.at(-1)!,
	};
}

/** Closes the socket `maxFailures` times in a row, letting each backoff run out but not the last. */
function failEveryReconnect(last: () => FakeSocket): void
{
	for (let i = 0; i < LIVE_TIMING.maxFailures; i++)
	{
		last().drop();
		if (i < LIVE_TIMING.maxFailures - 1) vi.advanceTimersByTime(LIVE_TIMING.maxDelayMs);
	}
}

beforeEach(() =>
{
	vi.useFakeTimers();
});

afterEach(() =>
{
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("liveUrl and reconnectDelay", () =>
{
	it("the live route on the page's host, wss under https, with since when known; delays double to the cap, scaled by jitter in [0.5, 1)", () =>
	{
		expect(liveUrl(PK, undefined, {
			protocol: "http:",
			host: "localhost:5173",
		})).toBe("ws://localhost:5173/api/v1/games/823823/live");
		expect(liveUrl(PK, 4, {
			protocol: "https:",
			host: "baseball.theater",
		})).toBe("wss://baseball.theater/api/v1/games/823823/live?since=4");
		expect([0, 1, 2, 10].map((n) => reconnectDelay(n, () => 0))).toEqual([500, 1000, 2000, LIVE_TIMING.maxDelayMs / 2]);
		expect(reconnectDelay(0, () => 0.999)).toBe(1000);
	});
});

describe("LiveGameStream", () =>
{
	it("newer: v2, v2 again, then v1 leaves v2 in the cache, written once", () =>
	{
		const {
			client, live, last, cached,
		} = stream();
		let writes = 0;
		client.getQueryCache().subscribe((event) =>
		{
			if (event.type === "updated" && event.action.type === "success") writes += 1;
		});
		live.start();
		last().open();
		last().deliver(2, {
			officialDate: "v2",
		});
		last().deliver(2, {
			officialDate: "v2 again",
		});
		last().deliver(1, {
			officialDate: "v1",
		});
		expect(cached()?.officialDate).toBe("v2");
		expect(writes).toBe(1);
		live.stop();
	});

	it("gap: v2 then v4 refetches the game instead of writing v4", () =>
	{
		const {
			client, live, last, cached,
		} = stream();
		const refetch = vi.spyOn(client, "refetchQueries").mockResolvedValue();
		live.start();
		last().deliver(2);
		expect(refetch).not.toHaveBeenCalled();
		last().deliver(4);
		expect(refetch).toHaveBeenCalledWith({
			queryKey: gameKey(PK),
		});
		expect(cached()?.version).toBe(2);
		live.stop();
	});

	it("reconnects after a close, with backoff and jitter, passing ?since=<last version>", () =>
	{
		const {
			live, sockets, last,
		} = stream(() => 0);
		live.start();
		expect(last().url).toMatch(/\/api\/v1\/games\/823823\/live$/);
		last().open();
		last().deliver(3);
		last().drop();
		expect(sockets).toHaveLength(1);
		vi.advanceTimersByTime(499);
		expect(sockets).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(sockets).toHaveLength(2);
		expect(last().url).toMatch(/\/live\?since=3$/);
		// A second close in a row waits twice as long.
		last().drop();
		vi.advanceTimersByTime(999);
		expect(sockets).toHaveLength(2);
		vi.advanceTimersByTime(1);
		expect(sockets).toHaveLength(3);
		live.stop();
	});

	it("polling: after repeated failures it polls the cached GET /api/v1/games/:gamePk instead", async () =>
	{
		const {
			client, live, sockets, last,
		} = stream(() => 0);
		const fetch = vi.fn(async () => jsonResponse({
			gamePk: PK,
			version: 1,
		}));
		vi.stubGlobal("fetch", fetch);
		await client.prefetchQuery(gameQueryOptions(PK, true));
		fetch.mockClear();
		live.start();
		failEveryReconnect(last);
		expect(sockets).toHaveLength(LIVE_TIMING.maxFailures);
		expect(fetch).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(LIVE_TIMING.pollMs);
		expect(fetch).toHaveBeenCalledTimes(1);
		const [input] = fetch.mock.calls[0] as unknown as [Request | string];
		expect(input instanceof Request ? input.url : input).toMatch(/\/api\/v1\/games\/823823$/);
		await vi.advanceTimersByTimeAsync(LIVE_TIMING.pollMs);
		expect(fetch).toHaveBeenCalledTimes(2);
		// No more sockets while polling.
		expect(sockets).toHaveLength(LIVE_TIMING.maxFailures);
		live.stop();
	});

	it("visible: a tab shown again while waiting to reconnect connects at once", () =>
	{
		const {
			live, sockets, last,
		} = stream(() => 0);
		live.start();
		last().drop();
		const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		document.dispatchEvent(new Event("visibilitychange"));
		expect(sockets).toHaveLength(1);
		visibility.mockReturnValue("visible");
		document.dispatchEvent(new Event("visibilitychange"));
		expect(sockets).toHaveLength(2);
		// Already connected: nothing more.
		document.dispatchEvent(new Event("visibilitychange"));
		expect(sockets).toHaveLength(2);
		live.stop();
	});

	it("online: coming back online leaves polling for a fresh socket", async () =>
	{
		const {
			client, live, sockets, last,
		} = stream(() => 0);
		const refetch = vi.spyOn(client, "refetchQueries").mockResolvedValue();
		live.start();
		failEveryReconnect(last);
		window.dispatchEvent(new Event("online"));
		expect(sockets).toHaveLength(LIVE_TIMING.maxFailures + 1);
		await vi.advanceTimersByTimeAsync(LIVE_TIMING.pollMs * 2);
		expect(refetch).not.toHaveBeenCalled();
		live.stop();
	});

	it("stop closes the socket, and nothing reconnects or listens afterwards", () =>
	{
		const {
			live, sockets, last,
		} = stream();
		live.start();
		const socket = last();
		live.stop();
		expect(socket.close).toHaveBeenCalledTimes(1);
		window.dispatchEvent(new Event("online"));
		vi.advanceTimersByTime(LIVE_TIMING.maxDelayMs);
		expect(sockets).toHaveLength(1);
		live.stop();
	});
});
