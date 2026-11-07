/**
 * `pnpm deploy:logto production` (S116 AC 5): the `production` job's Logto step
 * (`.github/workflows/deploy.yml`), run after production's Worker deploys. It registers the
 * single-page app's sign-in and sign-out addresses (from `BT_APP_ORIGIN`) and the email
 * one-time-code sign-in through the Management API (`src/deploy/logto.ts`), changing nothing
 * when they are already set.
 *
 * It reads `LOGTO_S2S_APP_ID` and `LOGTO_S2S_SECRET` from the job's env (production's GitHub
 * secrets) and the tenant and app from `wrangler.jsonc` env `production`. Production only: no
 * other env has a machine-to-machine app. Agents never run it (CLAUDE.md): it reaches the
 * production Logto tenant, whose keys only the workflow on GitHub holds.
 */
import { readFileSync } from "node:fs";
import {
	dirname, join, resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { LogtoManagementApi } from "../adapters/logto/admin.js";
import { parseWranglerConfig } from "../deploy/bootstrap.js";
import { productionLogtoTarget, registerLogtoApp } from "../deploy/logto.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

if (process.argv[2] !== "production")
{
	console.error("[deploy:logto] usage: deploy:logto production (no other env has a machine-to-machine app)");
	process.exit(2);
}
const appId = process.env.LOGTO_S2S_APP_ID;
const secret = process.env.LOGTO_S2S_SECRET;
if (!appId || !secret)
{
	console.error("[deploy:logto] LOGTO_S2S_APP_ID and LOGTO_S2S_SECRET must be set (production's GitHub secrets)");
	process.exit(2);
}
console.log(`::add-mask::${secret}`);

const target = productionLogtoTarget(parseWranglerConfig(readFileSync(join(ROOT, "wrangler.jsonc"), "utf8")));
const changed = await registerLogtoApp(new LogtoManagementApi({
	tenantId: target.tenantId,
	appId,
	secret,
}), target);
console.log(changed.length ? `[deploy:logto] set: ${changed.join("; ")}` : "[deploy:logto] everything was already set; nothing changed");
