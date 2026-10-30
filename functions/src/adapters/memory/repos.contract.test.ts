/**
 * Every in-memory repository against the shared storage contract (S46), seeded
 * from the committed fixtures (`2024-07-04`, game 744834) so real stored shapes
 * are exercised, not toy objects.
 */
import type {
	AccountSettings, GameProjection, GameSnapshot, ScheduleDay,
} from "@bt/domain";
import {
	downloadExpiresAt, entitlementsForTier, projectGame,
} from "@bt/domain";
import type { ReplayArtifact } from "@bt/ports";
import { FixtureMlbStatsClient } from "../fixtures/mlb.js";
import {
	DOWNLOADS_STORE, MAIL_STORE, personalDataStores, SETTINGS_STORE, USERS_STORE,
} from "../../services/personal-data.js";
import {
	describeIdentityLinkContract, describePersonalDataStoreContract, describeRepositoryContract,
} from "../repository-contract.js";
import {
	InMemoryExportStore,
	InMemoryGameProjectionRepository,
	InMemoryGameRepository,
	InMemoryMailer,
	InMemoryReplayArtifactRepository,
	InMemoryScheduleRepository,
	InMemorySettingsRepository,
	InMemoryUserRepository,
} from "./repos.js";

const fixtures = new FixtureMlbStatsClient();

/** The fixture game re-keyed and versioned; its detailed state names the version so content differs. */
async function game(gamePk: number, version: number, date = "2024-07-04"): Promise<GameSnapshot>
{
	const fetched = await fixtures.fetchGame(744834);
	return {
		...fetched,
		gamePk,
		officialDate: date,
		status: {
			...fetched.status,
			detailedState: `Final (v${version})`,
		},
		version,
		lastChangedAt: `2024-07-05T00:00:0${version}.000Z`,
	};
}

describeRepositoryContract<string, ScheduleDay>("InMemoryScheduleRepository", {
	create: () =>
	{
		const repo = new InMemoryScheduleRepository();
		return {
			upsert: (day) => repo.upsert(day),
			get: (date) => repo.getByDate(date),
		};
	},
	make: async (date, version) => ({
		...(await fixtures.fetchSchedule(date)),
		fetchedAt: `2024-07-05T00:00:0${version}.000Z`,
		games: (await fixtures.fetchSchedule(date)).games.slice(0, version),
		version,
		lastChangedAt: `2024-07-05T00:00:0${version}.000Z`,
	}),
	keyOf: (day) => day.date,
	keys: ["2024-07-04", "2024-07-05"],
	missingKey: "1999-01-01",
	mutate: (day) =>
	{
		day.games.length = 0;
		day.windowMode = "active";
	},
});

describeRepositoryContract<number, GameSnapshot>("InMemoryGameRepository", {
	create: () =>
	{
		const repo = new InMemoryGameRepository();
		return {
			upsert: (g) => repo.upsert(g),
			get: (pk) => repo.getByPk(pk),
			listByDate: (date) => repo.listByDate(date),
		};
	},
	make: (pk, version, date) => game(pk, version, date),
	keyOf: (g) => g.gamePk,
	keys: [744834, 745001],
	missingKey: 1,
	mutate: (g) =>
	{
		g.plays.length = 0;
		g.teams.home.abbreviation = "XXX";
	},
});

describeRepositoryContract<number, GameProjection>("InMemoryGameProjectionRepository", {
	create: () =>
	{
		const repo = new InMemoryGameProjectionRepository();
		return {
			upsert: (p) => repo.upsert(p),
			get: (pk) => repo.getByPk(pk),
		};
	},
	make: async (pk, version) => projectGame(await game(pk, version)),
	keyOf: (p) => p.header.gamePk,
	keys: [744834, 745001],
	missingKey: 1,
	mutate: (p) =>
	{
		p.plays.plays.length = 0;
		p.header.teams.home.abbreviation = "XXX";
	},
});

