/**
 * `GET /api/v1/games/:gamePk/live` (S18; ADR-020, ADR-021): a WebSocket for a game in its
 * ADR-002 window, handed to the game's hub. A finished or not-yet-started game has no
 * socket — it is cached HTTP — so the answer points at `GET /api/v1/games/:gamePk`, which
 * clients also short-poll when a socket can't be had. A streaming route: it sits outside
 * `ApiRoutes` and the OpenAPI spec (`STREAMING_ROUTE_EXCEPTIONS`).
 */
import { isGameInActiveWindow } from "@bt/domain";
import { getOrRefreshGame } from "../services/ingest.js";
import type { ApiContext } from "./api.js";

function refuse(status: number, error: string, hint: string): Response
{
	return Response.json({
		error,
		hint,
	}, {
		status,
	});
}

export async function liveUpgrade(gamePk: number, request: Request, ctx: ApiContext): Promise<Response>
{
	const cached = `/api/v1/games/${gamePk}`;
	if (request.headers.get("Upgrade") !== "websocket") return refuse(426, "websocket_required", cached);
	const game = await getOrRefreshGame(ctx.ingest, gamePk);
	if (!game) return refuse(404, "not_found", cached);
	if (!isGameInActiveWindow(game, ctx.ingest.now?.() ?? new Date())) return refuse(409, "not_live", cached);
	if (!ctx.live) return refuse(501, "live_unavailable", cached);
	return ctx.live(gamePk, request);
}
