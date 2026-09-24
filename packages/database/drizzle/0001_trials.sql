ALTER TABLE "trial_teams" ADD COLUMN "briefed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trial_teams" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trials" ADD COLUMN "summary" varchar(280) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "trials" ADD COLUMN "grace_minutes" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trials" ADD COLUMN "assignment_strategy" varchar(16);--> statement-breakpoint
ALTER TABLE "trials" ADD COLUMN "assignment_seed" varchar(64);--> statement-breakpoint
ALTER TABLE "trials" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
CREATE INDEX "trial_participants_member_idx" ON "trial_participants" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "trial_results_member_idx" ON "trial_results" USING btree ("member_id");--> statement-breakpoint
ALTER TABLE "trial_evaluations" ADD CONSTRAINT "trial_evaluations_score_ck" CHECK ("trial_evaluations"."overall_score" between 0 and 10);--> statement-breakpoint
ALTER TABLE "trial_scores" ADD CONSTRAINT "trial_scores_range_ck" CHECK ("trial_scores"."score" between 0 and 10);--> statement-breakpoint
ALTER TABLE "trial_templates" ADD CONSTRAINT "trial_templates_team_size_ck" CHECK ("trial_templates"."team_size_min" >= 1 and "trial_templates"."team_size_max" >= "trial_templates"."team_size_min");--> statement-breakpoint
ALTER TABLE "trial_templates" ADD CONSTRAINT "trial_templates_duration_ck" CHECK ("trial_templates"."duration_minutes" > 0);--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_team_size_ck" CHECK ("trials"."team_size" >= 1);--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_duration_ck" CHECK ("trials"."duration_minutes" > 0);--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_grace_ck" CHECK ("trials"."grace_minutes" >= 0);