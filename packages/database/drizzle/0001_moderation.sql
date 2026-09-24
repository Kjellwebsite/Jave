CREATE TYPE "public"."mod_case_end_reason" AS ENUM('expired', 'lifted', 'superseded', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."security_event_source" AS ENUM('automod', 'join_screening', 'manual', 'integration', 'system');--> statement-breakpoint
ALTER TYPE "public"."mod_source" ADD VALUE 'system';--> statement-breakpoint
ALTER TABLE "mod_cases" ADD COLUMN "delete_message_days" smallint;--> statement-breakpoint
ALTER TABLE "mod_cases" ADD COLUMN "reverts_case_id" uuid;--> statement-breakpoint
ALTER TABLE "mod_cases" ADD COLUMN "discord_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mod_cases" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mod_cases" ADD COLUMN "ended_reason" "mod_case_end_reason";--> statement-breakpoint
ALTER TABLE "security_events" ADD COLUMN "number" integer NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "security_events_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "security_events" ADD COLUMN "source" "security_event_source" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "security_events" ADD COLUMN "reported_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "security_events" ADD COLUMN "dedupe_key" varchar(128);--> statement-breakpoint
ALTER TABLE "security_events" ADD COLUMN "alert_channel_id" varchar(20);--> statement-breakpoint
ALTER TABLE "security_events" ADD COLUMN "alert_message_id" varchar(20);--> statement-breakpoint
ALTER TABLE "security_events" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "mod_cases" ADD CONSTRAINT "mod_cases_reverts_case_id_mod_cases_id_fk" FOREIGN KEY ("reverts_case_id") REFERENCES "public"."mod_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mod_cases_security_event_idx" ON "mod_cases" USING btree ("security_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_cases_live_uq" ON "mod_cases" USING btree ("target_user_id","action") WHERE "mod_cases"."ended_at" is null and "mod_cases"."action" in ('timeout', 'quarantine', 'ban');--> statement-breakpoint
CREATE INDEX "mod_cases_expiry_idx" ON "mod_cases" USING btree ("expires_at") WHERE "mod_cases"."ended_at" is null and "mod_cases"."expires_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "security_events_number_uq" ON "security_events" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "security_events_dedupe_uq" ON "security_events" USING btree ("dedupe_key");