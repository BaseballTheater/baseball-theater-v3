/**
 * Where the baseball-data copy may write (S117 AC 5): never production. It reuses what already
 * marks production rather than a new rule of its own: the Neon project's default branch
 * (`findOrCreateBranch`), its Hyperdrive config's name (`HYPERDRIVE_CONFIG.production`,
 * `bt-production`), and S122's target guard (`checkBackfillTarget`, which reads the host pg really
 * connects to with `databaseTarget`, so a `?host=` parameter can't disguise production) with no
 * override at all: the copy has no `--allow-production`. A target that is the source database
 * itself is refused too, since the source is production.
 */
import { databaseTarget } from "../adapters/postgres/local.js";
import type { DeployEnv, NeonApi } from "../deploy/bootstrap.js";
import {
	branchConnectionString, findOrCreateBranch, HYPERDRIVE_CONFIG,
} from "../deploy/bootstrap.js";
import type { TargetCheck } from "./backfill-target.js";
import { checkBackfillTarget, endpointHost } from "./backfill-target.js";

/**
 * The deployed env a named copy target means: `staging` (or its Hyperdrive config, `bt-staging`).
 * Production, by env or by `bt-production`, and any other name are refused with the reason.
 */
export function copyTargetEnv(name: string): { env: DeployEnv } | { refused: string }
{
	if (name === "production" || name === HYPERDRIVE_CONFIG.production) return {
		refused: `${name} is production; the copy reads production and never writes it`,
	};
	if (name === "staging" || name === HYPERDRIVE_CONFIG.staging) return {
		env: "staging",
	};
	return {
		refused: `unknown target ${name}: the copy writes staging (${HYPERDRIVE_CONFIG.staging}) or a database named by BT_DATABASE_URL`,
	};
}

/**
 * Whether the copy may write `targetUrl`, copying from `sourceUrl`. Refused when both name the
 * same database (pooled or not), and otherwise decided by S122's guard with production never
 * allowed: a local database is allowed; a hosted one only when Neon's API shows it is an endpoint
 * of a branch other than the default (production's).
 */
export async function checkCopyTarget(sourceUrl: string, targetUrl: string, options: { neon?: NeonApi }): Promise<TargetCheck>
{
	const source = databaseTarget(sourceUrl);
	const target = databaseTarget(targetUrl);
	if (target.host !== "" && endpointHost(source.host) === endpointHost(target.host) && source.name === target.name) return {
		allowed: false,
		target: {
			host: target.host,
			name: target.name,
		},
		why: "the target is the database the copy reads from (production)",
	};
	return checkBackfillTarget(targetUrl, {
		allowProduction: "never",
		...options.neon && {
			neon: options.neon,
		},
	});
}

/**
 * Both connection strings for a named target, from Neon's API the way deploys find them: the
 * source is production's default branch, the target the env's branch (`findOrCreateBranch`,
 * which also refuses a staging branch that began as a copy of production's data). The strings
 * carry passwords: the caller masks them and logs hosts only.
 */
export async function neonCopyDatabases(neon: NeonApi, name: string): Promise<{ source: string;
	target: string; }>
{
	const resolved = copyTargetEnv(name);
	if ("refused" in resolved) throw new Error(resolved.refused);
	const production = (await findOrCreateBranch(neon, "production")).value;
	const target = (await findOrCreateBranch(neon, resolved.env)).value;
	if (target.id === production.id) throw new Error(`the ${name} branch is production's default branch; the copy never writes production`);
	return {
		source: await branchConnectionString(neon, production.id),
		target: await branchConnectionString(neon, target.id),
	};
}
