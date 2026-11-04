/**
 * `node scripts/wait-for-port.ts <port> [timeoutMs]`: exits 0 once something accepts TCP
 * connections on localhost:<port>, or 1 after the timeout (default 60 s).
 *
 * `pnpm lighthouse:serve` starts the web preview only after the API is listening, so the
 * preview's "Local:" line — the one `lighthouserc.json` waits for — means both servers are up.
 * (Lighthouse CI matches its ready pattern one output chunk at a time, so a single pattern
 * cannot wait for two servers.)
 */

import { connect } from "node:net";

const port = Number(process.argv[2]);
const timeoutMs = Number(process.argv[3] ?? 60_000);

if (!Number.isInteger(port) || port <= 0)
{
	console.error("usage: node scripts/wait-for-port.ts <port> [timeoutMs]");
	process.exit(2);
}

/** Whether one connection attempt to localhost:<port> succeeds. */
function accepts(): Promise<boolean>
{
	return new Promise((resolve) =>
	{
		const socket = connect(port, "localhost");
		socket.once("connect", () =>
		{
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => resolve(false));
	});
}

const deadline = Date.now() + timeoutMs;
while (!(await accepts()))
{
	if (Date.now() > deadline)
	{
		console.error(`wait-for-port: nothing listening on localhost:${port} after ${timeoutMs} ms`);
		process.exit(1);
	}
	await new Promise((resolve) => setTimeout(resolve, 200));
}
