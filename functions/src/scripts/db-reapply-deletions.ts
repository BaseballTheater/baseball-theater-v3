/**
 * `BT_DATABASE_URL=… pnpm db:reapply-deletions` (S113): run by every deploy right after
 * `pnpm db:migrate` (S114), so after a backup restore (a Neon point-in-time restore or branch
 * reset) the next deploy deletes again every account the
 * deletion log names, from every registered personal-data store, so a restore never brings a
 * deleted fan back (ADR-028, S77's `reapplyDeletions`). The deletion log itself survives the
 * restore: entries are only ever added. Like `pnpm db:migrate`, only the deploy workflow runs it
 * against a hosted database; agents never do. Running it again changes nothing.
 *
 * The registry here is the Postgres stores (users and their identity links, settings); the
 * download store and mailer are still in-memory until their R2 and Cloudflare Email adapters
 * land (S114 AC 6), so they hold nothing to re-delete yet.
 */
import { openPostgres } from "../adapters/postgres/connect.js";
import {
	PostgresDeletionLog, PostgresSettingsRepository, PostgresUserRepository,
} from "../adapters/postgres/repos.js";
import { createDevAccountData } from "../adapters/fixtures/auth.js";
import { reapplyDeletions } from "../services/account-deletion.js";

const url = process.env.BT_DATABASE_URL;
if (!url)
{
	console.error("[db:reapply-deletions] set BT_DATABASE_URL to the restored database's connection string");
	process.exit(2);
}
const host = new URL(url).hostname;
const { db, close } = await openPostgres(url);
try
{
	const account = createDevAccountData({
		users: new PostgresUserRepository(db),
		settings: new PostgresSettingsRepository(db),
	}, undefined, new PostgresDeletionLog(db));
	const count = await reapplyDeletions(account);
	console.log(`[db:reapply-deletions] ${host}: re-applied ${count} logged deletion(s)`);
}
finally
{
	await close();
}
