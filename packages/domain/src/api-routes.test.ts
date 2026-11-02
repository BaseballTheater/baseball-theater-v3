import {
	describe, expect, it,
} from "vitest";
import {
	ApiRequestBodies, ApiRoutes, toMeResponse, type ApiResponseFor, type GameSnapshotResponse, type ScheduleDayResponse,
} from "./api-routes.js";
import { entitlementsForTier } from "./entitlements.js";
import type { GameSnapshot, ScheduleDay } from "./types.js";

describe("ApiRoutes", () =>
{
	it("is a runtime-enumerable table covering the schedule, game, digest and account routes", () =>
	{
		expect(Object.keys(ApiRoutes)).toEqual([
			"GET /api/v1/schedule",
			"GET /api/v1/games/:gamePk",
			"GET /api/v1/digest",
			"GET /api/v1/me",
			"POST /api/v1/me/download",
			"GET /api/v1/me/download",
			"GET /api/v1/me/download/:downloadId",
			"POST /api/v1/me/delete",
			"GET /api/v1/me/settings",
			"PUT /api/v1/me/settings",
		]);
		expect(ApiRoutes["GET /api/v1/schedule"]).toBe("ScheduleDayResponse");
		expect(ApiRoutes["GET /api/v1/games/:gamePk"]).toBe("GameSnapshotResponse");
		expect(ApiRoutes["GET /api/v1/digest"]).toBe("DayDigestResponse");
		expect(ApiRoutes["GET /api/v1/me"]).toBe("MeResponse");
		expect(ApiRoutes["POST /api/v1/me/download"]).toBe("MeDownloadResponse");
		expect(ApiRoutes["GET /api/v1/me/download"]).toBe("MeDownloadResponse");
		expect(ApiRoutes["GET /api/v1/me/download/:downloadId"]).toBe("MeDownloadFileResponse");
		expect(ApiRoutes["POST /api/v1/me/delete"]).toBe("MeDeleteResponse");
		expect(ApiRoutes["GET /api/v1/me/settings"]).toBe("SettingsResponse");
		// Only the delete (S77) and settings write (S6) routes take a body.
		expect(ApiRequestBodies).toEqual({
			"POST /api/v1/me/delete": "MeDeleteRequest",
			"PUT /api/v1/me/settings": "SettingsRequest",
		});
	});
});

describe("toMeResponse", () =>
{
	it("keeps only the wire fields of a stored user", () =>
	{
		const entitlements = entitlementsForTier("Backer");
		expect(toMeResponse({
			uid: "u1",
			email: "a@b.test",
			displayName: "A",
			patreonUserId: "p1",
			role: "member",
			entitlements,
			createdAt: "2024-07-04T00:00:00.000Z",
			updatedAt: "2024-07-04T00:00:00.000Z",
		})).toEqual({
			uid: "u1",
			email: "a@b.test",
			role: "member",
			entitlements,
		});
	});
});

/**
 * Never called — tsc type-checks a function body whether or not it runs (this
 * file is transformed, not type-checked, when vitest imports it; the real
 * proof is `pnpm --filter @bt/domain exec tsc --noEmit`).
 *
 * Proves each response alias is mutually assignable with its domain type
 * today: if a mapping function ever makes them diverge, one of these four
 * assignments starts failing to typecheck — which is exactly the point.
 */
function assertResponseAliasesStayInSync(
	schedule: ScheduleDay,
	scheduleResponse: ScheduleDayResponse,
	game: GameSnapshot,
	gameResponse: GameSnapshotResponse,
): void
{
	const a: ScheduleDayResponse = schedule;
	const b: ScheduleDay = scheduleResponse;
	const c: GameSnapshotResponse = game;
	const d: GameSnapshot = gameResponse;
	void a;
	void b;
	void c;
	void d;
}
void assertResponseAliasesStayInSync;

/** Same proof, routed through `ApiResponseFor` the way the handlers use it. */
function assertApiResponseForResolves(
	schedule: ApiResponseFor<"GET /api/v1/schedule">,
	game: ApiResponseFor<"GET /api/v1/games/:gamePk">,
): void
{
	const a: ScheduleDay = schedule;
	const b: GameSnapshot = game;
	void a;
	void b;
}
void assertApiResponseForResolves;
