ALTER TABLE "verifications" ALTER COLUMN "requested_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "target_key" varchar(160) NOT NULL;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "target_label" varchar(200) NOT NULL;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "outcome" jsonb;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "review_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "queue_channel_id" varchar(20);--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "queue_message_id" varchar(20);--> statement-breakpoint
CREATE INDEX "verification_evidence_evidence_idx" ON "verification_evidence" USING btree ("evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verifications_open_target_uq" ON "verifications" USING btree ("target_key") WHERE "verifications"."status" in ('pending', 'in_review');--> statement-breakpoint
CREATE INDEX "verifications_expiry_idx" ON "verifications" USING btree ("status","expires_at");