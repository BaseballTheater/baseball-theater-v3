/**
 * The one `cloudflare:test` export the workerd tests use (S45): `SELF`, the Worker
 * under test as a fetcher. Declared here rather than pulling in
 * `@cloudflare/workers-types`, which would replace the DOM / Node globals the rest of
 * this package is typed against.
 */
declare module "cloudflare:test"
{
	export const SELF: { fetch(input: string, init?: RequestInit): Promise<Response> };
}
