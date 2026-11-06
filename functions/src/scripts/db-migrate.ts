/**
 * `BT_DATABASE_URL=… pnpm db:migrate` (S113): applies the committed Drizzle migrations to the
 * database the connection string names, the production Neon branch included. Every deploy runs it
 * against its own database before the new Worker takes traffic (S114, `.github/workflows/deploy.yml`,
 * with BT_DATABASE_URL from `pnpm deploy:bootstrap`); agents never run it against a hosted database
 * (CLAUDE.md). There is no default: the connection string lives only in the caller's
 * environment and in Cloudflare's Hyperdrive config, never in the repo. Running it again
 * changes nothing.
 */
import { migrateDatabaseAt } from "../adapters/postgres/migrate.js";

const url = process.env.BT_DATABASE_URL;
if (!url)
{
	console.error("[db:migrate] set BT_DATABASE_URL to the database's connection string (Neon: the branch's connection string, with sslmode=require)");
	process.exit(2);
}
// The host only: the connection string carries a password.
const host = new URL(url).hostname;
console.log(`[db:migrate] applying migrations to ${host}…`);
await migrateDatabaseAt(url);
console.log(`[db:migrate] ${host}: up to date`);
