ALTER TABLE "invite_codes" ADD COLUMN "is_vanity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "status_reason" varchar(64);--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "reviewed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invite_codes_campaign_idx" ON "invite_codes" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "referrals_status_idx" ON "referrals" USING btree ("status","joined_at");--> statement-breakpoint
CREATE INDEX "referrals_campaign_idx" ON "referrals" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_invitee_joined_uq" ON "referrals" USING btree ("invitee_user_id","joined_at");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_live_invitee_uq" ON "referrals" USING btree ("invitee_user_id") WHERE "referrals"."status" in ('joined', 'retained');--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_valid_invitee_uq" ON "referrals" USING btree ("invitee_user_id") WHERE "referrals"."status" = 'valid';--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_code_claim_uq" ON "referrals" USING btree ("invitee_user_id") WHERE "referrals"."referral_code" is not null;