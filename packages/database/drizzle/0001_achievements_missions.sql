ALTER TABLE "achievement_definitions" ADD COLUMN "summary" varchar(120) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_achievements" ADD COLUMN "revoked_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "member_achievements" ADD COLUMN "announcement_channel_id" varchar(20);--> statement-breakpoint
ALTER TABLE "member_achievements" ADD COLUMN "announcement_message_id" varchar(20);--> statement-breakpoint
ALTER TABLE "member_achievements" ADD COLUMN "announced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD COLUMN "submission_evidence_title" varchar(200);--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD COLUMN "submission_evidence_url" text;--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD COLUMN "submitted_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD COLUMN "reviewed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD COLUMN "reminder_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "announcement_channel_id" varchar(20);--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "announcement_message_id" varchar(20);--> statement-breakpoint
ALTER TABLE "member_achievements" ADD CONSTRAINT "member_achievements_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD CONSTRAINT "mission_assignments_submitted_by_member_id_members_id_fk" FOREIGN KEY ("submitted_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD CONSTRAINT "mission_assignments_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_achievements_member_idx" ON "member_achievements" USING btree ("member_id","awarded_at");--> statement-breakpoint
CREATE INDEX "mission_assignments_team_idx" ON "mission_assignments" USING btree ("mission_id","team_key");