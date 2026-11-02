/**
 * One in-process API request over the committed fixtures, signed out (S2, S10, S65):
 * the route tests for the recorded 823823 game and the 2026-09-05 schedule share it
 * rather than each building the context (the `account-harness.ts` precedent).
 */
import { createDevAccountData, createDevAuth } from "../adapters/fixtures/auth.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository,
	InMemoryGameRepository,
	InMemoryScheduleRepository,
	InMemorySettingsRepository,
} from "../adapters/memory/repos.js";
import type { ApiContext } from "./api.js";
import { handleApiRequest } from "./api.js";

/**
 * `GET <path>` against fresh in-memory stores backed by `FixtureMlbStatsClient`. `extra`
 * supplies a usage log or a version lifecycle of the test's own (S28).
 */
export function fixtureGet(path: string, extra: Pick<ApiContext, "usage" | "versions"> = {}): Promise<Response>
{
	const auth = createDevAuth();
	const settings = new InMemorySettingsRepository();
	return handleApiRequest(new Request(`http://localhost:8787${path}`), {
		ingest: {
			mlb: new FixtureMlbStatsClient(),
			schedules: new InMemoryScheduleRepository(),
			games: new InMemoryGameRepository(),
			projections: new InMemoryGameProjectionRepository(),
		},
		auth,
		settings,
		account: createDevAccountData({
			users: auth.users,
			settings,
		}),
		...extra,
	});
}
