CREATE TYPE "public"."adversarial_delivery" AS ENUM('pending', 'sent', 'undeliverable');--> statement-breakpoint
ALTER TABLE "adversarial_evaluations" ADD COLUMN "suggested_score" smallint;--> statement-breakpoint
ALTER TABLE "adversarial_evaluations" ADD COLUMN "override_justification" text;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "guardrails" text NOT NULL;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "sandbox_assets" text NOT NULL;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "briefing_revision" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "briefing_delivery" "adversarial_delivery";--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "briefing_delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "aborted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "red_flag_raised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "red_flag_raised_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "stop_notice_delivery" "adversarial_delivery";--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "stop_notice_delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "debrief_delivery" "adversarial_delivery";--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "debrief_channel_id" varchar(20);--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "debrief_message_id" varchar(20);--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "debrief_posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "adversarial_triggers" ADD COLUMN "fired_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "adversarial_triggers" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD CONSTRAINT "adversarial_roles_aborted_by_user_id_users_id_fk" FOREIGN KEY ("aborted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD CONSTRAINT "adversarial_roles_red_flag_raised_by_user_id_users_id_fk" FOREIGN KEY ("red_flag_raised_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_triggers" ADD CONSTRAINT "adversarial_triggers_fired_by_user_id_users_id_fk" FOREIGN KEY ("fired_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_triggers" ADD CONSTRAINT "adversarial_triggers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adversarial_roles_operative_idx" ON "adversarial_roles" USING btree ("operative_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "adversarial_roles_operative_uq" ON "adversarial_roles" USING btree ("trial_id","operative_member_id") WHERE "adversarial_roles"."aborted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "adversarial_roles_team_uq" ON "adversarial_roles" USING btree ("team_id") WHERE "adversarial_roles"."aborted_at" is null;--> statement-breakpoint
CREATE INDEX "adversarial_triggers_role_idx" ON "adversarial_triggers" USING btree ("role_id");--> statement-breakpoint
ALTER TABLE "adversarial_evaluations" ADD CONSTRAINT "adversarial_evaluations_score_ck" CHECK ("adversarial_evaluations"."security_culture_score" between 0 and 10);--> statement-breakpoint
ALTER TABLE "adversarial_evaluations" ADD CONSTRAINT "adversarial_evaluations_suggested_ck" CHECK ("adversarial_evaluations"."suggested_score" is null or "adversarial_evaluations"."suggested_score" between 0 and 10);