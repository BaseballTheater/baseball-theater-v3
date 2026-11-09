/**
 * Out-of-window refresh-on-read: staleness + single-flight + cooldown.
 *
 * ADR-002 keeps MLB egress backend-only and bounded by game windows. A game
 * outside its active window is served from the BT store (`windowMode: "cache"`);
 * this module decides *when* such a read is allowed to trigger one upstream
 * refresh, and makes sure a burst of concurrent reads for the same entity — or
 * a hot entity read again moments later — cannot fan out into repeated shared
 * egress.
 *
 * It adds three things on top of the existing `getOrRefreshGame` /
 * `getOrRefreshSchedule` read path; it does not introduce a new one.
 */

/**
 * The floor of refresh-on-read: how long a `windowMode: "cache"` entity is served
 * without re-checking upstream when nothing says how long it has gone unchanged.
 * Since S47 the lifetime grows with `cacheLifetimeMs(now − lastChangedAt)`
 * (ADR-021) and this is only its bottom rung (`CACHE_LIFETIME_FLOOR_MS`, five
 * minutes), kept as the documented floor and as `isStale`'s default.
 */
export const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Minimum gap between two upstream refreshes for the same key, even when the
 * entity is stale again by the TTL. This is the rate-limit / cooldown that
 * stops a single hot key from pulling MLB on every read once its TTL lapses.
 * One minute.
 */
export const REFRESH_COOLDOWN_MS = 60 * 1000;

/** True when `fetchedAt` is missing, unparseable, or older than `ttlMs`. */
export function isStale(
	fetchedAt: string | undefined | null,
	now: Date,
	ttlMs: number = CACHE_TTL_MS,
): boolean
{
	if (!fetchedAt) return true;
	const t = Date.parse(fetchedAt);
	if (Number.isNaN(t)) return true;
	return now.getTime() - t >= ttlMs;
}

/**
 * Per-key single-flight + cooldown coordinator for upstream refreshes.
 *
 * - **Single-flight:** while a refresh for a key is in flight, every other
 *   caller for that key awaits the same promise instead of starting its own.
 * - **Cooldown:** after a refresh settles, further refreshes for that key are
 *   suppressed until `cooldownMs` has passed; `run` resolves `undefined` so the
 *   caller falls back to the cached entity.
 */
export class RefreshCoordinator
{
	private readonly inFlight = new Map<string, Promise<unknown>>();
	/** When each key's last refresh settled, however it went: what the cooldown counts from. */
	private readonly lastAttemptAt = new Map<string, number>();
	/** When each key's last refresh that counts as a check settled: what {@link lastRefreshedAt} says. */
	private readonly lastRefreshAt = new Map<string, number>();

	constructor(
		private readonly now: () => Date = () => new Date(),
		private readonly cooldownMs: number = REFRESH_COOLDOWN_MS,
	) {}

	/**
	 * When the last refresh of `key` that counts as a check settled (epoch ms), or undefined if
	 * none has. Without a `countsAsCheck` predicate every settled refresh counts, thrown or not.
	 */
	lastRefreshedAt(key: string): number | undefined
	{
		return this.lastRefreshAt.get(key);
	}

	/** Whether a refresh for `key` is outside its cooldown right now (counted from any attempt). */
	canRefresh(key: string): boolean
	{
		const last = this.lastAttemptAt.get(key);
		if (last === undefined) return true;
		return this.now().getTime() - last >= this.cooldownMs;
	}

	/**
   * Run `fn` for `key` at most once concurrently. Returns `undefined` without
   * calling `fn` when the key is still within its cooldown.
   *
   * `countsAsCheck` says whether a resolved result counts as a check of `key` (S124: a month
   * fill that failed must not wait out a lifetime it never earned). With it, a refresh that
   * throws or that it rejects still starts the cooldown but leaves {@link lastRefreshedAt} as
   * it was. Without it, every settled refresh counts, as before S124.
   */
	async run<T>(key: string, fn: () => Promise<T>, countsAsCheck?: (result: T) => boolean): Promise<T | undefined>
	{
		const existing = this.inFlight.get(key) as Promise<T> | undefined;
		if (existing) return existing;
		if (!this.canRefresh(key)) return undefined;

		const pending = (async () =>
		{
			let checked = countsAsCheck === undefined;
			try
			{
				const result = await fn();
				if (countsAsCheck) checked = countsAsCheck(result);
				return result;
			}
			finally
			{
				const at = this.now().getTime();
				this.lastAttemptAt.set(key, at);
				if (checked) this.lastRefreshAt.set(key, at);
				this.inFlight.delete(key);
			}
		})();
		this.inFlight.set(key, pending);
		return pending;
	}
}
