/**
 * The deletion service itself (S77, ADR-028): a store that fails partway leaves
 * the deletion retryable with the same session, and the deletion log
 * re-applies to data a restored backup brings back.
 */
import type { BtSession, UserProfile } from "@bt/domain";
import { ACCOUNT_DELETION_PHRASE, entitlementsForTier } from "@bt/domain";
import type { PersonalDataStore } from "@bt/ports";
import {
	describe, expect, it,
} from "vitest";
import { createDevAccountData } from "../adapters/fixtures/auth.js";
import { InMemorySettingsRepository, InMemoryUserRepository } from "../adapters/memory/repos.js";
import { deleteAccount, reapplyDeletions } from "./account-deletion.js";

function user(uid: string): UserProfile
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

/** A session issued just now from a sign-in just now, so the recent-sign-in check passes unless `authTime` says otherwise (null: none). */
function sessionOf(uid: string, authTime: number | null = Math.floor(Date.now() / 1000)): BtSession
{
	const issuedAt = Math.floor(Date.now() / 1000);
	return {
		uid,
		role: "member",
		entitlements: entitlementsForTier("none"),
		issuedAt,
		expiresAt: issuedAt + 3600,
		...authTime !== null && {
			authTime,
		},
	};
}

async function seeded()
{
	const users = new InMemoryUserRepository();
	for (const uid of ["fan-1", "fan-2"])
	{
		await users.upsert(user(uid));
		await users.linkIdentity("dev", uid, uid);
	}
	return {
		users,
		deps: createDevAccountData({
			users,
			settings: new InMemorySettingsRepository(),
		}),
	};
}

describe("deleteAccount", () =>
{
	it("S120 AC 1: the recent sign-in is the provider's authTime, not when BT issued the session", async () =>
	{
		const { users, deps } = await seeded();
		const now = Math.floor(Date.now() / 1000);
		const request = {
			phrase: ACCOUNT_DELETION_PHRASE,
		};
		// Issued just now, but from a sign-in 11 minutes ago (a re-traded ID token): refused.
		expect(await deleteAccount(deps, sessionOf("fan-1", now - 11 * 60), request)).toEqual({
			status: 403,
			error: "reauth_required",
		});
		// No authTime at all (a session from before S120): refused.
		expect(await deleteAccount(deps, sessionOf("fan-1", null), request)).toEqual({
			status: 403,
			error: "reauth_required",
		});
		expect(await users.getByUid("fan-1")).not.toBeNull();
		// A sign-in 9 minutes ago is recent.
		expect(await deleteAccount(deps, sessionOf("fan-1", now - 9 * 60), request)).toBeNull();
		expect(await users.getByUid("fan-1")).toBeNull();
	});

	it("a retry finishes a deletion that failed when a store threw once, with the same session", async () =>
	{
		const { users, deps } = await seeded();
		let failures = 1;
		const flaky: PersonalDataStore = {
			name: "Flaky store",
			exportFor: async () => null,
			deleteFor: async () =>
			{
				if (failures-- > 0) throw new Error("store unavailable");
			},
		};
		deps.stores = [...deps.stores, flaky];
		const session = sessionOf("fan-1");
		const request = {
			phrase: ACCOUNT_DELETION_PHRASE,
		};

		await expect(deleteAccount(deps, session, request)).rejects.toThrow("store unavailable");
		// Nothing that authorizes the retry is gone: the account and its links remain, nothing is logged.
		expect(await users.getByUid("fan-1")).not.toBeNull();
		expect(await deps.deletionLog.list()).toEqual([]);

		expect(await deleteAccount(deps, session, request)).toBeNull();
		expect(await users.exportFor("fan-1")).toBeNull();
		expect(await users.getByUid("fan-2")).not.toBeNull();
		expect((await deps.deletionLog.list()).map((e) => e.uid)).toEqual(["fan-1"]);
	});
});

describe("reapplyDeletions", () =>
{
	it("reapplyDeletions deletes a uid a restored backup brought back, and the log keeps only uid and time", async () =>
	{
		const { users, deps } = await seeded();
		expect(await deleteAccount(deps, sessionOf("fan-1"), {
			phrase: ACCOUNT_DELETION_PHRASE,
		})).toBeNull();

		const log = await deps.deletionLog.list();
		expect(log).toHaveLength(1);
		expect(Object.keys(log[0]!).sort()).toEqual(["deletedAt", "uid"]);

		// A backup from before the deletion is restored.
		await users.upsert(user("fan-1"));
		await users.linkIdentity("dev", "fan-1", "fan-1");
		expect(await reapplyDeletions(deps)).toBe(1);
		expect(await users.exportFor("fan-1")).toBeNull();
		expect(await users.getByUid("fan-2")).not.toBeNull();
	});
});
