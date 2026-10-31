/**
 * The live stream itself (S19): see `live.ts` for what it does and why. Kept in its own
 * module so the browser loads it only when a game in its window is open — it stays out of
 * the entry bundle (ADR-026's 200 KB budget).
 */
import { applyIfNewer } from "@bt/domain";
import type { QueryClient } from "@tanstack/react-query";
import type { GamePayload } from "./game.js";
import { gameKey } from "./game.js";

/** Reconnect and fallback timing; tests shorten nothing, they drive fake timers. */
export const LIVE_TIMING = {
	/** First reconnect delay, doubled per failure up to `maxDelayMs`. */
	baseDelayMs: 1000,
	maxDelayMs: 30 * 1000,
	/** Socket closes in a row before falling back to polling. */
	maxFailures: 5,
	/** Polling cadence once fallen back (S25's in-window refetch interval). */
	pollMs: 15 * 1000,
} as const;

/** The part of the browser's WebSocket the stream uses. */
export type LiveSocket = {
	onopen: ((event: unknown) => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: ((event: unknown) => void) | null;
	close(): void;
};

/** The live route for `gamePk` on the page's own host, `ws:` or `wss:` to match. */
export function liveUrl(gamePk: number, since?: number, location: Pick<Location, "protocol" | "host"> = window.location): string
{
	const scheme = location.protocol === "https:" ? "wss:" : "ws:";
	return `${scheme}//${location.host}/api/v1/games/${gamePk}/live${since === undefined ? "" : `?since=${since}`}`;
}

/**
 * The wait before reconnect attempt `attempt` (0-based): exponential from `baseDelayMs`,
 * capped, then scaled by a random factor in [0.5, 1) so many viewers dropped together
 * don't all come back in the same instant.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number
{
	const exponential = Math.min(LIVE_TIMING.maxDelayMs, LIVE_TIMING.baseDelayMs * 2 ** attempt);
	return Math.round(exponential * (0.5 + random() / 2));
}

export type LiveStreamOptions = {
	gamePk: number;
	client: QueryClient;
	/** The game resource's cache writer (`writeGame`), the only way a payload reaches the cache. */
	write: (game: GamePayload) => void;
	openSocket?: (url: string) => LiveSocket;
	random?: () => number;
};

export class LiveGameStream
{
	private socket: LiveSocket | null = null;
	private failures = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	private stopped = false;
	private readonly openSocket: (url: string) => LiveSocket;

	constructor(private readonly options: LiveStreamOptions)
	{
		this.openSocket = options.openSocket ?? ((url) => new WebSocket(url) as unknown as LiveSocket);
	}

	/** The version the cache holds for this game, if any. */
	private cachedVersion(): number | undefined
	{
		return this.options.client.getQueryData<GamePayload>(gameKey(this.options.gamePk))?.version;
	}

	start(): void
	{
		this.stopped = false;
		window.addEventListener("online", this.retryNow);
		document.addEventListener("visibilitychange", this.onVisibility);
		this.connect();
	}

	/** Closes the socket and stops every timer and listener (unmount, leaving the route). */
	stop(): void
	{
		this.stopped = true;
		window.removeEventListener("online", this.retryNow);
		document.removeEventListener("visibilitychange", this.onVisibility);
		clearTimeout(this.reconnectTimer);
		clearInterval(this.pollTimer);
		this.pollTimer = undefined;
		this.closeSocket();
	}

	private closeSocket(): void
	{
		const socket = this.socket;
		this.socket = null;
		if (!socket) return;
		socket.onclose = null;
		socket.close();
	}

	private connect(): void
	{
		const socket = this.openSocket(liveUrl(this.options.gamePk, this.cachedVersion()));
		this.socket = socket;
		socket.onopen = () =>
		{
			this.failures = 0;
		};
		socket.onmessage = (event) => this.receive(event.data);
		socket.onclose = () =>
		{
			this.socket = null;
			this.failures += 1;
			if (this.failures >= LIVE_TIMING.maxFailures) this.startPolling();
			else this.reconnectTimer = setTimeout(() => this.connect(), reconnectDelay(this.failures - 1, this.options.random));
		};
	}

	/** One payload: written if newer, a refetch instead if a version was skipped. */
	private receive(data: unknown): void
	{
		const game = JSON.parse(String(data)) as GamePayload;
		const current = this.options.client.getQueryData<GamePayload>(gameKey(this.options.gamePk)) ?? null;
		if (current && game.version > current.version + 1)
		{
			void this.options.client.refetchQueries({
				queryKey: gameKey(this.options.gamePk),
			});
			return;
		}
		if (applyIfNewer(current, game) === game && game !== current) this.options.write(game);
	}

	private startPolling(): void
	{
		if (this.pollTimer !== undefined) return;
		this.pollTimer = setInterval(() =>
		{
			void this.options.client.refetchQueries({
				queryKey: gameKey(this.options.gamePk),
			});
		}, LIVE_TIMING.pollMs);
	}

	/** Back online, or the tab shown again: try the socket now, from a clean slate. */
	private readonly retryNow = (): void =>
	{
		if (this.stopped || this.socket) return;
		clearTimeout(this.reconnectTimer);
		clearInterval(this.pollTimer);
		this.pollTimer = undefined;
		this.failures = 0;
		this.connect();
	};

	private readonly onVisibility = (): void =>
	{
		if (document.visibilityState === "visible") this.retryNow();
	};
}
