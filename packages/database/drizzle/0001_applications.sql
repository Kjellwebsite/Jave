ALTER TABLE "application_status_changes" ADD COLUMN "sequence" integer NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "application_status_changes_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "review_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "review_channel_id" varchar(20);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "review_message_id" varchar(20);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "review_card_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "review_card_rendered_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "applications_user_idx" ON "applications" USING btree ("user_id","created_at");