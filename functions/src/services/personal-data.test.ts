import type { UserProfile } from "@bt/domain";
import { entitlementsForTier } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import {
	InMemoryExportStore, InMemoryMailer, InMemorySettingsRepository, InMemoryUserRepository,
} from "../adapters/memory/repos.js";
import {
	DOWNLOADS_STORE, MAIL_STORE, personalDataStores, SETTINGS_STORE, USERS_STORE,
} from "./personal-data.js";

/** The registry's other dependencies, empty. */
const rest = () => ({
	downloads: new InMemoryExportStore(),
	mailer: new InMemoryMailer(),
});

const user: UserProfile = {
	uid: "uid-1",
	email: "fan@example.test",
	displayName: "Fan",
	patreonUserId: null,
	role: "member",
	entitlements: entitlementsForTier("none"),
	createdAt: "2026-10-24T00:00:00.000Z",
	updatedAt: "2026-10-24T00:00:00.000Z",
};

describe("personal data registry", () =>
{
	it("registers the in-memory user repository (profile and identity links) as one store", async () =>
	{
		const users = new InMemoryUserRepository();
		await users.upsert(user);
		await users.linkIdentity("dev", "uid-1", "uid-1");

		const stores = personalDataStores({
			users,
			settings: new InMemorySettingsRepository(),
			...rest(),
		});
		expect(stores.map((s) => s.name)).toEqual([USERS_STORE, SETTINGS_STORE, DOWNLOADS_STORE, MAIL_STORE]);

		const store = stores.find((s) => s.name === USERS_STORE);
		expect(await store!.exportFor("uid-1")).toEqual({
			profile: user,
			identities: [{
				provider: "dev",
				subject: "uid-1",
			}],
		});
		await store!.deleteFor("uid-1");
		expect(await users.getByUid("uid-1")).toBeNull();
		expect(await users.getByIdentity("dev", "uid-1")).toBeNull();
		expect(await store!.exportFor("uid-1")).toBeNull();
	});

	it("registers the in-memory settings repository as BT database: settings", async () =>
	{
		const settings = new InMemorySettingsRepository();
		const doc = {
			favoriteTeamIds: [147],
			opensFirst: "live" as const,
			gameRowSlot: "status" as const,
			version: 1,
		};
		await settings.upsert("uid-1", doc);
		const store = personalDataStores({
			users: new InMemoryUserRepository(),
			settings,
			...rest(),
		}).find((s) => s.name === SETTINGS_STORE)!;
		expect(await store.exportFor("uid-1")).toEqual(doc);
		await store.deleteFor("uid-1");
		expect(await settings.get("uid-1")).toBeNull();
	});
	it("registers the download store with its records only, never the files (a download must not contain the one before it)", async () =>
	{
		const deps = rest();
		const record = {
			id: "download-1",
			uid: "uid-1",
			createdAt: "2026-10-27T12:00:00.000Z",
			expiresAt: "2026-11-10T12:00:00.000Z",
		};
		await deps.downloads.put(record, {
			stores: {
				secret: "file contents",
			},
		});
		const store = personalDataStores({
			users: new InMemoryUserRepository(),
			settings: new InMemorySettingsRepository(),
			...deps,
		}).find((s) => s.name === DOWNLOADS_STORE)!;
		expect(await store.exportFor("uid-1")).toEqual([record]);
		await store.deleteFor("uid-1");
		expect(await deps.downloads.list("uid-1", new Date("2026-10-27T13:00:00.000Z"))).toEqual([]);
	});
});
