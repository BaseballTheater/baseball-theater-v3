/**
 * `pnpm deploy:bootstrap <preview|staging|production> [--pr <number>]` (S114): the deploy
 * workflow's bootstrapping step (`.github/workflows/deploy.yml`), run before `pnpm db:migrate`,
 * `pnpm db:reapply-deletions` and `wrangler deploy` on every deploy. It finds, or creates when
 * missing, the env's Neon branch and Hyperdrive config (`src/deploy/bootstrap.ts`), then writes
 * what the next steps read:
 *
 * - `BT_DATABASE_URL` (the branch's connection string, masked in the log) to `$GITHUB_ENV`;
 * - `.wrangler/deploy/wrangler.json`, the config to deploy with (the Hyperdrive id resolved by name);
 * - the Worker secrets as JSON in `$RUNNER_TEMP`, for `wrangler deploy --secrets-file`;
 * - `config`, `secrets_file` and `origin` to `$GITHUB_OUTPUT`.
 *
 * It reads `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEON_API_KEY`, `NEON_PROJECT_ID` and
 * every Worker secret `workerSecretNames(env)` lists (production adds Logto's, S116) from the job's env, which the workflow maps from GitHub secrets and
 * variables. Running it again changes nothing. Agents never run it (CLAUDE.md): it reaches hosted
 * Cloudflare and Neon, and only the workflow on GitHub holds their keys.
 */
import {
	appendFileSync, mkdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
	dirname, join, relative, resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { openPostgres } from "../adapters/postgres/connect.js";
import type { DeployEnv } from "../deploy/bootstrap.js";
import {
	bootstrapDeploy, DEPLOY_ENVS, parseWranglerConfig, prepareSchemaOnlyCopy,
} from "../deploy/bootstrap.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT_DIR = join(ROOT, ".wrangler", "deploy");

function required(name: string): string
{
	const value = process.env[name];
	if (!value)
	{
		console.error(`[deploy:bootstrap] ${name} is not set (a GitHub secret or variable the workflow maps)`);
		process.exit(2);
	}
	return value;
}

const [envArg, ...rest] = process.argv.slice(2);
if (!DEPLOY_ENVS.includes(envArg as DeployEnv))
{
	console.error(`[deploy:bootstrap] usage: deploy:bootstrap <${DEPLOY_ENVS.join("|")}> [--pr <number>]`);
	process.exit(2);
}
const env = envArg as DeployEnv;
const prFlag = rest.indexOf("--pr");
const pullRequest = prFlag >= 0 ? Number(rest[prFlag + 1]) : undefined;

const plan = await bootstrapDeploy({
	cloudflare: {
		accountId: required("CLOUDFLARE_ACCOUNT_ID"),
		token: required("CLOUDFLARE_API_TOKEN"),
		fetch,
	},
	neon: {
		projectId: required("NEON_PROJECT_ID"),
		apiKey: required("NEON_API_KEY"),
		fetch,
	},
	wrangler: parseWranglerConfig(readFileSync(join(ROOT, "wrangler.jsonc"), "utf8")),
	rebase: (path) => relative(OUT_DIR, resolve(ROOT, path)),
	secrets: process.env,
	prepareCopy: async (url) =>
	{
		const { db, close } = await openPostgres(url);
		try
		{
			return await prepareSchemaOnlyCopy(db);
		}
		finally
		{
			await close();
		}
	},
}, env, pullRequest);

// Mask before anything could print it: the connection string carries the branch's password.
console.log(`::add-mask::${plan.databaseUrl}`);
console.log(`::add-mask::${decodeURIComponent(new URL(plan.databaseUrl).password)}`);

mkdirSync(OUT_DIR, {
	recursive: true,
});
const configPath = join(OUT_DIR, "wrangler.json");
writeFileSync(configPath, `${JSON.stringify(plan.config, null, "\t")}\n`);
const secretsPath = join(process.env.RUNNER_TEMP ?? tmpdir(), `worker-secrets-${env}.json`);
writeFileSync(secretsPath, JSON.stringify(plan.secrets), {
	mode: 0o600,
});

if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `BT_DATABASE_URL=${plan.databaseUrl}\n`);
if (process.env.GITHUB_OUTPUT)
{
	appendFileSync(process.env.GITHUB_OUTPUT, `config=${configPath}\nsecrets_file=${secretsPath}\norigin=${plan.appOrigin ?? String(plan.config.env?.[env]?.vars?.BT_APP_ORIGIN ?? "")}\n`);
}
const host = new URL(plan.databaseUrl).hostname;
console.log(`[deploy:bootstrap] ${env}: database ${host}, Hyperdrive ${plan.hyperdriveId}${plan.workerName ? `, Worker ${plan.workerName}` : ""}`);
console.log(plan.created.length ? `[deploy:bootstrap] created: ${plan.created.join("; ")}` : "[deploy:bootstrap] everything already existed; nothing changed");
