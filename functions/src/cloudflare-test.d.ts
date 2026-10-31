/**
 * The `cloudflare:test` exports the workerd tests use (S45, S48, S18): `SELF`, the Worker
 * under test as a fetcher; `env`, its bindings; and the Durable Object helpers that run
 * code inside an object and fire its alarm. Declared here rather than pulling in
 * `@cloudflare/workers-types`, which would replace the DOM / Node globals the rest of
 * this package is typed against.
 */
declare module "cloudflare:test"
{
	type Fetcher = { fetch(input: string, init?: RequestInit): Promise<Response> };
	type DurableObjectStub = Fetcher;
	type DurableObjectStorage = { getAlarm(): Promise<number | null>;
		get<T>(key: string): Promise<T | undefined>; };

	export const SELF: Fetcher;
	type Namespace = {
		idFromName(name: string): unknown;
		get(id: unknown): DurableObjectStub;
	};
	export const env: {
		GAME_INGEST: Namespace;
		GAME_HUB: Namespace;
	};
	export function runInDurableObject<R>(stub: DurableObjectStub, callback: (instance: unknown, state: { storage: DurableObjectStorage }) => R | Promise<R>): Promise<R>;
	export function runDurableObjectAlarm(stub: DurableObjectStub): Promise<boolean>;
}
