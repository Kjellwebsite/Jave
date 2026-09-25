CREATE TYPE "public"."external_account_provider" AS ENUM('github');--> statement-breakpoint
CREATE TABLE "external_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"provider" "external_account_provider" NOT NULL,
	"external_id" varchar(64),
	"username" varchar(64) NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "webhook_deliveries_idempotency_uq";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "integration_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "reviewed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "review_note" varchar(1000);--> statement-breakpoint
ALTER TABLE "project_links" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "archived_from_status" "project_status";--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "secret_rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_webhooks" ADD COLUMN "secret_rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_webhooks" ADD COLUMN "last_failure_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_webhooks" ADD COLUMN "last_error" varchar(500);--> statement-breakpoint
ALTER TABLE "outbound_webhooks" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_webhooks" ADD COLUMN "disabled_reason" varchar(200);--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "signature_digest" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "status_reason" varchar(200);--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "relay_message_id" varchar(20);--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "relayed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_accounts" ADD CONSTRAINT "external_accounts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_accounts" ADD CONSTRAINT "external_accounts_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_accounts_member_provider_uq" ON "external_accounts" USING btree ("member_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "external_accounts_username_uq" ON "external_accounts" USING btree ("provider","username");--> statement-breakpoint
CREATE UNIQUE INDEX "external_accounts_external_id_uq" ON "external_accounts" USING btree ("provider","external_id") WHERE "external_accounts"."external_id" is not null;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_links_project_idx" ON "project_links" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_one_owner_uq" ON "project_members" USING btree ("project_id") WHERE "project_members"."role" = 'owner' and "project_members"."left_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_signature_uq" ON "webhook_deliveries" USING btree ("integration_id","signature_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_github_delivery_uq" ON "webhook_deliveries" USING btree ("provider","delivery_id") WHERE "webhook_deliveries"."provider" = 'github';--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_github_signature_uq" ON "webhook_deliveries" USING btree ("provider","signature_digest") WHERE "webhook_deliveries"."provider" = 'github';--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_idempotency_uq" ON "webhook_deliveries" USING btree ("integration_id","delivery_id");