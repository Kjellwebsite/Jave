CREATE TYPE "public"."ticket_author_role" AS ENUM('requester', 'handler', 'participant');--> statement-breakpoint
ALTER TABLE "ticket_events" ADD COLUMN "seq" integer NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "ticket_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD COLUMN "seq" integer NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "ticket_messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD COLUMN "author_role" "ticket_author_role" DEFAULT 'participant' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD COLUMN "original_body" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "discord_card_message_id" varchar(20);--> statement-breakpoint
CREATE INDEX "tickets_sla_pending_idx" ON "tickets" USING btree ("sla_first_response_due_at") WHERE "tickets"."first_response_at" is null and "tickets"."sla_breached_at" is null;