/**
 * The backfill's database guard (S122 AC 1) with a fake Neon API: no network.
 */
import {
	describe, expect, it,
} from "vitest";
import type { NeonApi } from "../deploy/bootstrap.js";
import { checkBackfillTarget } from "./backfill-target.js";

const HOST = "ep-quiet-1234.us-east-2.aws.neon.tech";

function fakeNeon(endpoints: { host: string;
	branch_id: string; }[]): { api: NeonApi;
	asked: string[]; }
{
	const asked: string[] = [];
	return {
		asked,
		api: {
			projectId: "proj",
			apiKey: "key",
			fetch: async (input) =>
			{
				asked.push(input);
				if (input.endsWith("/branches")) return Response.json({
					branches: [{
						id: "br-prod",
						name: "main",
						default: true,
					}, {
						id: "br-stage",
						name: "staging",
					}],
				});
				if (input.endsWith("/endpoints")) return Response.json({
					endpoints,
				});
				return new Response("", {
					status: 404,
				});
			},
		},
	};
}

describe("checkBackfillTarget (S122 AC 1)", () =>
{
	it("production: a local database is always allowed, without asking Neon", async () =>
	{
		const { api, asked } = fakeNeon([]);
		for (const url of ["postgres://bt:bt@localhost:5432/bt", "postgres://bt:bt@127.0.0.1/bt", "postgres://bt@postgres:5432/bt"])
		{
			const check = await checkBackfillTarget(url, {
				allowProduction: false,
				neon: api,
			});
			expect(check.allowed).toBe(true);
		}
		expect(asked).toEqual([]);
	});

	it("production: a hosted database is refused when Neon can't be asked, and the message names no password", async () =>
	{
		const check = await checkBackfillTarget(`postgres://owner:s3cret@${HOST}/neondb`, {
			allowProduction: false,
		});
		expect(check.allowed).toBe(false);
		expect(check.target).toEqual({
			host: HOST,
			name: "neondb",
		});
		expect(check.why).toContain("--allow-production");
		expect(check.why).not.toContain("s3cret");
	});

	it("production: the default branch's endpoint is refused, pooled or not", async () =>
	{
		const { api } = fakeNeon([{
			host: HOST,
			branch_id: "br-prod",
		}]);
		for (const host of [HOST, "ep-quiet-1234-pooler.us-east-2.aws.neon.tech"])
		{
			const check = await checkBackfillTarget(`postgres://o:p@${host}/neondb`, {
				allowProduction: false,
				neon: api,
			});
			expect(check.allowed).toBe(false);
			expect(check.why).toContain("default branch");
		}
	});

	it("production: another branch's endpoint is allowed; an unknown host is refused", async () =>
	{
		const { api } = fakeNeon([{
			host: HOST,
			branch_id: "br-stage",
		}]);
		expect((await checkBackfillTarget(`postgres://o:p@${HOST}/neondb`, {
			allowProduction: false,
			neon: api,
		})).allowed).toBe(true);
		const unknown = await checkBackfillTarget("postgres://o:p@db.example.com/x", {
			allowProduction: false,
			neon: api,
		});
		expect(unknown.allowed).toBe(false);
		expect(unknown.why).toContain("not an endpoint");
	});

	it("production: --allow-production lets a hosted database through without asking Neon", async () =>
	{
		const { api, asked } = fakeNeon([]);
		const check = await checkBackfillTarget(`postgres://o:p@${HOST}/neondb`, {
			allowProduction: true,
			neon: api,
		});
		expect(check.allowed).toBe(true);
		expect(asked).toEqual([]);
	});
});
