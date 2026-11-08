/**
 * The body of `pnpm db:copy-baseball` (S117), apart from its entry (`db-copy-baseball.ts`) so it
 * can be tested end to end: the databases, migrator, Neon `fetch` and output are passed in, and it
 * returns the exit code instead of exiting. See `db-copy-baseball.ts` for the two ways to name the
 * databases.
 *
 * Its order is the guarantee: both connection strings are masked in GitHub's log before anything
 * else is printed; the target is checked (`checkCopyTarget`: never production) before either
 * database is opened; only the target is migrated; production is only read
 * (`copyBaseballData`, one read-only transaction per read). Lines name hosts, tables and counts,
 * never a connection string.
 */
import { parse } from "pg-connection-string";
import { databaseTarget } from "../adapters/postgres/local.js";
import type { PostgresDb } from "../adapters/postgres/repos.js";
import type { NeonApi } from "../deploy/bootstrap.js";
import { copyBaseballData } from "../services/baseball-copy.js";
import { checkCopyTarget, neonCopyDatabases } from "../services/baseball-copy-target.js";

/** What the run reaches the world through; the entry passes the real ones. */
export type CopyRunDeps = {
	/** Opens one database (`openPostgres`). */
	open: (connectionString: string) => Promise<{ db: PostgresDb;
		close: () => Promise<void>; }>;
	/** Applies the committed migrations to one database (`migratePostgres`); only ever given the target. */
	migrate: (db: PostgresDb) => Promise<void>;
	/** Neon's API, for `--neon`. */
	fetch: (input: string, init?: RequestInit) => Promise<Response>;
	out: (line: string) => void;
	err: (line: string) => void;
};

const USAGE = "usage: db:copy-baseball [--neon staging] (or set BT_SOURCE_DATABASE_URL and BT_DATABASE_URL)";

/**
 * Runs the copy for `env` and `args` (`process.env`, `process.argv.slice(2)`). Returns 0 when
 * done and 2 when refused or misused; a failure while copying is thrown.
 */
export async function runCopy(env: Record<string, string | undefined>, args: string[], deps: CopyRunDeps): Promise<number>
{
	const say = (line: string) => deps.out(`[db:copy-baseball] ${line}`);
	const refuse = (message: string) =>
	{
		deps.err(`[db:copy-baseball] ${message}`);
		return 2;
	};
	/** Hides a connection string and its password from GitHub's log before anything could print them. */
	const mask = (connectionString: string) =>
	{
		if (env.GITHUB_ACTIONS !== "true") return;
		deps.out(`::add-mask::${connectionString}`);
		const { password } = parse(connectionString);
		if (password) deps.out(`::add-mask::${password}`);
	};

	const neon: NeonApi | undefined = env.NEON_API_KEY && env.NEON_PROJECT_ID
		? {
			apiKey: env.NEON_API_KEY,
			projectId: env.NEON_PROJECT_ID,
			fetch: deps.fetch,
		}
		: undefined;

	let source: string;
	let target: string;
	const neonFlag = args.indexOf("--neon");
	if (neonFlag >= 0)
	{
		const name = args[neonFlag + 1];
		if (!name || args.length !== 2) return refuse("usage: db:copy-baseball --neon staging");
		if (!neon) return refuse("--neon needs NEON_API_KEY and NEON_PROJECT_ID");
		try
		{
			({ source, target } = await neonCopyDatabases(neon, name));
		}
		catch (error)
		{
			return refuse(`refusing: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	else
	{
		if (args.length > 0) return refuse(USAGE);
		const fromEnv = env.BT_SOURCE_DATABASE_URL;
		const toEnv = env.BT_DATABASE_URL;
		if (!fromEnv || !toEnv) return refuse("set BT_SOURCE_DATABASE_URL (production, read only) and BT_DATABASE_URL (the target), or pass --neon staging");
		source = fromEnv;
		target = toEnv;
	}
	mask(source);
	mask(target);

	const check = await checkCopyTarget(source, target, {
		...neon && {
			neon,
		},
	});
	const from = databaseTarget(source);
	const to = `${check.target.host}/${check.target.name}`;
	if (!check.allowed) return refuse(`refusing ${to}: ${check.why}`);

	const reader = await deps.open(source);
	try
	{
		const writer = await deps.open(target);
		try
		{
			say(`copying baseball tables from ${from.host}/${from.name} to ${to}, migrating ${to} first`);
			await copyBaseballData({
				source: reader.db,
				target: writer.db,
				migrateTarget: async () =>
				{
					say(`migrating ${to} (allowed: ${check.why})`);
					await deps.migrate(writer.db);
				},
				log: say,
			});
			say("done: nothing in the target was deleted, and no personal table or deletion log was read or written");
		}
		finally
		{
			await writer.close();
		}
	}
	finally
	{
		await reader.close();
	}
	return 0;
}