describeRepositoryContract<number, ReplayArtifact>("InMemoryReplayArtifactRepository", {
	create: () =>
	{
		const repo = new InMemoryReplayArtifactRepository();
		return {
			upsert: (a) => repo.upsert(a),
			get: (pk) => repo.getByPk(pk),
		};
	},
	// A replay's version is its retained patch count, so each version has that many patches.
	make: async (pk, version) =>
	{
		const patches = Array.from({
			length: version,
		}, (_, i) => ({
			startTimecode: `20240704_2300${i}0`,
			endTimecode: `20240704_2300${i + 1}0`,
			diff: [{
				op: "replace" as const,
				path: "/liveData/plays/currentPlay/count/balls",
				value: i,
			}],
		}));
		return {
			gamePk: pk,
			baseTimecode: "20240704_230000",
			timecodes: patches.map((p) => p.endTimecode),
			patches,
			version,
		};
	},
	keyOf: (a) => a.gamePk,
	keys: [744834, 745001],
	missingKey: 1,
	mutate: (a) =>
	{
		a.patches.length = 0;
		a.baseTimecode = "mutated";
	},
});

describeIdentityLinkContract("InMemoryUserRepository", () => new InMemoryUserRepository());

/** A settings document stored under `uid`, as the keyed contract sees it. */
type StoredSettings = { uid: string;
	settings: AccountSettings };

describeRepositoryContract<string, StoredSettings>("InMemorySettingsRepository", {
	create: () =>
	{
		const repo = new InMemorySettingsRepository();
		return {
			upsert: (v) => repo.upsert(v.uid, v.settings),
			get: async (uid) =>
			{
				const settings = await repo.get(uid);
				return settings && {
					uid,
					settings,
				};
			},
		};
	},
	// Favorites grow with the version, so each version's content differs.
	make: async (uid, version) => ({
		uid,
		settings: {
			favoriteTeamIds: [147, 111, 121].slice(0, version),
			opensFirst: version % 2 === 0 ? "live" : "box",
			gameRowSlot: "status",
			collapseNonFavorites: false,
			hideScores: false,
			version,
		},
	}),
	keyOf: (v) => v.uid,
	keys: ["uid-1", "uid-2"],
	missingKey: "nobody",
	mutate: (v) =>
	{
		v.settings.favoriteTeamIds.length = 0;
		v.settings.opensFirst = "videos";
	},
});

type RegistryDeps = {
	users: InMemoryUserRepository;
	settings: InMemorySettingsRepository;
	downloads: InMemoryExportStore;
	mailer: InMemoryMailer;
};

/** Every registered store runs the shared deletion case (i), through the registry itself. */
function registeredStore(name: string, write: (deps: RegistryDeps, uid: string) => Promise<void>)
{
	return () =>
	{
		const deps: RegistryDeps = {
			users: new InMemoryUserRepository(),
			settings: new InMemorySettingsRepository(),
			downloads: new InMemoryExportStore(),
			mailer: new InMemoryMailer(),
		};
		const store = personalDataStores(deps).find((s) => s.name === name)!;
		return {
			store,
			write: (uid: string) => write(deps, uid),
		};
	};
}

describePersonalDataStoreContract(SETTINGS_STORE, {
	create: registeredStore(SETTINGS_STORE, (deps, uid) => deps.settings.upsert(uid, {
		favoriteTeamIds: [147],
		opensFirst: "live",
		gameRowSlot: "status",
		collapseNonFavorites: false,
		hideScores: false,
		version: 1,
	})),
});

describePersonalDataStoreContract(USERS_STORE, {
	create: registeredStore(USERS_STORE, async (deps, uid) =>
	{
		await deps.users.upsert({
			uid,
			email: `${uid}@example.test`,
			displayName: uid,
			patreonUserId: null,
			role: "member",
			entitlements: entitlementsForTier("none"),
			createdAt: "2026-10-24T00:00:00.000Z",
			updatedAt: "2026-10-24T00:00:00.000Z",
		});
		await deps.users.linkIdentity("dev", uid, uid);
	}),
});

// Downloads and their request times (a download's `createdAt`) go with the account (S80).
describePersonalDataStoreContract(DOWNLOADS_STORE, {
	create: registeredStore(DOWNLOADS_STORE, (deps, uid) => deps.downloads.put({
		id: `download-${uid}`,
		uid,
		createdAt: "2026-10-27T12:00:00.000Z",
		expiresAt: downloadExpiresAt(new Date("2026-10-27T12:00:00.000Z")),
	}, {
		stores: {},
	})),
});

describePersonalDataStoreContract(MAIL_STORE, {
	create: registeredStore(MAIL_STORE, (deps, uid) => deps.mailer.send({
		uid,
		to: `${uid}@example.test`,
		subject: "Your Baseball Theater data download is ready",
		text: "Sign in and open Settings.",
	})),
});
