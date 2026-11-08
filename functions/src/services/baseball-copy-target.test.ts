/**
 * The copy's refusal to write production (S117 AC 5), with a fake Neon API: no network.
 */
import {
	describe, expect, it,
} from "vitest";
import type { NeonApi, NeonBranch } from "../deploy/bootstrap.js";
import {
	checkCopyTarget, copyTargetEnv, neonCopyDatabases,
} from "./baseball-copy-target.js";

const PROD_HOST = "ep-prod-1.us-east-2.aws.neon.tech";
const STAGE_HOST = "ep-stage-2.us-east-2.aws.neon.tech";
const PROD = `postgresql://owner:prod-secret@${PROD_HOST}/neondb?sslmode=require`; // ggignore
const STAGE = `postgresql://owner:stage-secret@${STAGE_HOST}/neondb?sslmode=require`; // ggignore

function fakeNeon(branches: NeonBranch[] = [{
	id: "br-prod",
	name: "main",
	default: true,
}, {
	id: "br-stage",
	name: "staging",
	init_source: "parent-schema",
}]): { api: NeonApi;
	asked: string[];
	methods: string[]; }
{
	const asked: string[] = [];
	const methods: string[] = [];
	return {
		asked,
		methods,
		api: {
			projectId: "proj",
			apiKey: "key",
			fetch: async (input, init) =>
			{
				asked.push(input);
				methods.push(init?.method ?? "GET");
				if (init?.method === "POST") return Response.json({
					branch: {
						id: "br-new",
						name: "staging",
						current_state: "ready",
					},
				});
				if (input.endsWith("/branches")) return Response.json({
					branches,
				});
				if (input.endsWith("/endpoints")) return Response.json({
					endpoints: [{
						host: PROD_HOST,
						branch_id: "br-prod",
					}, {
						host: STAGE_HOST,
						branch_id: "br-stage",
					}],
				});
				const databases = /\/branches\/([^/]+)\/databases$/.exec(input);
				if (databases) return Response.json({
					databases: [{
						name: "neondb",
						owner_name: "owner",
					}],
				});
				const uri = /connection_uri\?(.*)$/.exec(input);
				if (uri) return Response.json({
					uri: new URLSearchParams(uri[1]).get("branch_id") === "br-prod" ? PROD : STAGE,
				});
				return new Response("", {
					status: 404,
				});
			},
		},
	};
}

describe("the copy's target (S117 AC 5)", () =>
{
	it("production: production and bt-production are refused by name; staging and bt-staging mean staging", () =>
	{
		expect(copyTargetEnv("production")).toEqual({
			refused: "production is production; the copy reads production and never writes it",
		});
		expect(copyTargetEnv("bt-production")).toEqual({
			refused: "bt-production is production; the copy reads production and never writes it",
		});
		expect(copyTargetEnv("staging")).toEqual({
			env: "staging",
		});
		expect(copyTargetEnv("bt-staging")).toEqual({
			env: "staging",
		});
		expect(copyTargetEnv("preview")).toHaveProperty("refused");
	});

	it("production: the production branch's endpoint is refused as a target, pooled or not, with no override offered", async () =>
	{
		const { api } = fakeNeon();
		const pooled = PROD.replace("ep-prod-1", "ep-prod-1-pooler");
		for (const target of [PROD, pooled])
		{
			const check = await checkCopyTarget("postgres://u:p@localhost/src", target, { // ggignore
				neon: api,
			});
			expect(check.allowed).toBe(false);
			expect(check.why).toContain("default branch, production");
			expect(check.why).not.toContain("--allow-production");
			expect(JSON.stringify(check)).not.toContain("prod-secret");
		}
	});

	it("production: the source database itself is refused, even when it is local", async () =>
	{
		expect(await checkCopyTarget(PROD, PROD.replace("ep-prod-1", "ep-prod-1-pooler"), {})).toMatchObject({
			allowed: false,
			why: "the target is the database the copy reads from (production)",
		});
		const local = "postgres://bt:bt@localhost:5432/bt"; // ggignore
		expect((await checkCopyTarget(local, local, {})).allowed).toBe(false);
	});

	it("production: staging's endpoint is allowed; a hosted target Neon can't place is refused; a ?host= disguise is refused", async () =>
	{
		const { api } = fakeNeon();
		expect(await checkCopyTarget(PROD, STAGE, {
			neon: api,
		})).toMatchObject({
			allowed: true,
		});
		expect(await checkCopyTarget(PROD, "postgres://bt:bt@localhost:5432/bt", {})).toMatchObject({ // ggignore
			allowed: true,
			why: "local database",
		});
		const unknown = await checkCopyTarget(PROD, STAGE, {});
		expect(unknown.allowed).toBe(false);
		expect(unknown.why).not.toContain("--allow-production");
		const disguised = await checkCopyTarget("postgres://u:p@localhost/src", `postgres://owner:x@localhost/neondb?host=${PROD_HOST}`, { // ggignore
			neon: api,
		});
		expect(disguised).toMatchObject({
			allowed: false,
			target: {
				host: PROD_HOST,
			},
		});
	});

	it("production: Neon gives production as the source and staging as the target; a production name never reaches Neon", async () =>
	{
		const { api, asked } = fakeNeon();
		expect(await neonCopyDatabases(api, "staging")).toEqual({
			source: PROD,
			target: STAGE,
		});
		const quiet = fakeNeon();
		await expect(neonCopyDatabases(quiet.api, "bt-production")).rejects.toThrow(/is production/);
		expect(quiet.asked).toEqual([]);
		expect(asked.length).toBeGreaterThan(0);
	});

	it("production: a staging branch that is production's default branch, or began with its data, is refused", async () =>
	{
		const same = fakeNeon([{
			id: "br-prod",
			name: "staging",
			default: true,
		}]);
		await expect(neonCopyDatabases(same.api, "staging")).rejects.toThrow(/staging/);
		const copied = fakeNeon([{
			id: "br-prod",
			name: "main",
			default: true,
		}, {
			id: "br-stage",
			name: "staging",
			init_source: "parent-data",
		}]);
		await expect(neonCopyDatabases(copied.api, "staging")).rejects.toThrow(/began as a copy of production's data/);
	});

	it("production: with no staging branch yet, the copy refuses and says to deploy staging first, creating nothing", async () =>
	{
		const none = fakeNeon([{
			id: "br-prod",
			name: "main",
			default: true,
		}]);
		await expect(neonCopyDatabases(none.api, "staging")).rejects.toThrow(/deploy staging first/);
		expect(none.methods.filter((method) => method !== "GET")).toEqual([]);
	});
});
