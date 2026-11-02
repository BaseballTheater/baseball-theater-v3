/**
 * Holds the classification manifest to what exists (ADR-028): each section is
 * compared with names discovered from source, so a new repository class,
 * `UserProfile` field or adapter directory fails here until it is labeled.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	describe, expect, it,
} from "vitest";
import {
	InMemoryExportStore, InMemoryMailer, InMemorySettingsRepository, InMemoryUserRepository,
} from "../adapters/memory/repos.js";
import type { DataSection } from "./data-classification.js";
import { DATA_CLASSIFICATION, findUnlabeled } from "./data-classification.js";
import { personalDataStores } from "./personal-data.js";

const src = join(import.meta.dirname, "..");
const storeNames = personalDataStores({
	users: new InMemoryUserRepository(),
	settings: new InMemorySettingsRepository(),
	downloads: new InMemoryExportStore(),
	mailer: new InMemoryMailer(),
}).map((s) => s.name);

/** Everything the manifest must label, read from source rather than listed by hand. */
const discovered: Record<DataSection, () => string[]> = {
	repositoryClasses: () => ["memory", "postgres"].flatMap((adapter) => [...readFileSync(join(src, `adapters/${adapter}/repos.ts`), "utf8").matchAll(/^export class (\w+)/gm)].map((m) => m[1]!)),
	postgresTables: () =>
	{
		const migrations = join(src, "adapters/postgres/migrations");
		return readdirSync(migrations).filter((f) => f.endsWith(".sql"))
			.flatMap((f) => [...readFileSync(join(migrations, f), "utf8").matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?"(\w+)"/gm)].map((m) => m[1]!));
	},
	userProfileFields: () =>
	{
		const types = readFileSync(join(src, "../../packages/domain/src/types.ts"), "utf8");
		const body = /^export type UserProfile = \{\n([\s\S]*?)^\};/m.exec(types)?.[1] ?? "";
		return [...body.matchAll(/^\t(\w+):/gm)].map((m) => m[1]!);
	},
	adapterDirectories: () => readdirSync(join(src, "adapters"), {
		withFileTypes: true,
	}).filter((d) => d.isDirectory()).map((d) => d.name),
};

describe("data classification manifest", () =>
{
	for (const section of Object.keys(discovered) as DataSection[])
	{
		it(`labels every one of ${section}, each personal label naming a registered store`, () =>
		{
			const found = discovered[section]();
			expect(found.length).toBeGreaterThan(0);
			expect(findUnlabeled(DATA_CLASSIFICATION[section], found, storeNames)).toEqual([]);
		});
	}

	it("catches an unlabeled entry and a personal label with no registered store", () =>
	{
		expect(findUnlabeled({}, ["InMemorySettingsRepository"], storeNames)).toEqual(["InMemorySettingsRepository is unlabeled"]);
		expect(findUnlabeled({
			push: {
				kind: "personal",
				deletedBy: "Push subscriptions",
			},
		}, ["push"], storeNames))
			.toEqual(["push is deleted by \"Push subscriptions\", which is not a registered store"]);
	});

	it("allows retained on the deletion log only", () =>
	{
		const retained = {
			kind: "retained",
			why: "kept after deletion",
		} as const;
		expect(findUnlabeled({
			InMemoryDeletionLog: retained,
		}, ["InMemoryDeletionLog"], storeNames)).toEqual([]);
		expect(findUnlabeled({
			InMemorySettingsRepository: retained,
		}, ["InMemorySettingsRepository"], storeNames)).toEqual(["InMemorySettingsRepository is labeled retained, which only the deletion log may be"]);
	});
});
