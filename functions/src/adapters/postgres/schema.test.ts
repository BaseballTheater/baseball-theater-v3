/**
 * S50: the schema's indexes and keys, read back through Drizzle (`getTableConfig`), the same
 * description `drizzle-kit` turns into the committed migration.
 */
import { getTableConfig } from "drizzle-orm/pg-core";
import {
	describe, expect, it,
} from "vitest";
import {
	entitlements, games, identityLinks,
} from "./schema.js";

describe("Postgres schema (S50)", () =>
{
	it("games: a GIN index on the document and a btree on the day (listByDate)", () =>
	{
		const indexes = getTableConfig(games).indexes.map((i) => [i.config.name, i.config.method]);
		expect(indexes).toEqual([["games_official_date", "btree"], ["games_document_gin", "gin"]]);
	});

	it("identity links: keyed by (provider, subject), looked up by uid", () =>
	{
		const config = getTableConfig(identityLinks);
		expect(config.primaryKeys[0]!.columns.map((c) => c.name)).toEqual(["provider", "subject"]);
		expect(config.indexes.map((i) => i.config.name)).toEqual(["identity_links_uid"]);
	});

	it("entitlements belong to a user and go when the user does", () =>
	{
		const [key] = getTableConfig(entitlements).foreignKeys;
		const reference = key!.reference();
		expect(reference.foreignColumns.map((c) => c.name)).toEqual(["uid"]);
		expect(getTableConfig(reference.foreignTable).name).toBe("users");
		expect(key!.onDelete).toBe("cascade");
	});
});
