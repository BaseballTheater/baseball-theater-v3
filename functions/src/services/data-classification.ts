import type { UserProfile } from "@bt/domain";
import {
	DOWNLOADS_STORE, MAIL_STORE, SETTINGS_STORE, USERS_STORE,
} from "./personal-data.js";

/**
 * Whether something BT keeps is personal data (ADR-028). A `personal` label
 * names the registered `PersonalDataStore` that deletes it, so labeling data
 * personal without a way to delete it fails `findUnlabeled`.
 */
export type DataLabel = PersonalLabel | NotPersonalLabel | RetainedLabel;

type PersonalLabel = {
	kind: "personal";
	/** The registered store (`personal-data.ts`) whose `deleteFor` removes it. */
	deletedBy: string;
};

type NotPersonalLabel = {
	kind: "none";
	/** Why it holds nothing personal, so a reviewer can check the claim. */
	why: string;
};

/**
 * Kept after a deletion on purpose (ADR-028): only the deletion log, which must
 * outlive the user so a restored backup can be cleaned again. Allowed on the
 * entries in {@link RETAINED_ALLOWED} and nowhere else.
 */
type RetainedLabel = {
	kind: "retained";
	why: string;
};

/** The one thing ADR-028 keeps after a deletion: the log of deleted uids, in each store that holds it (S50: Postgres). */
export const RETAINED_ALLOWED: readonly string[] = ["InMemoryDeletionLog", "PostgresDeletionLog", "deletion_log"];

/**
 * The data classification manifest (ADR-028). Every repository class, every
 * `UserProfile` field and every adapter directory is labeled here; the test
 * beside this file discovers each of them from source and fails on any that is
 * missing. S50 adds the Postgres tables and columns in the same change that
 * creates them.
 */
export const DATA_CLASSIFICATION = {
	/** Classes in `functions/src/adapters/memory/repos.ts`. */
	repositoryClasses: {
		InMemoryScheduleRepository: {
			kind: "none",
			why: "MLB schedules; no user data",
		},
		InMemoryGameRepository: {
			kind: "none",
			why: "MLB game snapshots; no user data",
		},
		InMemoryGameProjectionRepository: {
			kind: "none",
			why: "projections of MLB games; no user data",
		},
		InMemoryReplayArtifactRepository: {
			kind: "none",
			why: "MLB live-feed replay patches; no user data",
		},
		InMemoryUserRepository: {
			kind: "personal",
			deletedBy: USERS_STORE,
		},
		InMemorySettingsRepository: {
			kind: "personal",
			deletedBy: SETTINGS_STORE,
		},
		InMemoryDeletionLog: {
			kind: "retained",
			why: "deleted uids and times only, re-applied after a backup restore (ADR-028)",
		},
		InMemoryExportStore: {
			kind: "personal",
			deletedBy: DOWNLOADS_STORE,
		},
		InMemoryMailer: {
			kind: "personal",
			deletedBy: MAIL_STORE,
		},
		// The Postgres adapter (S50) backs the same ports under the same registered stores.
		PostgresScheduleRepository: {
			kind: "none",
			why: "MLB schedules; no user data",
		},
		PostgresGameRepository: {
			kind: "none",
			why: "MLB game snapshots; no user data",
		},
		PostgresGameProjectionRepository: {
			kind: "none",
			why: "projections of MLB games; no user data",
		},
		PostgresReplayArtifactRepository: {
			kind: "none",
			why: "MLB live-feed replay patches; no user data",
		},
		PostgresUserRepository: {
			kind: "personal",
			deletedBy: USERS_STORE,
		},
		PostgresSettingsRepository: {
			kind: "personal",
			deletedBy: SETTINGS_STORE,
		},
		PostgresDeletionLog: {
			kind: "retained",
			why: "deleted uids and times only, re-applied after a backup restore (ADR-028)",
		},
	},
	/**
	 * Every table the Postgres migrations create (S50), read from the committed SQL by the
	 * manifest test, so a new table can't land unlabeled.
	 */
	postgresTables: {
		schedule_days: {
			kind: "none",
			why: "MLB schedules; no user data",
		},
		games: {
			kind: "none",
			why: "MLB game snapshots; no user data",
		},
		game_projections: {
			kind: "none",
			why: "projections of MLB games; no user data",
		},
		replay_artifacts: {
			kind: "none",
			why: "MLB live-feed replay patches; no user data",
		},
		users: {
			kind: "personal",
			deletedBy: USERS_STORE,
		},
		entitlements: {
			kind: "personal",
			deletedBy: USERS_STORE,
		},
		identity_links: {
			kind: "personal",
			deletedBy: USERS_STORE,
		},
		account_settings: {
			kind: "personal",
			deletedBy: SETTINGS_STORE,
		},
		deletion_log: {
			kind: "retained",
			why: "deleted uids and times only, re-applied after a backup restore (ADR-028)",
		},
	},
	/** Typed as every key of `UserProfile`, so adding a field without a label doesn't compile either. */
	userProfileFields: {
		uid: {
			kind: "personal",
			deletedBy: USERS_STORE,
		},
		email: {
			kind: "personal",
			deletedBy: USERS_STORE,
		},
		displayName: {
			kind: "personal",
			deletedBy: USERS_STORE,
		},
		patreonUserId: {
			kind: "personal",
			deletedBy: USERS_STORE,
		},
		role: {
			kind: "personal",
			deletedBy: USERS_STORE,
		},
		entitlements: {
			kind: "personal",
			deletedBy: USERS_STORE,
		},
		createdAt: {
			kind: "personal",
			deletedBy: USERS_STORE,
		},
		updatedAt: {
			kind: "personal",
			deletedBy: USERS_STORE,
		},
	} satisfies Record<keyof UserProfile, DataLabel>,
	/**
	 * Directories under `functions/src/adapters/`: each is an outside service or
	 * a storage backend, and either sends or keeps personal data or doesn't.
	 */
	adapterDirectories: {
		cloudflare: {
			kind: "none",
			why: "the Workers runtime's WebSocket pieces for the live hub (S18); sockets carry public game state, no user identity, and nothing is kept",
		},
		fixtures: {
			kind: "none",
			why: "committed MLB fixtures and the dev sign-in provider; stores nothing of its own",
		},
		http: {
			kind: "none",
			why: "the public MLB Stats API; requests carry no user data",
		},
		memory: {
			kind: "personal",
			deletedBy: USERS_STORE,
		},
		node: {
			kind: "none",
			why: "serves HTTP from Node; keeps nothing",
		},
		postgres: {
			kind: "personal",
			deletedBy: USERS_STORE,
		},
	},
} satisfies Record<string, Record<string, DataLabel>>;

export type DataSection = keyof typeof DATA_CLASSIFICATION;

/**
 * Problems with a manifest section against what actually exists: names found
 * in source that have no label, `personal` labels whose `deletedBy` isn't a
 * registered store, and `retained` on anything but the deletion log. Empty means the section is complete.
 */
export function findUnlabeled(labels: Record<string, DataLabel>, found: string[], storeNames: string[]): string[]
{
	const problems = found.filter((name) => !(name in labels)).map((name) => `${name} is unlabeled`);
	for (const [name, label] of Object.entries(labels))
	{
		if (label.kind === "personal" && !storeNames.includes(label.deletedBy))
		{
			problems.push(`${name} is deleted by "${label.deletedBy}", which is not a registered store`);
		}
		if (label.kind === "retained" && !RETAINED_ALLOWED.includes(name))
		{
			problems.push(`${name} is labeled retained, which only the deletion log may be`);
		}
	}
	return problems;
}
