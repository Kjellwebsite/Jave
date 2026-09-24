CREATE TYPE "public"."research_enrichment_status" AS ENUM('pending', 'enriched', 'not_found', 'failed', 'skipped');--> statement-breakpoint
ALTER TYPE "public"."ai_request_status" ADD VALUE 'pending';--> statement-breakpoint
ALTER TABLE "ai_action_proposals" ADD COLUMN "payload_hash" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD COLUMN "surface" varchar(16);--> statement-breakpoint
ALTER TABLE "research_items" ADD COLUMN "title_guessed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "research_items" ADD COLUMN "enrichment_status" "research_enrichment_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "research_items" ADD COLUMN "enriched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "research_items" ADD COLUMN "enrichment_error" text;--> statement-breakpoint
ALTER TABLE "research_items" ADD COLUMN "sidus_sync_error" text;--> statement-breakpoint
CREATE INDEX "ai_action_proposals_requester_idx" ON "ai_action_proposals" USING btree ("requested_by_user_id","status");--> statement-breakpoint
CREATE INDEX "ai_action_proposals_expiry_idx" ON "ai_action_proposals" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "research_items_arxiv_uq" ON "research_items" USING btree ("arxiv_id");--> statement-breakpoint
CREATE INDEX "research_items_submitter_idx" ON "research_items" USING btree ("submitted_by_user_id","created_at");