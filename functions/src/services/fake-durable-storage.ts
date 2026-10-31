/**
 * Durable Object storage with its alarm, in memory (S48): what `state.storage` gives the
 * ingest object, for Node tests of `GameIngest` and `HubLeases`. Values are cloned on the
 * way in, as Durable Object storage serializes them.
 */
import type { AlarmStore } from "./game-ingest.js";

export class FakeDurableStorage implements AlarmStore
{
	readonly values = new Map<string, unknown>();
	alarmAt: number | null = null;
	/** Every alarm time set, in order — tests count arms with it. */
	readonly armed: number[] = [];

	async get<T>(key: string): Promise<T | undefined>
	{
		return this.values.get(key) as T | undefined;
	}

	async put<T>(key: string, value: T): Promise<void>
	{
		this.values.set(key, structuredClone(value));
	}

	async delete(key: string): Promise<boolean>
	{
		return this.values.delete(key);
	}

	async getAlarm(): Promise<number | null>
	{
		return this.alarmAt;
	}

	async setAlarm(scheduledTime: number): Promise<void>
	{
		this.alarmAt = scheduledTime;
		this.armed.push(scheduledTime);
	}

	async deleteAlarm(): Promise<void>
	{
		this.alarmAt = null;
	}
}
