/**
 * `pnpm db:seed` (S51): every committed fixture day (`fixtures/schedule-<date>.json`) ingested
 * into the database the way the cron would — the day, and each finished or in-window game —
 * so local dev opens on stored data, as deployed. Ingest stamps versions and the Postgres
 * adapter writes only what is newer (ADR-022), so seeding again adds no rows and changes
 * nothing that hasn't changed. S112's larger, git-ignored seed loads beside this one.
 */
import type { FixtureFiles } from "../adapters/fixtures/fixture-client.js";
import type { IngestDeps } from "./ingest.js";
import { ingestScheduleDay } from "./ingest.js";

const FIXTURE_DAY = /^schedule-(\d{4}-\d{2}-\d{2})\.json$/;

/** Ingests each committed fixture day through `deps` (whose MLB client serves the fixtures); returns the days, in order. */
export async function seedFromFixtures(deps: IngestDeps, files: FixtureFiles): Promise<string[]>
{
	const days = (await files.list()).map((name) => FIXTURE_DAY.exec(name)?.[1]).filter((day) => day !== undefined).sort();
	for (const day of days) await ingestScheduleDay(deps, day);
	return days;
}
