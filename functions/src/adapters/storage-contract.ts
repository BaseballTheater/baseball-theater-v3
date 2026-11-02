/**
 * The storage contract (S46) over real stored shapes, for any adapter: every repository port
 * an adapter implements runs the same cases, seeded from the committed fixtures (`2024-07-04`,
 * game 744834) rather than toy objects, plus the registry's deletion case (i) for the
 * personal stores it backs. The in-memory doubles and the Postgres adapter (S50) both call
 * `describeStorageContract`, so their case counts match by construction.
 */
import type {
	AccountSettings, GameProjection, GameSnapshot, ScheduleDay,
} from "@bt/domain";
import { entitlementsForTier, projectGame } from "@bt/domain";
import type {
	GameProjectionRepository, GameRepository, ReplayArtifact, ReplayArtifactRepository, ScheduleRepository, SettingsRepository, UserRepository,
} from "@bt/ports";
import { FixtureMlbStatsClient } from "./fixtures/mlb.js";
import { InMemoryExportStore, InMemoryMailer } from "./memory/repos.js";
import {
	personalDataStores, SETTINGS_STORE, USERS_STORE,
} from "../services/personal-data.js";
import {
	describeIdentityLinkContract, describePersonalDataStoreContract, describeRepositoryContract,
} from "./repository-contract.js";

/** A fresh, empty instance of each repository an adapter implements. */
export interface StoreFactories
{
	schedules: () => ScheduleRepository;
	games: () => GameRepository;
	projections: () => GameProjectionRepository;
	replays: () => ReplayArtifactRepository;
	users: () => UserRepository;
	settings: () => SettingsRepository;
}

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

/** A settings document stored under `uid`, as the keyed contract sees it. */
type StoredSettings = { uid: string;
	settings: AccountSettings };

/**
 * Every keyed repository contract, the identity-link contract, and the registry's deletion
 * case for `BT database: users` and `BT database: settings`, under `<prefix><Repository>`
 * labels. The registry's other stores (data downloads in R2, the mailer) aren't database
 * tables, so they stay in-memory here and their own cases live with the in-memory doubles.
 */
export function describeStorageContract(prefix: string, stores: StoreFactories): void
{
	describeRepositoryContract<string, ScheduleDay>(`${prefix}ScheduleRepository`, {
		create: () =>
		{
			const repo = stores.schedules();
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

	describeRepositoryContract<number, GameSnapshot>(`${prefix}GameRepository`, {
		create: () =>
		{
			const repo = stores.games();
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

	describeRepositoryContract<number, GameProjection>(`${prefix}GameProjectionRepository`, {
		create: () =>
		{
			const repo = stores.projections();
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

	describeRepositoryContract<number, ReplayArtifact>(`${prefix}ReplayArtifactRepository`, {
		create: () =>
		{
			const repo = stores.replays();
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

	describeIdentityLinkContract(`${prefix}UserRepository`, () => stores.users());

	describeRepositoryContract<string, StoredSettings>(`${prefix}SettingsRepository`, {
		create: () =>
		{
			const repo = stores.settings();
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
				videoPlayer: "dialog",
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

	/** A registered store's deletion case (i), through the registry itself, over this adapter's users and settings. */
	function registered(name: string, write: (deps: { users: UserRepository;
		settings: SettingsRepository; }, uid: string) => Promise<void>)
	{
		return () =>
		{
			const deps = {
				users: stores.users(),
				settings: stores.settings(),
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
		create: registered(SETTINGS_STORE, (deps, uid) => deps.settings.upsert(uid, {
			favoriteTeamIds: [147],
			opensFirst: "live",
			gameRowSlot: "status",
			collapseNonFavorites: false,
			hideScores: false,
			videoPlayer: "dialog",
			version: 1,
		})),
	});

	describePersonalDataStoreContract(USERS_STORE, {
		create: registered(USERS_STORE, async (deps, uid) =>
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
}
