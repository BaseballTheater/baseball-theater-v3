/**
 * The one storage contract every repository adapter is held to (ADR-018, S46;
 * the cases S9 wrote for Firestore, carried over). The in-memory test doubles
 * run it today; the Postgres adapter (S50) joins by calling the same function,
 * so the two can't drift.
 *
 * A subject describes how to build a value for a key at a version. Values must
 * differ in content between versions, so "replaced" and "kept" are observable.
 * Case (d) runs only for ports that list by date (`listByDate`); the others
 * have no such read. Case (g) is the user repository's identity link (S8,
 * ADR-019), in its own suite because users carry no version for (c)/(f);
 * case (h) is its deletion (ADR-028): `deleteFor` reaches profile and links.
 * Case (i) is the same deletion for any registered `PersonalDataStore` (S6),
 * so each new store (settings now, S50's Postgres stores) runs one shared case.
 * Case (j) is the schedule repository's month read (S124, `listGameCounts`).
 */
import {
	beforeEach, describe, expect, it,
} from "vitest";
import type { ScheduleDay, UserProfile } from "@bt/domain";
import { entitlementsForTier } from "@bt/domain";
import type {
	PersonalDataStore, ScheduleRepository, UserRepository,
} from "@bt/ports";

/** The reads and writes every keyed repository shares. */
export interface ContractRepository<K, T>
{
	upsert(value: T): Promise<void>;
	get(key: K): Promise<T | null>;
	listByDate?(date: string): Promise<T[]>;
}

export interface ContractSubject<K, T>
{
	/** A fresh repository over empty storage. */
	create(): ContractRepository<K, T>;
	/** A value for `key` at `version`, whose content depends on the version. Dated on `date` when given. */
	make(key: K, version: number, date?: string): Promise<T>;
	keyOf(value: T): K;
	/** Two keys that `make` accepts, and one that is never written. */
	keys: [K, K];
	missingKey: K;
	/** Mutate a value in place (to prove reads hand back copies). */
	mutate(value: T): void;
}

/** What Postgres `jsonb` hands back for a written value. */
function asJson<T>(value: T): T
{
	return JSON.parse(JSON.stringify(value)) as T;
}

export function describeRepositoryContract<K, T>(label: string, subject: ContractSubject<K, T>): void
{
	describe(`${label} — repository contract`, () =>
	{
		let repo: ContractRepository<K, T>;
		const [k1, k2] = subject.keys;

		beforeEach(() =>
		{
			repo = subject.create();
		});

		it("(a) a read deep-equals the JSON of what was stored and is not the same object", async () =>
		{
			const written = await subject.make(k1, 1);
			await repo.upsert(written);
			const read = await repo.get(k1);
			expect(read).toEqual(asJson(written));
			expect(read).not.toBe(written);
		});

		it("(b) reads null for a missing key", async () =>
		{
			expect(await repo.get(subject.missingKey)).toBeNull();
		});

		it("(c) an upsert with a newer version replaces the stored value", async () =>
		{
			await repo.upsert(await subject.make(k1, 1));
			const newer = await subject.make(k1, 2);
			await repo.upsert(newer);
			expect(await repo.get(k1)).toEqual(asJson(newer));
		});

		if (subject.create().listByDate)
		{
			it("(d) listByDate returns exactly that date's entries, and [] for a date with none", async () =>
			{
				await repo.upsert(await subject.make(k1, 1, "2024-07-04"));
				await repo.upsert(await subject.make(k2, 1, "2024-07-05"));
				const listed = await repo.listByDate!("2024-07-04");
				expect(listed.map((v) => subject.keyOf(v))).toEqual([k1]);
				expect(await repo.listByDate!("1999-01-01")).toEqual([]);
			});
		}

		it("(e) mutating a written or a returned value does not change the store", async () =>
		{
			const written = await subject.make(k1, 1);
			const expected = asJson(written);
			await repo.upsert(written);
			subject.mutate(written);
			const read = await repo.get(k1);
			subject.mutate(read!);
			expect(await repo.get(k1)).toEqual(expected);
		});

		it("(f) an upsert whose version is not newer than the stored one is a no-op", async () =>
		{
			const held = await subject.make(k1, 2);
			await repo.upsert(held);
			await repo.upsert(await subject.make(k1, 1));
			const sameVersion = await subject.make(k1, 2);
			subject.mutate(sameVersion);
			await repo.upsert(sameVersion);
			expect(await repo.get(k1)).toEqual(asJson(held));
		});
	});
}

