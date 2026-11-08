/**
 * Which database the backfill may write (S122 AC 1). It fails closed: a local host is always
 * allowed; any other host is refused unless the owner passes `--allow-production`, or Neon's
 * API shows the host is one of the project's endpoints on a branch other than the default
 * (production's — the owner kept the default branch as production, `findOrCreateBranch`). A
 * connection string carries no Hyperdrive name and no branch, so without that lookup a hosted
 * host can't be shown not to be production, and is refused. The host is the one pg really
 * connects to (`databaseTarget`, which reads `?host=` as pg does); a string carrying `hostaddr`
 * or naming no host is refused even with `--allow-production`, since where it would connect
 * isn't one clear place. Messages name the host and the database only, never the connection string.
 */
import { databaseTarget, isLocalDbHost } from "../adapters/postgres/local.js";
import type { NeonApi } from "../deploy/bootstrap.js";
import { findOrCreateBranch, projectEndpoints } from "../deploy/bootstrap.js";

/** The database a run writes, by host and name only: what logs print and the resume file is named by. */
export type BackfillTarget = {
	host: string;
	name: string;
};

/** The guard's verdict on a target, with the reason the command prints either way. */
export type TargetCheck =
	| { allowed: true;
		target: BackfillTarget;
		why: string; }
	| { allowed: false;
		target: BackfillTarget;
		why: string; };

/** A Neon host without its pooler suffix: `ep-x-1-pooler.region.aws.neon.tech` → `ep-x-1.region.aws.neon.tech`. */
export function endpointHost(host: string): string
{
	const [first = "", ...rest] = host.split(".");
	return [first.replace(/-pooler$/, ""), ...rest].join(".");
}

/**
 * Decides whether the backfill may write `connectionString`'s database. `neon` is the Neon
 * project's API when `NEON_API_KEY` and `NEON_PROJECT_ID` are set; it is asked only for a
 * hosted database, and never with `--allow-production`. `"never"` is for a command with no
 * such flag (S117's copy, which must never write production): it refuses as `false` does,
 * without suggesting a flag the command doesn't have.
 */
export async function checkBackfillTarget(connectionString: string, options: { allowProduction: boolean | "never";
	neon?: NeonApi; }): Promise<TargetCheck>
{
	const never = options.allowProduction === "never";
	const { hostaddr, ...target } = databaseTarget(connectionString);
	if (hostaddr !== undefined) return {
		allowed: false,
		target,
		why: `the connection string carries hostaddr=${hostaddr}, which pg ignores but psql and pg_dump connect to; name one host`,
	};
	if (target.host === "") return {
		allowed: false,
		target,
		why: "the connection string names no host",
	};
	if (isLocalDbHost(target.host)) return {
		allowed: true,
		target,
		why: "local database",
	};
	if (options.allowProduction === true) return {
		allowed: true,
		target,
		why: "--allow-production",
	};
	if (!options.neon) return {
		allowed: false,
		target,
		why: `${target.host} is not local and can't be shown not to be production (set NEON_API_KEY and NEON_PROJECT_ID${never ? "" : ", or pass --allow-production"})`,
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
		why: `${target.host} is the Neon project's default branch, production${never ? "" : " (pass --allow-production to write it)"}`,
	};
	return {
		allowed: true,
		target,
		why: `Neon branch ${endpoint.branch_id}, not the default branch`,
	};
}
