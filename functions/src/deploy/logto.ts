/**
 * Production's Logto app settings, set on every production deploy (S116 AC 5; owner,
 * 2026-11-05: "Agreed on all points", and "All the bootstrapping should be like that"), so no
 * production address is ever typed into Logto's console. `pnpm deploy:logto production`
 * (`src/scripts/deploy-logto.ts`) runs it in the `production-logto` job only, after the
 * `production` job, through production's one machine-to-machine app. It is a job of its own so
 * production's environment deployment status reflects only the Worker deploy, which the Release
 * order step reads to allow a rollback re-run (Claude's review of PR #51). Staging has none, so its tenant's few addresses are entered once
 * by hand (README).
 *
 * Two settings, each read first and written only when it differs, so a second run changes
 * nothing:
 *
 * - the single-page app's redirect and sign-out addresses, derived from production's one
 *   `BT_APP_ORIGIN` by `logtoAppUris` (`@bt/domain`), the same function the web app uses, so
 *   the owner's DNS cutover (README, S119) moves them along with the origin;
 * - the sign-in experience: email, with a one-time code and no password, for sign-up and
 *   sign-in (ADR-019; FEATURES, Modern membership: "Code if I have to choose").
 */
import type { LogtoAppUris } from "@bt/domain";
import { logtoAppUris } from "@bt/domain";
import type { LogtoManagementApi } from "../adapters/logto/admin.js";
import type { WranglerConfig } from "./bootstrap.js";

/** What production's deploy registers, all read from `wrangler.jsonc` env `production`. */
export type LogtoAppTarget = {
	/** The single-page app whose addresses are set (`LOGTO_APP_ID`). */
	appId: string;
	/** Production's origin (`BT_APP_ORIGIN`), which every address derives from. */
	origin: string;
	/** The tenant's own ID (`LOGTO_TENANT_ID`), for the Management API. */
	tenantId: string;
};

/** Production's Logto target from `wrangler.jsonc`; a missing var fails the deploy rather than registering nothing. */
export function productionLogtoTarget(wrangler: WranglerConfig): LogtoAppTarget
{
	const vars = wrangler.env?.production?.vars ?? {};
	const missing = ["LOGTO_APP_ID", "BT_APP_ORIGIN", "LOGTO_TENANT_ID"].filter((name) => !vars[name]);
	if (missing.length) throw new Error(`wrangler.jsonc env.production names no ${missing.join(", ")}`);
	return {
		appId: vars.LOGTO_APP_ID!,
		origin: vars.BT_APP_ORIGIN!,
		tenantId: vars.LOGTO_TENANT_ID!,
	};
}

/** The sign-up and sign-in settings for email with a one-time code and no password. */
export const EMAIL_CODE_SIGN_UP = {
	identifiers: ["email"],
	password: false,
	verify: true,
};

export const EMAIL_CODE_SIGN_IN = {
	methods: [{
		identifier: "email",
		password: false,
		verificationCode: true,
		isPasswordPrimary: false,
	}],
};

/** Whether `current` already holds every field of `wanted` with the same value (JSON-equal). */
function holds(current: unknown, wanted: object): boolean
{
	if (current === null || typeof current !== "object") return false;
	return Object.entries(wanted).every(([key, value]) => JSON.stringify((current as Record<string, unknown>)[key]) === JSON.stringify(value));
}

/**
 * Sets the app's addresses and the email one-time-code sign-in on the tenant `api` reaches.
 * Returns what this run changed; empty when everything was already set.
 */
export async function registerLogtoApp(api: LogtoManagementApi, target: LogtoAppTarget): Promise<string[]>
{
	const changed: string[] = [];
	const wanted: LogtoAppUris = logtoAppUris(target.origin);
	const app = await api.json<{ oidcClientMetadata?: Partial<LogtoAppUris> }>("GET", `/applications/${encodeURIComponent(target.appId)}`);
	if (!holds(app.oidcClientMetadata, wanted))
	{
		await api.call("PATCH", `/applications/${encodeURIComponent(target.appId)}`, {
			oidcClientMetadata: wanted,
		});
		changed.push(`redirect and sign-out URIs for ${target.origin}`);
	}
	const experience = await api.json<{ signUp?: Record<string, unknown>;
		signIn?: Record<string, unknown>; }>("GET", "/sign-in-exp");
	if (!holds(experience.signUp, EMAIL_CODE_SIGN_UP) || !holds(experience.signIn, EMAIL_CODE_SIGN_IN))
	{
		await api.call("PATCH", "/sign-in-exp", {
			// Fields BT doesn't set (e.g. secondary identifiers) stay as the owner left them.
			signUp: {
				...experience.signUp,
				...EMAIL_CODE_SIGN_UP,
			},
			signIn: EMAIL_CODE_SIGN_IN,
		});
		changed.push("email one-time-code sign-in");
	}
	return changed;
}