/** The identity-link part of the contract, for any `UserRepository` adapter. */
export function describeIdentityLinkContract(label: string, create: () => UserRepository): void
{
	describe(`${label} — repository contract`, () =>
	{
		it("(g) linkIdentity maps (provider, subject) to one uid, read back by getByIdentity", async () =>
		{
			const repo = create();
			expect(await repo.getByIdentity("logto", "sub-1")).toBeNull();

			await repo.linkIdentity("logto", "sub-1", "uid-1");
			await repo.linkIdentity("google", "sub-2", "uid-1");
			expect(await repo.getByIdentity("logto", "sub-1")).toBe("uid-1");
			expect(await repo.getByIdentity("google", "sub-2")).toBe("uid-1");
			// The provider is part of the key: the same subject elsewhere is a different account.
			expect(await repo.getByIdentity("google", "sub-1")).toBeNull();

			// Relinking to the same user is a no-op; to another user, it is refused and the link stands.
			await repo.linkIdentity("logto", "sub-1", "uid-1");
			await expect(repo.linkIdentity("logto", "sub-1", "uid-2")).rejects.toThrow();
			expect(await repo.getByIdentity("logto", "sub-1")).toBe("uid-1");
		});

		it("(h) deleteFor removes one user's profile and identity links and leaves another user's untouched", async () =>
		{
			const repo = create();
			for (const uid of ["uid-1", "uid-2"])
			{
				await repo.upsert(contractUser(uid));
				await repo.linkIdentity("logto", `logto-${uid}`, uid);
				await repo.linkIdentity("google", `google-${uid}`, uid);
			}
			const kept = await repo.exportFor("uid-2");

			await repo.deleteFor("uid-1");
			expect(await repo.getByUid("uid-1")).toBeNull();
			expect(await repo.getByIdentity("logto", "logto-uid-1")).toBeNull();
			expect(await repo.getByIdentity("google", "google-uid-1")).toBeNull();
			expect(await repo.exportFor("uid-1")).toBeNull();
			expect(await repo.exportFor("uid-2")).toEqual(kept);
			expect(kept?.identities).toHaveLength(2);

			// Idempotent (ADR-028): a deletion that failed partway can run again.
			await repo.deleteFor("uid-1");
			expect(await repo.exportFor("uid-2")).toEqual(kept);
		});
	});
}

/** A complete user record for the contract cases; content depends on `uid` so two users differ. */
function contractUser(uid: string): UserProfile
{
	return {
		uid,
		email: `${uid}@example.test`,
		displayName: uid,
		patreonUserId: null,
		role: "member",
		entitlements: entitlementsForTier("none"),
		createdAt: "2026-10-24T00:00:00.000Z",
		updatedAt: "2026-10-24T00:00:00.000Z",
	};
}

/** A registered personal data store over fresh storage, and how to write something of a user's into it. */
export interface PersonalDataSubject
{
	create(): { store: PersonalDataStore;
		write(uid: string): Promise<void> };
}

/** The deletion part of the contract for any `PersonalDataStore` (ADR-028; case (h)'s form, store-generic). */
export function describePersonalDataStoreContract(label: string, subject: PersonalDataSubject): void
{
	describe(`${label} — repository contract`, () =>
	{
		it("(i) deleteFor removes one user's data, leaves another's untouched, and is a no-op when run again", async () =>
		{
			const { store, write } = subject.create();
			await write("uid-1");
			await write("uid-2");
			const kept = await store.exportFor("uid-2");
			expect(kept).not.toBeNull();
			expect(await store.exportFor("uid-1")).not.toBeNull();

			await store.deleteFor("uid-1");
			expect(await store.exportFor("uid-1")).toBeNull();
			expect(await store.exportFor("uid-2")).toEqual(kept);

			await store.deleteFor("uid-1");
			expect(await store.exportFor("uid-1")).toBeNull();
			expect(await store.exportFor("uid-2")).toEqual(kept);
		});
	});
}

/**
 * Case (j), the schedule repository's month read (S124): `listGameCounts` returns each stored day
 * in the range, both ends included, in date order, as its game count and its stamps exactly as
 * stored, and leaves out days outside the range or never stored. `makeDay` builds a stored day
 * with `gameCount` games.
 */
export function describeScheduleCountsContract(
	label: string,
	create: () => ScheduleRepository,
	makeDay: (date: string, gameCount: number, stamp: string) => Promise<ScheduleDay>,
): void
{
	describe(`${label} — repository contract`, () =>
	{
		it("(j) listGameCounts gives each stored day in the range, in order, with its game count and stamps", async () =>
		{
			const repo = create();
			const days = [
				await makeDay("2024-07-06", 0, "2024-07-07T00:00:03.000Z"),
				await makeDay("2024-07-03", 1, "2024-07-07T00:00:01.000Z"),
				await makeDay("2024-07-04", 2, "2024-07-07T00:00:02.000Z"),
				await makeDay("2024-07-08", 1, "2024-07-07T00:00:04.000Z"),
			];
			for (const day of days) await repo.upsert(day);
			expect(await repo.listGameCounts("2024-07-04", "2024-07-06")).toEqual([
				{
					date: "2024-07-04",
					gameCount: 2,
					fetchedAt: days[2]!.fetchedAt,
					lastChangedAt: days[2]!.lastChangedAt,
				},
				{
					date: "2024-07-06",
					gameCount: 0,
					fetchedAt: days[0]!.fetchedAt,
					lastChangedAt: days[0]!.lastChangedAt,
				},
			]);
			expect(await repo.listGameCounts("1999-01-01", "1999-01-31")).toEqual([]);
		});
	});
}
