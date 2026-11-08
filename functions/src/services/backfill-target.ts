/**
 * Which database the backfill may write (S122 AC 1). It fails closed: a local host is always
 * allowed; any other host is refused unless the owner passes `--allow-production`, or Neon's
 * API shows the host is one of the project's endpoints on a branch other than the default
 * (production's — the owner kept the default branch as production, `findOrCreateBranch`). A
 * connection string carries no Hyperdrive name and no branch, so without that lookup a hosted
 * host can't be shown not to be production, and is refused. Messages name the host and the
 * database only, never the connection string.
 */
import { databaseTarget, isLocalDbHost } from "../adapters/postgres/local.js";
import type { NeonApi } from "../deploy/bootstrap.js";
import { findOrCreateBranch, projectEndpoints } from "../deploy/bootstrap.js";

export type BackfillTarget = {
	host: string;
	name: string;
};

export type TargetCheck =
	| { allowed: true;
		target: BackfillTarget;
		why: string; }
	| { allowed: false;
		target: BackfillTarget;
		why: string; };

/** A Neon host without its pooler suffix: `ep-x-1-pooler.region.aws.neon.tech` → `ep-x-1.region.aws.neon.tech`. */
function endpointHost(host: string): string
{
	const [first = "", ...rest] = host.split(".");
	return [first.replace(/-pooler$/, ""), ...rest].join(".");
}

/**
 * Decides whether the backfill may write `connectionString`'s database. `neon` is the Neon
 * project's API when `NEON_API_KEY` and `NEON_PROJECT_ID` are set; it is asked only for a
 * hosted database, and never with `--allow-production`.
 */
export async function checkBackfillTarget(connectionString: string, options: { allowProduction: boolean;
	neon?: NeonApi; }): Promise<TargetCheck>
{
	const target = databaseTarget(connectionString);
	if (isLocalDbHost(target.host)) return {
		allowed: true,
		target,
		why: "local database",
	};
	if (options.allowProduction) return {
		allowed: true,
		target,
		why: "--allow-production",
	};
	if (!options.neon) return {
		allowed: false,
		target,
		why: `${target.host} is not local and can't be shown not to be production (set NEON_API_KEY and NEON_PROJECT_ID, or pass --allow-production)`,
	};
	const production = (await findOrCreateBranch(options.neon, "production")).value;
	const endpoint = (await projectEndpoints(options.neon)).find((e) => endpointHost(e.host) === endpointHost(target.host));
	if (!endpoint) return {
		allowed: false,
		target,
		why: `${target.host} is not an endpoint of the Neon project, so it can't be shown not to be production`,
	};
	if (endpoint.branch_id === production.id) return {
		allowed: false,
		target,
		why: `${target.host} is the Neon project's default branch, production (pass --allow-production to write it)`,
	};
	return {
		allowed: true,
		target,
		why: `Neon branch ${endpoint.branch_id}, not the default branch`,
	};
}
