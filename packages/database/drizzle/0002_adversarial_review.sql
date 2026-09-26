ALTER TABLE "adversarial_roles" ADD COLUMN "scenario_title" varchar(120);--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "technique" "adversarial_technique";--> statement-breakpoint
UPDATE "adversarial_roles" AS r SET "scenario_title" = s."title", "technique" = s."technique" FROM "adversarial_scenarios" AS s WHERE s."id" = r."scenario_id";--> statement-breakpoint
ALTER TABLE "adversarial_roles" ALTER COLUMN "scenario_title" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ALTER COLUMN "technique" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "plan_revision" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD COLUMN "authorization_note" text;--> statement-breakpoint
ALTER TABLE "adversarial_triggers" ADD COLUMN "approved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "adversarial_triggers" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
UPDATE "adversarial_triggers" AS t SET "approved_by_user_id" = r."authorized_by_user_id", "approved_at" = GREATEST(r."authorized_at", t."created_at") FROM "adversarial_roles" AS r WHERE r."id" = t."role_id" AND r."authorized_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "adversarial_triggers" ADD CONSTRAINT "adversarial_triggers_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
