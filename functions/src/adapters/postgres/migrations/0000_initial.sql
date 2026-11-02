CREATE TABLE "account_settings" (
	"uid" text PRIMARY KEY NOT NULL,
	"favorite_team_ids" integer[] NOT NULL,
	"opens_first" text NOT NULL,
	"game_row_slot" text NOT NULL,
	"collapse_non_favorites" boolean NOT NULL,
	"hide_scores" boolean NOT NULL,
	"video_player" text NOT NULL,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"deleted_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"uid" text PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"faster_live_refresh" boolean NOT NULL,
	"cloud_synced_settings" boolean NOT NULL,
	"savant_links" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_projections" (
	"game_pk" integer PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"game_pk" integer PRIMARY KEY NOT NULL,
	"official_date" text NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_links" (
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"uid" text NOT NULL,
	CONSTRAINT "identity_links_provider_subject_pk" PRIMARY KEY("provider","subject")
);
--> statement-breakpoint
CREATE TABLE "replay_artifacts" (
	"game_pk" integer PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_days" (
	"date" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"uid" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"patreon_user_id" text,
	"role" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_uid_users_uid_fk" FOREIGN KEY ("uid") REFERENCES "public"."users"("uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "games_official_date" ON "games" USING btree ("official_date");--> statement-breakpoint
CREATE INDEX "games_document_gin" ON "games" USING gin ("document");--> statement-breakpoint
CREATE INDEX "identity_links_uid" ON "identity_links" USING btree ("uid");