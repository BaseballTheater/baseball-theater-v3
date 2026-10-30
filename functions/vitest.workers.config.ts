/**
 * Worker tests (S45; ADR-013 as amended by ADR-017): `*.workerd.test.ts` run inside
 * workerd, the runtime production uses, against the real Worker from `wrangler.jsonc`
 * through `@cloudflare/vitest-pool-workers`. No Cloudflare login: bindings are local
 * and the API serves its bundled fixtures. Coverage stays with the Node config
 * (`vitest.config.ts`), which runs every other test and holds the floors.
 */
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
	test: {
		name: "functions-workerd",
		include: ["src/**/*.workerd.test.ts"],
		poolOptions: {
			workers: {
				// The real Worker (main, compatibility date and flags) as wrangler would run it.
				main: "./src/worker.ts",
				singleWorker: true,
				wrangler: {
					configPath: "../wrangler.jsonc",
				},
				miniflare: {
					bindings: {
						BT_LOCAL: "1",
					},
				},
			},
		},
	},
});
