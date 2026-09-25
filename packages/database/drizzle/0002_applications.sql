ALTER TABLE "applications" ADD COLUMN "review_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "review_card_lease_id" varchar(64);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "review_card_lease_expires_at" timestamp with time zone;