/**
 * The Workers runtime's WebSocket pieces (S18), behind three functions so the hub's logic
 * is tested in Node with stand-ins: `WebSocketPair`, a `101` upgrade response (Node's
 * `Response` refuses status 101) and the request / response pair the runtime answers
 * pings with while the hub hibernates. Declared here rather than pulling in
 * `@cloudflare/workers-types` (see `cloudflare-test.d.ts`).
 */

/** The socket API the hub uses. */
export type HubSocket = {
	send(message: string): void;
	close(code?: number, reason?: string): void;
};

declare const WebSocketPair: new () => Record<0 | 1, HubSocket>;
declare const WebSocketRequestResponsePair: new (request: string, response: string) => unknown;

/** A connected pair: `client` goes back in the upgrade response, `server` stays with the hub. */
export function openSocketPair(): { client: HubSocket;
	server: HubSocket; }
{
	const pair = new WebSocketPair();
	return {
		client: pair[0],
		server: pair[1],
	};
}

/** The `101 Switching Protocols` answer that hands `client` to the browser. */
export function upgradeResponse(client: HubSocket): Response
{
	return new Response(null, {
		status: 101,
		webSocket: client,
	} as ResponseInit);
}

/** `"ping"` is answered `"pong"` by the runtime itself, without waking the hub. */
export function pingAutoResponse(): unknown
{
	return new WebSocketRequestResponsePair("ping", "pong");
}
