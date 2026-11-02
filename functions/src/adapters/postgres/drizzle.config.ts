/**
 * `drizzle-kit` reads the schema here and writes SQL migrations beside it (S50). Kept inside
 * the adapter so Drizzle never appears outside it (AC 4). Run from `functions/`:
 * `pnpm exec drizzle-kit generate --config src/adapters/postgres/drizzle.config.ts`.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/adapters/postgres/schema.ts",
	out: "./src/adapters/postgres/migrations",
});
