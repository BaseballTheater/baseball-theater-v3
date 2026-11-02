/**
 * BT's Postgres schema (ADR-018; S50, Drizzle per the owner, 2026-10-18). Typed tables for
 * what BT owns about people (users, identity links, entitlements, account settings, the
 * deletion log) and for the keys and versions of what it stores about games; each MLB-derived
 * document (a schedule day, a game snapshot, a projection, a replay artifact) is one JSONB
 * column beside its key and `version`, which every write compares (ADR-022). A GIN index on
 * the game document serves queries into it (S5's highlight search, when it lands).
 *
 * Times stay ISO strings in `text` columns: the ports hand them over as strings and the
 * storage contract (S46) reads back exactly what was written. Migrations are generated from
 * this file by `drizzle-kit` (`drizzle.config.ts`) and committed under `migrations/`.
 */
import type {
	AccountSettings, GameProjection, GameSnapshot, ScheduleDay,
} from "@bt/domain";
import type { ReplayArtifact } from "@bt/ports";
import {
	boolean, index, integer, jsonb, pgTable, primaryKey, serial, text,
} from "drizzle-orm/pg-core";

/** One schedule day per date (`ScheduleRepository`). */
export const scheduleDays = pgTable("schedule_days", {
	date: text("date").primaryKey(),
	version: integer("version").notNull(),
	document: jsonb("document").$type<ScheduleDay>().notNull(),
});

/** One game snapshot per game (`GameRepository`): its day for `listByDate`, the document for queries into it. */
export const games = pgTable("games", {
	gamePk: integer("game_pk").primaryKey(),
	officialDate: text("official_date").notNull(),
	version: integer("version").notNull(),
	document: jsonb("document").$type<GameSnapshot>().notNull(),
}, (t) => [
	index("games_official_date").on(t.officialDate),
	index("games_document_gin").using("gin", t.document),
]);

/** The five projected documents per game (`GameProjectionRepository`), versioned by `header.version`. */
export const gameProjections = pgTable("game_projections", {
	gamePk: integer("game_pk").primaryKey(),
	version: integer("version").notNull(),
	document: jsonb("document").$type<GameProjection>().notNull(),
});

/** One post-game replay artifact per game (`ReplayArtifactRepository`, S22). */
export const replayArtifacts = pgTable("replay_artifacts", {
	gamePk: integer("game_pk").primaryKey(),
	version: integer("version").notNull(),
	document: jsonb("document").$type<ReplayArtifact>().notNull(),
});

/** BT's own users (ADR-019): the profile, keyed by BT's uid. Personal: `BT database: users`. */
export const users = pgTable("users", {
	uid: text("uid").primaryKey(),
	email: text("email").notNull(),
	displayName: text("display_name"),
	patreonUserId: text("patreon_user_id"),
	role: text("role").notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

/** What each user may use, beside the profile; goes with the user. Personal: `BT database: users`. */
export const entitlements = pgTable("entitlements", {
	uid: text("uid").primaryKey().references(() => users.uid, {
		onDelete: "cascade",
	}),
	tier: text("tier").notNull(),
	fasterLiveRefresh: boolean("faster_live_refresh").notNull(),
	cloudSyncedSettings: boolean("cloud_synced_settings").notNull(),
	savantLinks: boolean("savant_links").notNull(),
});

/** A provider account (provider, subject) linked to one BT uid (ADR-019). Personal: `BT database: users`. */
export const identityLinks = pgTable("identity_links", {
	provider: text("provider").notNull(),
	subject: text("subject").notNull(),
	uid: text("uid").notNull(),
}, (t) => [
	primaryKey({
		columns: [t.provider, t.subject],
	}),
	index("identity_links_uid").on(t.uid),
]);

/** Each account's settings document (ADR-027, S6), typed column by column. Personal: `BT database: settings`. */
export const accountSettings = pgTable("account_settings", {
	uid: text("uid").primaryKey(),
	favoriteTeamIds: integer("favorite_team_ids").array().notNull(),
	opensFirst: text("opens_first").$type<AccountSettings["opensFirst"]>().notNull(),
	gameRowSlot: text("game_row_slot").$type<AccountSettings["gameRowSlot"]>().notNull(),
	collapseNonFavorites: boolean("collapse_non_favorites").notNull(),
	hideScores: boolean("hide_scores").notNull(),
	videoPlayer: text("video_player").$type<AccountSettings["videoPlayer"]>().notNull(),
	version: integer("version").notNull(),
});

/** Deleted uids and when (ADR-028): the one record kept after a deletion, re-applied after a restore. */
export const deletionLog = pgTable("deletion_log", {
	id: serial("id").primaryKey(),
	uid: text("uid").notNull(),
	deletedAt: text("deleted_at").notNull(),
});
