ALTER TABLE "events" ALTER COLUMN "ends_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "event_team_members" ADD COLUMN "event_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "announcement_channel_id" varchar(20);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "announcement_message_id" varchar(20);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "check_in_code_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "live_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cancel_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD COLUMN "reported_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "game_players" ADD COLUMN "seat" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN "player_count" smallint;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN "end_reason" varchar(200);--> statement-breakpoint
ALTER TABLE "event_team_members" ADD CONSTRAINT "event_team_members_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_rsvps_status_idx" ON "event_rsvps" USING btree ("event_id","status","responded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_team_members_event_member_uq" ON "event_team_members" USING btree ("event_id","member_id");--> statement-breakpoint
CREATE INDEX "events_ends_idx" ON "events" USING btree ("ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "game_players_seat_uq" ON "game_players" USING btree ("session_id","seat");--> statement-breakpoint
CREATE INDEX "game_sessions_sweep_idx" ON "game_sessions" USING btree ("status","last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "game_sessions_live_channel_uq" ON "game_sessions" USING btree ("discord_channel_id") WHERE "game_sessions"."status" in ('lobby', 'active') and "game_sessions"."discord_channel_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "game_sessions_live_activity_uq" ON "game_sessions" USING btree ("activity_instance_id") WHERE "game_sessions"."status" in ('lobby', 'active') and "game_sessions"."activity_instance_id" is not null;