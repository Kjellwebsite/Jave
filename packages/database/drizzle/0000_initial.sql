CREATE TYPE "public"."evidence_kind" AS ENUM('link', 'document', 'project', 'trial', 'mission', 'achievement', 'contribution', 'evaluation', 'other');--> statement-breakpoint
CREATE TYPE "public"."evidence_status" AS ENUM('submitted', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."guild_member_event_type" AS ENUM('join', 'leave');--> statement-breakpoint
CREATE TYPE "public"."guild_status" AS ENUM('present', 'departed', 'never_joined');--> statement-breakpoint
CREATE TYPE "public"."member_standing" AS ENUM('good', 'restricted', 'quarantined', 'banned');--> statement-breakpoint
CREATE TYPE "public"."onboarding_state" AS ENUM('not_started', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('founder', 'core', 'operations', 'moderator', 'verified', 'trial', 'applicant', 'member', 'supporter');--> statement-breakpoint
CREATE TYPE "public"."profile_visibility" AS ENUM('public', 'members', 'staff');--> statement-breakpoint
CREATE TYPE "public"."rank_change_source" AS ENUM('self', 'evaluator', 'trial', 'verification', 'system', 'import');--> statement-breakpoint
CREATE TYPE "public"."rank_track" AS ENUM('claimed', 'verified');--> statement-breakpoint
CREATE TYPE "public"."application_recommendation" AS ENUM('accept', 'reject', 'interview', 'abstain');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('draft', 'submitted', 'review', 'interview', 'accepted', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'in_review', 'approved', 'rejected', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."verification_type" AS ENUM('identity', 'project', 'skill', 'trial', 'contribution', 'achievement');--> statement-breakpoint
CREATE TYPE "public"."trial_category" AS ENUM('build', 'research', 'strategy', 'investigation', 'crisis', 'creation', 'communication', 'leadership', 'marketing', 'technical', 'security', 'adaptability', 'teamwork', 'execution');--> statement-breakpoint
CREATE TYPE "public"."trial_outcome" AS ENUM('distinction', 'pass', 'fail', 'incomplete');--> statement-breakpoint
CREATE TYPE "public"."trial_participant_status" AS ENUM('applied', 'selected', 'waitlisted', 'withdrawn', 'removed');--> statement-breakpoint
CREATE TYPE "public"."trial_status" AS ENUM('draft', 'recruiting', 'teams_assigned', 'active', 'evaluating', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."trial_team_role" AS ENUM('lead', 'member');--> statement-breakpoint
CREATE TYPE "public"."adversarial_delivery" AS ENUM('pending', 'sent', 'undeliverable');--> statement-breakpoint
CREATE TYPE "public"."adversarial_outcome" AS ENUM('resisted', 'detected', 'reported', 'partial', 'failure');--> statement-breakpoint
CREATE TYPE "public"."adversarial_role_status" AS ENUM('planned', 'briefed', 'active', 'concluded', 'revealed', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."adversarial_technique" AS ENUM('social_engineering', 'instruction_integrity', 'permission_hygiene', 'data_handling', 'verification_discipline');--> statement-breakpoint
CREATE TYPE "public"."ticket_author_role" AS ENUM('requester', 'handler', 'participant');--> statement-breakpoint
CREATE TYPE "public"."ticket_category" AS ENUM('general', 'application', 'technical', 'report', 'partnership', 'trial', 'operations', 'other');--> statement-breakpoint
CREATE TYPE "public"."ticket_event_type" AS ENUM('created', 'claimed', 'unclaimed', 'transferred', 'priority_changed', 'status_changed', 'closed', 'reopened', 'archived', 'note_added', 'summary_generated', 'transcript_accessed', 'sla_breached', 'sla_breach_retracted');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'claimed', 'waiting', 'closed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."discord_sync_state" AS ENUM('pending', 'applied', 'failed', 'not_required');--> statement-breakpoint
CREATE TYPE "public"."mod_action" AS ENUM('warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'quarantine', 'release', 'note');--> statement-breakpoint
CREATE TYPE "public"."mod_case_end_reason" AS ENUM('expired', 'lifted', 'superseded', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."mod_source" AS ENUM('manual', 'automod', 'ai_suggested', 'security_event', 'system');--> statement-breakpoint
CREATE TYPE "public"."security_action" AS ENUM('none', 'flagged', 'message_deleted', 'timeout', 'quarantine', 'kick', 'ban', 'lockdown');--> statement-breakpoint
CREATE TYPE "public"."security_event_source" AS ENUM('automod', 'join_screening', 'manual', 'integration', 'system');--> statement-breakpoint
CREATE TYPE "public"."security_event_status" AS ENUM('open', 'acknowledged', 'dismissed', 'actioned');--> statement-breakpoint
CREATE TYPE "public"."security_trigger" AS ENUM('spam_rate', 'duplicate_content', 'mention_spam', 'blocked_link', 'foreign_invite', 'join_burst', 'suspicious_account', 'manual_report');--> statement-breakpoint
CREATE TYPE "public"."referral_method" AS ENUM('invite', 'referral_code', 'vanity', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('joined', 'retained', 'valid', 'left', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."achievement_rarity" AS ENUM('standard', 'notable', 'rare', 'exceptional', 'singular');--> statement-breakpoint
CREATE TYPE "public"."achievement_verification" AS ENUM('unverified', 'verified');--> statement-breakpoint
CREATE TYPE "public"."achievement_visibility" AS ENUM('public', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."contribution_kind" AS ENUM('code', 'research', 'design', 'writing', 'operations', 'mentoring', 'review', 'other');--> statement-breakpoint
CREATE TYPE "public"."contribution_source" AS ENUM('manual', 'github', 'system');--> statement-breakpoint
CREATE TYPE "public"."contribution_status" AS ENUM('submitted', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('planned', 'active', 'done', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."project_member_role" AS ENUM('owner', 'maintainer', 'contributor');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('idea', 'planning', 'building', 'testing', 'shipped', 'archived');--> statement-breakpoint
CREATE TYPE "public"."project_visibility" AS ENUM('public', 'members', 'private');--> statement-breakpoint
CREATE TYPE "public"."mission_assignment_status" AS ENUM('assigned', 'accepted', 'submitted', 'verified', 'rejected', 'expired', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."mission_status" AS ENUM('draft', 'open', 'closed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."mission_type" AS ENUM('individual', 'team', 'research', 'build', 'social', 'physical', 'strategy', 'creative');--> statement-breakpoint
CREATE TYPE "public"."bracket_slot" AS ENUM('a', 'b');--> statement-breakpoint
CREATE TYPE "public"."event_kind" AS ENUM('meetup', 'workshop', 'talk', 'tournament', 'session', 'social', 'other');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('scheduled', 'live', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('pending', 'ready', 'completed', 'bye');--> statement-breakpoint
CREATE TYPE "public"."rsvp_status" AS ENUM('going', 'maybe', 'declined', 'waitlist');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'deferred', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('discord_dm', 'discord_channel', 'dashboard', 'email', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."notification_severity" AS ENUM('info', 'notice', 'important', 'critical');--> statement-breakpoint
CREATE TYPE "public"."ai_proposal_status" AS ENUM('pending', 'confirmed', 'executed', 'rejected', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ai_request_status" AS ENUM('ok', 'error', 'refused', 'rate_limited', 'disabled', 'pending');--> statement-breakpoint
CREATE TYPE "public"."evidence_level" AS ENUM('unknown', 'anecdotal', 'observational', 'experimental', 'peer_reviewed', 'meta_analysis');--> statement-breakpoint
CREATE TYPE "public"."research_enrichment_status" AS ENUM('pending', 'enriched', 'not_found', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."research_status" AS ENUM('new', 'needs_review', 'reviewed', 'verified', 'archived');--> statement-breakpoint
CREATE TYPE "public"."sidus_sync_status" AS ENUM('not_synced', 'pending', 'synced', 'failed');--> statement-breakpoint
CREATE TYPE "public"."external_account_provider" AS ENUM('github');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('github', 'generic', 'sidus', 'supabase', 'monitoring');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('received', 'processing', 'processed', 'ignored', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('user', 'system', 'ai', 'integration');--> statement-breakpoint
CREATE TYPE "public"."audit_result" AS ENUM('success', 'denied', 'failure');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'completed', 'failed', 'dead', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."game_session_status" AS ENUM('lobby', 'active', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."game_surface" AS ENUM('discord', 'activity', 'dashboard');--> statement-breakpoint
CREATE TABLE "capability_domains" (
	"key" varchar(32) PRIMARY KEY NOT NULL,
	"label" varchar(32) NOT NULL,
	"description" text NOT NULL,
	"ordinal" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_facets" (
	"key" varchar(48) PRIMARY KEY NOT NULL,
	"domain_key" varchar(32) NOT NULL,
	"label" varchar(48) NOT NULL,
	"description" text NOT NULL,
	"ordinal" smallint NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "evidence_kind" NOT NULL,
	"title" varchar(200) NOT NULL,
	"url" text,
	"description" text,
	"facet_key" varchar(48),
	"source_type" varchar(32),
	"source_id" uuid,
	"status" "evidence_status" DEFAULT 'submitted' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "guild_member_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "guild_member_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"type" "guild_member_event_type" NOT NULL,
	"account_age_days" integer,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"facet_key" varchar(48) NOT NULL,
	"claimed_rank" varchar(4),
	"claimed_at" timestamp with time zone,
	"verified_rank" varchar(4),
	"verified_at" timestamp with time zone,
	"verified_by_user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "member_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"role" "org_role" NOT NULL,
	"granted_by_user_id" uuid,
	"reason" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"handle" varchar(32) NOT NULL,
	"display_name" varchar(64) NOT NULL,
	"headline" varchar(160),
	"bio" text,
	"primary_domain" varchar(32),
	"guild_status" "guild_status" DEFAULT 'present' NOT NULL,
	"standing" "member_standing" DEFAULT 'good' NOT NULL,
	"onboarding_state" "onboarding_state" DEFAULT 'not_started' NOT NULL,
	"profile_visibility" "profile_visibility" DEFAULT 'members' NOT NULL,
	"show_claims_publicly" boolean DEFAULT true NOT NULL,
	"show_on_leaderboards" boolean DEFAULT true NOT NULL,
	"joined_guild_at" timestamp with time zone,
	"left_guild_at" timestamp with time zone,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rank_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"facet_key" varchar(48) NOT NULL,
	"track" "rank_track" NOT NULL,
	"from_rank" varchar(4),
	"to_rank" varchar(4),
	"source" "rank_change_source" NOT NULL,
	"source_ref" uuid,
	"reason" text,
	"evidence_id" uuid,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rank_tiers" (
	"code" varchar(4) PRIMARY KEY NOT NULL,
	"ordinal" smallint NOT NULL,
	"label" varchar(32) NOT NULL,
	"description" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "rank_tiers_ordinal_unique" UNIQUE("ordinal")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"user_agent" varchar(256),
	"ip_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"quiet_hours_start" smallint,
	"quiet_hours_end" smallint,
	"dm_notifications" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_id" varchar(20) NOT NULL,
	"username" varchar(64) NOT NULL,
	"display_name" varchar(64),
	"avatar_hash" varchar(128),
	"is_bot" boolean DEFAULT false NOT NULL,
	"discord_created_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "application_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"recommendation" "application_recommendation" NOT NULL,
	"score" smallint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_status_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"from_status" "application_status",
	"to_status" "application_status" NOT NULL,
	"actor_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sequence" integer GENERATED ALWAYS AS IDENTITY (sequence name "application_status_changes_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1)
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "applications_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"status" "application_status" DEFAULT 'draft' NOT NULL,
	"domain_key" varchar(32),
	"experience" text,
	"projects" text,
	"portfolio_url" text,
	"motivation" text,
	"references" text,
	"evidence_links" text[] DEFAULT '{}'::text[] NOT NULL,
	"referral_code" varchar(32),
	"assigned_reviewer_user_id" uuid,
	"interview_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"decision_reason" text,
	"applicant_message" text,
	"review_assigned_at" timestamp with time zone,
	"review_reminder_sent_at" timestamp with time zone,
	"review_channel_id" varchar(20),
	"review_message_id" varchar(20),
	"review_card_revision" integer DEFAULT 0 NOT NULL,
	"review_card_rendered_revision" integer DEFAULT 0 NOT NULL,
	"review_card_lease_id" varchar(64),
	"review_card_lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_evidence" (
	"verification_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	CONSTRAINT "verification_evidence_verification_id_evidence_id_pk" PRIMARY KEY("verification_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "verifications_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" "verification_type" NOT NULL,
	"subject_member_id" uuid NOT NULL,
	"claim" text NOT NULL,
	"target_type" varchar(32),
	"target_id" uuid,
	"target_key" varchar(160) NOT NULL,
	"target_label" varchar(200) NOT NULL,
	"facet_key" varchar(48),
	"requested_rank" varchar(4),
	"granted_rank" varchar(4),
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" uuid,
	"assigned_verifier_user_id" uuid,
	"verifier_user_id" uuid,
	"decision_note" text,
	"outcome" jsonb,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_started_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"revoke_reason" text,
	"queue_channel_id" varchar(20),
	"queue_message_id" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_id" uuid NOT NULL,
	"team_id" uuid,
	"member_id" uuid,
	"evaluator_user_id" uuid NOT NULL,
	"overall_score" double precision NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trial_evaluations_score_ck" CHECK ("trial_evaluations"."overall_score" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "trial_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "trial_participant_status" DEFAULT 'applied' NOT NULL,
	"team_id" uuid,
	"team_role" "trial_team_role",
	"statement" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"selected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"team_id" uuid,
	"team_score" double precision,
	"individual_score" double precision,
	"final_score" double precision,
	"outcome" "trial_outcome" NOT NULL,
	"facet_key" varchar(48),
	"recommended_rank" varchar(4),
	"rank_history_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_scores" (
	"evaluation_id" uuid NOT NULL,
	"criterion_key" varchar(48) NOT NULL,
	"score" smallint NOT NULL,
	CONSTRAINT "trial_scores_evaluation_id_criterion_key_pk" PRIMARY KEY("evaluation_id","criterion_key"),
	CONSTRAINT "trial_scores_range_ck" CHECK ("trial_scores"."score" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "trial_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"submitted_by_member_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"links" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" smallint DEFAULT 1 NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_id" uuid NOT NULL,
	"name" varchar(64) NOT NULL,
	"ordinal" smallint NOT NULL,
	"discord_channel_id" varchar(20),
	"discord_role_id" varchar(20),
	"briefed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(64) NOT NULL,
	"title" varchar(120) NOT NULL,
	"category" "trial_category" NOT NULL,
	"summary" varchar(280) NOT NULL,
	"brief" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"team_size_min" smallint DEFAULT 2 NOT NULL,
	"team_size_max" smallint DEFAULT 4 NOT NULL,
	"rubric" jsonb NOT NULL,
	"facet_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"allows_adversarial" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trial_templates_team_size_ck" CHECK ("trial_templates"."team_size_min" >= 1 and "trial_templates"."team_size_max" >= "trial_templates"."team_size_min"),
	CONSTRAINT "trial_templates_duration_ck" CHECK ("trial_templates"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "trials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "trials_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"template_id" uuid,
	"title" varchar(120) NOT NULL,
	"category" "trial_category" NOT NULL,
	"summary" varchar(280) DEFAULT '' NOT NULL,
	"brief" text NOT NULL,
	"rubric" jsonb NOT NULL,
	"facet_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "trial_status" DEFAULT 'draft' NOT NULL,
	"team_size" smallint DEFAULT 3 NOT NULL,
	"max_participants" integer,
	"recruitment_closes_at" timestamp with time zone,
	"scheduled_start_at" timestamp with time zone,
	"duration_minutes" integer NOT NULL,
	"deadline_at" timestamp with time zone,
	"grace_minutes" smallint DEFAULT 0 NOT NULL,
	"assignment_strategy" varchar(16),
	"assignment_seed" varchar(64),
	"started_at" timestamp with time zone,
	"submissions_closed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"adversarial_enabled" boolean DEFAULT false NOT NULL,
	"discord_category_id" varchar(20),
	"announcement_channel_id" varchar(20),
	"announcement_message_id" varchar(20),
	"created_by_user_id" uuid,
	"editor_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trials_team_size_ck" CHECK ("trials"."team_size" >= 1),
	CONSTRAINT "trials_duration_ck" CHECK ("trials"."duration_minutes" > 0),
	CONSTRAINT "trials_grace_ck" CHECK ("trials"."grace_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "adversarial_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"evaluator_user_id" uuid NOT NULL,
	"security_culture_score" smallint NOT NULL,
	"suggested_score" smallint,
	"override_justification" text,
	"summary" text NOT NULL,
	"debrief" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adversarial_evaluations_score_ck" CHECK ("adversarial_evaluations"."security_culture_score" between 0 and 10),
	CONSTRAINT "adversarial_evaluations_suggested_ck" CHECK ("adversarial_evaluations"."suggested_score" is null or "adversarial_evaluations"."suggested_score" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "adversarial_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"trigger_id" uuid,
	"observer_user_id" uuid NOT NULL,
	"subject_member_id" uuid,
	"outcome" "adversarial_outcome" NOT NULL,
	"description" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "adversarial_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_id" uuid NOT NULL,
	"team_id" uuid,
	"operative_member_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"objective" text NOT NULL,
	"guardrails" text NOT NULL,
	"sandbox_assets" text NOT NULL,
	"status" "adversarial_role_status" DEFAULT 'planned' NOT NULL,
	"authorized_by_user_id" uuid,
	"authorized_at" timestamp with time zone,
	"sandbox_attested" boolean DEFAULT false NOT NULL,
	"briefed_at" timestamp with time zone,
	"briefing_revision" smallint DEFAULT 1 NOT NULL,
	"briefing_delivery" "adversarial_delivery",
	"briefing_delivered_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"concluded_at" timestamp with time zone,
	"revealed_at" timestamp with time zone,
	"aborted_at" timestamp with time zone,
	"abort_reason" text,
	"aborted_by_user_id" uuid,
	"red_flag_raised_at" timestamp with time zone,
	"red_flag_raised_by_user_id" uuid,
	"stop_notice_delivery" "adversarial_delivery",
	"stop_notice_delivered_at" timestamp with time zone,
	"debrief_delivery" "adversarial_delivery",
	"debrief_channel_id" varchar(20),
	"debrief_message_id" varchar(20),
	"debrief_posted_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "adversarial_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(64) NOT NULL,
	"title" varchar(120) NOT NULL,
	"technique" "adversarial_technique" NOT NULL,
	"description" text NOT NULL,
	"objective" text NOT NULL,
	"guardrails" text NOT NULL,
	"sandbox_assets" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "adversarial_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"label" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"planned_for" timestamp with time zone,
	"fired_at" timestamp with time zone,
	"fired_by_user_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "ticket_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" "ticket_event_type" NOT NULL,
	"actor_user_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "ticket_messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ticket_id" uuid NOT NULL,
	"author_user_id" uuid,
	"author_role" "ticket_author_role" DEFAULT 'participant' NOT NULL,
	"discord_message_id" varchar(20),
	"body" text NOT NULL,
	"original_body" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "tickets_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"category" "ticket_category" NOT NULL,
	"priority" "ticket_priority" DEFAULT 'normal' NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"subject" varchar(120) NOT NULL,
	"opener_user_id" uuid NOT NULL,
	"assignee_user_id" uuid,
	"discord_channel_id" varchar(20),
	"discord_thread_id" varchar(20),
	"discord_card_message_id" varchar(20),
	"sla_first_response_due_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"sla_breached_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" uuid,
	"close_reason" text,
	"reopen_count" integer DEFAULT 0 NOT NULL,
	"ai_summary" text,
	"ai_summary_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "mod_cases_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"action" "mod_action" NOT NULL,
	"target_user_id" uuid NOT NULL,
	"moderator_user_id" uuid,
	"reason" text NOT NULL,
	"duration_seconds" integer,
	"expires_at" timestamp with time zone,
	"delete_message_days" smallint,
	"source" "mod_source" DEFAULT 'manual' NOT NULL,
	"security_event_id" uuid,
	"reverts_case_id" uuid,
	"discord_sync" "discord_sync_state" DEFAULT 'pending' NOT NULL,
	"discord_error" text,
	"discord_synced_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_reason" "mod_case_end_reason",
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "security_events_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" uuid,
	"risk_score" smallint NOT NULL,
	"trigger" "security_trigger" NOT NULL,
	"source" "security_event_source" DEFAULT 'system' NOT NULL,
	"evidence" jsonb NOT NULL,
	"action_taken" "security_action" DEFAULT 'none' NOT NULL,
	"status" "security_event_status" DEFAULT 'open' NOT NULL,
	"channel_id" varchar(20),
	"reported_by_user_id" uuid,
	"dedupe_key" varchar(128),
	"alert_channel_id" varchar(20),
	"alert_message_id" varchar(20),
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(48) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"code" varchar(32) PRIMARY KEY NOT NULL,
	"inviter_user_id" uuid,
	"channel_id" varchar(20),
	"uses" integer DEFAULT 0 NOT NULL,
	"max_uses" integer,
	"temporary" boolean DEFAULT false NOT NULL,
	"is_vanity" boolean DEFAULT false NOT NULL,
	"campaign_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"code" varchar(32) PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"campaign_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitee_user_id" uuid NOT NULL,
	"inviter_user_id" uuid,
	"invite_code" varchar(32),
	"referral_code" varchar(32),
	"campaign_id" uuid,
	"method" "referral_method" NOT NULL,
	"status" "referral_status" DEFAULT 'joined' NOT NULL,
	"status_reason" varchar(64),
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"retained_at" timestamp with time zone,
	"validated_at" timestamp with time zone,
	"anomaly_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"anomaly_score" smallint DEFAULT 0 NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achievement_definitions" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"title" varchar(64) NOT NULL,
	"description" text NOT NULL,
	"summary" varchar(120) DEFAULT '' NOT NULL,
	"category" varchar(32) NOT NULL,
	"rarity" "achievement_rarity" DEFAULT 'standard' NOT NULL,
	"visibility" "achievement_visibility" DEFAULT 'public' NOT NULL,
	"criteria" jsonb NOT NULL,
	"requires_verification" boolean DEFAULT false NOT NULL,
	"facet_key" varchar(48),
	"active" boolean DEFAULT true NOT NULL,
	"ordinal" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"achievement_key" varchar(64) NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"awarded_by_user_id" uuid,
	"source_event_id" bigint,
	"verification" "achievement_verification" DEFAULT 'unverified' NOT NULL,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"note" text,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"revoked_by_user_id" uuid,
	"announcement_channel_id" varchar(20),
	"announcement_message_id" varchar(20),
	"announced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"project_id" uuid,
	"kind" "contribution_kind" NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"url" text,
	"source" "contribution_source" DEFAULT 'manual' NOT NULL,
	"external_ref" varchar(200),
	"status" "contribution_status" DEFAULT 'submitted' NOT NULL,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" varchar(1000),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"label" varchar(48) NOT NULL,
	"url" text NOT NULL,
	"ordinal" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" "project_member_role" DEFAULT 'contributor' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" text,
	"status" "milestone_status" DEFAULT 'planned' NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"ordinal" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"title" varchar(120) NOT NULL,
	"summary" varchar(280),
	"description" text,
	"owner_member_id" uuid NOT NULL,
	"status" "project_status" DEFAULT 'idea' NOT NULL,
	"domain_key" varchar(32),
	"goals" text,
	"visibility" "project_visibility" DEFAULT 'members' NOT NULL,
	"github_repo" varchar(140),
	"repo_url" text,
	"website_url" text,
	"shipped_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archived_from_status" "project_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mission_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"team_key" varchar(32),
	"status" "mission_assignment_status" DEFAULT 'assigned' NOT NULL,
	"assigned_by_user_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"submission" text,
	"submission_evidence_title" varchar(200),
	"submission_evidence_url" text,
	"submitted_by_member_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"evidence_id" uuid,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"feedback" text,
	"reminder_due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "missions_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" varchar(120) NOT NULL,
	"brief" text NOT NULL,
	"type" "mission_type" NOT NULL,
	"status" "mission_status" DEFAULT 'draft' NOT NULL,
	"facet_key" varchar(48),
	"evidence_required" boolean DEFAULT true NOT NULL,
	"reward_achievement_key" varchar(64),
	"reward_note" varchar(200),
	"max_assignees" integer,
	"self_assignable" boolean DEFAULT true NOT NULL,
	"deadline_at" timestamp with time zone,
	"duration_hours" integer,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"announcement_channel_id" varchar(20),
	"announcement_message_id" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "event_rsvps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "rsvp_status" NOT NULL,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_in_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "event_team_members" (
	"team_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	CONSTRAINT "event_team_members_team_id_member_id_pk" PRIMARY KEY("team_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "event_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" varchar(64) NOT NULL,
	"seed" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" text,
	"kind" "event_kind" NOT NULL,
	"status" "event_status" DEFAULT 'scheduled' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" varchar(200),
	"discord_scheduled_event_id" varchar(20),
	"announcement_channel_id" varchar(20),
	"announcement_message_id" varchar(20),
	"capacity" integer,
	"rsvp_closes_at" timestamp with time zone,
	"check_in_code_hash" varchar(64),
	"check_in_code_issued_at" timestamp with time zone,
	"host_member_id" uuid,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	"live_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"round" smallint NOT NULL,
	"position" smallint NOT NULL,
	"team_a_id" uuid,
	"team_b_id" uuid,
	"winner_team_id" uuid,
	"score_a" integer,
	"score_b" integer,
	"status" "match_status" DEFAULT 'pending' NOT NULL,
	"next_match_id" uuid,
	"next_slot" "bracket_slot",
	"reported_by_user_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"deliver_after" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"type" varchar(64) NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "notification_preferences_user_id_type_channel_pk" PRIMARY KEY("user_id","type","channel")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"type" varchar(64) NOT NULL,
	"severity" "notification_severity" DEFAULT 'info' NOT NULL,
	"title" varchar(120) NOT NULL,
	"body" text NOT NULL,
	"url" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_action_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(48) NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"ai_request_id" uuid,
	"payload" jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"preview" text NOT NULL,
	"status" "ai_proposal_status" DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"result" jsonb,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"feature" varchar(32) NOT NULL,
	"surface" varchar(16),
	"provider" varchar(32) NOT NULL,
	"model" varchar(64) NOT NULL,
	"status" "ai_request_status" NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(64),
	"prompt_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(300) NOT NULL,
	"title_guessed" boolean DEFAULT false NOT NULL,
	"authors" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" varchar(120),
	"url" text,
	"canonical_url" text,
	"doi" varchar(200),
	"arxiv_id" varchar(32),
	"topic" varchar(80),
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"summary" text,
	"evidence_level" "evidence_level" DEFAULT 'unknown' NOT NULL,
	"status" "research_status" DEFAULT 'new' NOT NULL,
	"published_on" date,
	"submitted_by_user_id" uuid NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"discord_message_id" varchar(20),
	"discord_message_url" text,
	"enrichment_status" "research_enrichment_status" DEFAULT 'pending' NOT NULL,
	"enriched_at" timestamp with time zone,
	"enrichment_error" text,
	"sidus_sync_status" "sidus_sync_status" DEFAULT 'not_synced' NOT NULL,
	"sidus_external_id" varchar(128),
	"sidus_synced_at" timestamp with time zone,
	"sidus_sync_error" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
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
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"name" varchar(80) NOT NULL,
	"slug" varchar(48) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_ciphertext" text,
	"secret_rotated_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_id" bigint NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'received' NOT NULL,
	"response_status" smallint,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbound_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"url" text NOT NULL,
	"event_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"secret_rotated_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_error" varchar(500),
	"disabled_at" timestamp with time zone,
	"disabled_reason" varchar(200),
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"delivery_id" varchar(128) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"signature_digest" varchar(64) NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'received' NOT NULL,
	"status_reason" varchar(200),
	"payload" jsonb NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"relay_message_id" varchar(20),
	"relayed_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "analytics_snapshots" (
	"day" date NOT NULL,
	"metric" varchar(64) NOT NULL,
	"dimension" varchar(64) DEFAULT '' NOT NULL,
	"value" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32),
	"target_id" varchar(64),
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" "audit_result" DEFAULT 'success' NOT NULL,
	"request_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "domain_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" varchar(64) NOT NULL,
	"aggregate_type" varchar(32) NOT NULL,
	"aggregate_id" varchar(64) NOT NULL,
	"actor_user_id" uuid,
	"subject_member_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" varchar(64) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint DEFAULT 5 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(64),
	"last_error" text,
	"result" jsonb,
	"dedupe_key" varchar(200),
	"rerun_requested" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" varchar(160) PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_settings" (
	"section" varchar(32) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_moves" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "game_moves_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"round" smallint NOT NULL,
	"move" jsonb NOT NULL,
	"correct" boolean,
	"points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"seat" integer NOT NULL,
	"team" varchar(32),
	"score" integer DEFAULT 0 NOT NULL,
	"placement" smallint,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_key" varchar(32) NOT NULL,
	"status" "game_session_status" DEFAULT 'lobby' NOT NULL,
	"surface" "game_surface" NOT NULL,
	"host_user_id" uuid NOT NULL,
	"discord_channel_id" varchar(20),
	"discord_message_id" varchar(20),
	"activity_instance_id" varchar(128),
	"seed" varchar(64) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"player_count" smallint,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"end_reason" varchar(200),
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capability_facets" ADD CONSTRAINT "capability_facets_domain_key_capability_domains_key_fk" FOREIGN KEY ("domain_key") REFERENCES "public"."capability_domains"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_facet_key_capability_facets_key_fk" FOREIGN KEY ("facet_key") REFERENCES "public"."capability_facets"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_member_events" ADD CONSTRAINT "guild_member_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_capabilities" ADD CONSTRAINT "member_capabilities_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_capabilities" ADD CONSTRAINT "member_capabilities_facet_key_capability_facets_key_fk" FOREIGN KEY ("facet_key") REFERENCES "public"."capability_facets"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_capabilities" ADD CONSTRAINT "member_capabilities_claimed_rank_rank_tiers_code_fk" FOREIGN KEY ("claimed_rank") REFERENCES "public"."rank_tiers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_capabilities" ADD CONSTRAINT "member_capabilities_verified_rank_rank_tiers_code_fk" FOREIGN KEY ("verified_rank") REFERENCES "public"."rank_tiers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_capabilities" ADD CONSTRAINT "member_capabilities_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_notes" ADD CONSTRAINT "member_notes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_notes" ADD CONSTRAINT "member_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_primary_domain_capability_domains_key_fk" FOREIGN KEY ("primary_domain") REFERENCES "public"."capability_domains"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_history" ADD CONSTRAINT "rank_history_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_history" ADD CONSTRAINT "rank_history_facet_key_capability_facets_key_fk" FOREIGN KEY ("facet_key") REFERENCES "public"."capability_facets"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_history" ADD CONSTRAINT "rank_history_from_rank_rank_tiers_code_fk" FOREIGN KEY ("from_rank") REFERENCES "public"."rank_tiers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_history" ADD CONSTRAINT "rank_history_to_rank_rank_tiers_code_fk" FOREIGN KEY ("to_rank") REFERENCES "public"."rank_tiers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_history" ADD CONSTRAINT "rank_history_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_history" ADD CONSTRAINT "rank_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_reviews" ADD CONSTRAINT "application_reviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_reviews" ADD CONSTRAINT "application_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_status_changes" ADD CONSTRAINT "application_status_changes_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_status_changes" ADD CONSTRAINT "application_status_changes_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_domain_key_capability_domains_key_fk" FOREIGN KEY ("domain_key") REFERENCES "public"."capability_domains"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_assigned_reviewer_user_id_users_id_fk" FOREIGN KEY ("assigned_reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_evidence" ADD CONSTRAINT "verification_evidence_verification_id_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."verifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_evidence" ADD CONSTRAINT "verification_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_subject_member_id_members_id_fk" FOREIGN KEY ("subject_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_facet_key_capability_facets_key_fk" FOREIGN KEY ("facet_key") REFERENCES "public"."capability_facets"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_requested_rank_rank_tiers_code_fk" FOREIGN KEY ("requested_rank") REFERENCES "public"."rank_tiers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_granted_rank_rank_tiers_code_fk" FOREIGN KEY ("granted_rank") REFERENCES "public"."rank_tiers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_assigned_verifier_user_id_users_id_fk" FOREIGN KEY ("assigned_verifier_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_verifier_user_id_users_id_fk" FOREIGN KEY ("verifier_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_evaluations" ADD CONSTRAINT "trial_evaluations_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_evaluations" ADD CONSTRAINT "trial_evaluations_team_id_trial_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."trial_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_evaluations" ADD CONSTRAINT "trial_evaluations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_evaluations" ADD CONSTRAINT "trial_evaluations_evaluator_user_id_users_id_fk" FOREIGN KEY ("evaluator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_participants" ADD CONSTRAINT "trial_participants_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_participants" ADD CONSTRAINT "trial_participants_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_participants" ADD CONSTRAINT "trial_participants_team_id_trial_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."trial_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_results" ADD CONSTRAINT "trial_results_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_results" ADD CONSTRAINT "trial_results_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_results" ADD CONSTRAINT "trial_results_team_id_trial_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."trial_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_results" ADD CONSTRAINT "trial_results_recommended_rank_rank_tiers_code_fk" FOREIGN KEY ("recommended_rank") REFERENCES "public"."rank_tiers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_results" ADD CONSTRAINT "trial_results_rank_history_id_rank_history_id_fk" FOREIGN KEY ("rank_history_id") REFERENCES "public"."rank_history"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_scores" ADD CONSTRAINT "trial_scores_evaluation_id_trial_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."trial_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_submissions" ADD CONSTRAINT "trial_submissions_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_submissions" ADD CONSTRAINT "trial_submissions_team_id_trial_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."trial_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_submissions" ADD CONSTRAINT "trial_submissions_submitted_by_member_id_members_id_fk" FOREIGN KEY ("submitted_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_teams" ADD CONSTRAINT "trial_teams_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_templates" ADD CONSTRAINT "trial_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_template_id_trial_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."trial_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_evaluations" ADD CONSTRAINT "adversarial_evaluations_role_id_adversarial_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."adversarial_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_evaluations" ADD CONSTRAINT "adversarial_evaluations_evaluator_user_id_users_id_fk" FOREIGN KEY ("evaluator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_observations" ADD CONSTRAINT "adversarial_observations_role_id_adversarial_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."adversarial_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_observations" ADD CONSTRAINT "adversarial_observations_trigger_id_adversarial_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."adversarial_triggers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_observations" ADD CONSTRAINT "adversarial_observations_observer_user_id_users_id_fk" FOREIGN KEY ("observer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_observations" ADD CONSTRAINT "adversarial_observations_subject_member_id_members_id_fk" FOREIGN KEY ("subject_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD CONSTRAINT "adversarial_roles_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD CONSTRAINT "adversarial_roles_team_id_trial_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."trial_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD CONSTRAINT "adversarial_roles_operative_member_id_members_id_fk" FOREIGN KEY ("operative_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD CONSTRAINT "adversarial_roles_scenario_id_adversarial_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."adversarial_scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD CONSTRAINT "adversarial_roles_authorized_by_user_id_users_id_fk" FOREIGN KEY ("authorized_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD CONSTRAINT "adversarial_roles_aborted_by_user_id_users_id_fk" FOREIGN KEY ("aborted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD CONSTRAINT "adversarial_roles_red_flag_raised_by_user_id_users_id_fk" FOREIGN KEY ("red_flag_raised_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_roles" ADD CONSTRAINT "adversarial_roles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_scenarios" ADD CONSTRAINT "adversarial_scenarios_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_triggers" ADD CONSTRAINT "adversarial_triggers_role_id_adversarial_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."adversarial_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_triggers" ADD CONSTRAINT "adversarial_triggers_fired_by_user_id_users_id_fk" FOREIGN KEY ("fired_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adversarial_triggers" ADD CONSTRAINT "adversarial_triggers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_opener_user_id_users_id_fk" FOREIGN KEY ("opener_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_cases" ADD CONSTRAINT "mod_cases_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_cases" ADD CONSTRAINT "mod_cases_moderator_user_id_users_id_fk" FOREIGN KEY ("moderator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_cases" ADD CONSTRAINT "mod_cases_security_event_id_security_events_id_fk" FOREIGN KEY ("security_event_id") REFERENCES "public"."security_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_cases" ADD CONSTRAINT "mod_cases_reverts_case_id_mod_cases_id_fk" FOREIGN KEY ("reverts_case_id") REFERENCES "public"."mod_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_cases" ADD CONSTRAINT "mod_cases_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_invitee_user_id_users_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referral_code_referral_codes_code_fk" FOREIGN KEY ("referral_code") REFERENCES "public"."referral_codes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_definitions" ADD CONSTRAINT "achievement_definitions_facet_key_capability_facets_key_fk" FOREIGN KEY ("facet_key") REFERENCES "public"."capability_facets"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_achievements" ADD CONSTRAINT "member_achievements_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_achievements" ADD CONSTRAINT "member_achievements_achievement_key_achievement_definitions_key_fk" FOREIGN KEY ("achievement_key") REFERENCES "public"."achievement_definitions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_achievements" ADD CONSTRAINT "member_achievements_awarded_by_user_id_users_id_fk" FOREIGN KEY ("awarded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_achievements" ADD CONSTRAINT "member_achievements_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_achievements" ADD CONSTRAINT "member_achievements_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_member_id_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_domain_key_capability_domains_key_fk" FOREIGN KEY ("domain_key") REFERENCES "public"."capability_domains"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD CONSTRAINT "mission_assignments_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD CONSTRAINT "mission_assignments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD CONSTRAINT "mission_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD CONSTRAINT "mission_assignments_submitted_by_member_id_members_id_fk" FOREIGN KEY ("submitted_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD CONSTRAINT "mission_assignments_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD CONSTRAINT "mission_assignments_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_assignments" ADD CONSTRAINT "mission_assignments_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_facet_key_capability_facets_key_fk" FOREIGN KEY ("facet_key") REFERENCES "public"."capability_facets"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_reward_achievement_key_achievement_definitions_key_fk" FOREIGN KEY ("reward_achievement_key") REFERENCES "public"."achievement_definitions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_team_members" ADD CONSTRAINT "event_team_members_team_id_event_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."event_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_team_members" ADD CONSTRAINT "event_team_members_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_team_members" ADD CONSTRAINT "event_team_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_teams" ADD CONSTRAINT "event_teams_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_host_member_id_members_id_fk" FOREIGN KEY ("host_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_team_a_id_event_teams_id_fk" FOREIGN KEY ("team_a_id") REFERENCES "public"."event_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_team_b_id_event_teams_id_fk" FOREIGN KEY ("team_b_id") REFERENCES "public"."event_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_winner_team_id_event_teams_id_fk" FOREIGN KEY ("winner_team_id") REFERENCES "public"."event_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_next_match_id_tournament_matches_id_fk" FOREIGN KEY ("next_match_id") REFERENCES "public"."tournament_matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_proposals" ADD CONSTRAINT "ai_action_proposals_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_proposals" ADD CONSTRAINT "ai_action_proposals_ai_request_id_ai_requests_id_fk" FOREIGN KEY ("ai_request_id") REFERENCES "public"."ai_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_proposals" ADD CONSTRAINT "ai_action_proposals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_items" ADD CONSTRAINT "research_items_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_items" ADD CONSTRAINT "research_items_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_accounts" ADD CONSTRAINT "external_accounts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_accounts" ADD CONSTRAINT "external_accounts_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_deliveries" ADD CONSTRAINT "outbound_deliveries_webhook_id_outbound_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."outbound_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_webhooks" ADD CONSTRAINT "outbound_webhooks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_settings" ADD CONSTRAINT "server_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_moves" ADD CONSTRAINT "game_moves_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_moves" ADD CONSTRAINT "game_moves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_member_idx" ON "evidence" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "evidence_source_idx" ON "evidence" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "guild_member_events_time_idx" ON "guild_member_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "guild_member_events_user_idx" ON "guild_member_events" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_capabilities_member_facet_uq" ON "member_capabilities" USING btree ("member_id","facet_key");--> statement-breakpoint
CREATE INDEX "member_notes_member_idx" ON "member_notes" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_roles_active_uq" ON "member_roles" USING btree ("member_id","role") WHERE "member_roles"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "member_roles_role_idx" ON "member_roles" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "members_user_id_uq" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_handle_uq" ON "members" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "members_guild_status_idx" ON "members" USING btree ("guild_status");--> statement-breakpoint
CREATE INDEX "rank_history_member_idx" ON "rank_history" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_discord_id_uq" ON "users" USING btree ("discord_id");--> statement-breakpoint
CREATE UNIQUE INDEX "application_reviews_reviewer_uq" ON "application_reviews" USING btree ("application_id","reviewer_user_id");--> statement-breakpoint
CREATE INDEX "application_status_changes_app_idx" ON "application_status_changes" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_number_uq" ON "applications" USING btree ("number");--> statement-breakpoint
CREATE INDEX "applications_user_idx" ON "applications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_open_per_user_uq" ON "applications" USING btree ("user_id") WHERE "applications"."status" in ('draft', 'submitted', 'review', 'interview');--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "verification_evidence_evidence_idx" ON "verification_evidence" USING btree ("evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verifications_number_uq" ON "verifications" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "verifications_open_target_uq" ON "verifications" USING btree ("target_key") WHERE "verifications"."status" in ('pending', 'in_review');--> statement-breakpoint
CREATE INDEX "verifications_subject_idx" ON "verifications" USING btree ("subject_member_id");--> statement-breakpoint
CREATE INDEX "verifications_status_idx" ON "verifications" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "verifications_expiry_idx" ON "verifications" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "verifications_target_idx" ON "verifications" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_evaluations_team_uq" ON "trial_evaluations" USING btree ("trial_id","team_id","evaluator_user_id") WHERE "trial_evaluations"."member_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "trial_evaluations_member_uq" ON "trial_evaluations" USING btree ("trial_id","member_id","evaluator_user_id") WHERE "trial_evaluations"."member_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "trial_participants_member_uq" ON "trial_participants" USING btree ("trial_id","member_id");--> statement-breakpoint
CREATE INDEX "trial_participants_team_idx" ON "trial_participants" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "trial_participants_member_idx" ON "trial_participants" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_results_member_uq" ON "trial_results" USING btree ("trial_id","member_id");--> statement-breakpoint
CREATE INDEX "trial_results_member_idx" ON "trial_results" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_submissions_version_uq" ON "trial_submissions" USING btree ("team_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_teams_name_uq" ON "trial_teams" USING btree ("trial_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_templates_key_uq" ON "trial_templates" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "trials_number_uq" ON "trials" USING btree ("number");--> statement-breakpoint
CREATE INDEX "trials_status_idx" ON "trials" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "adversarial_evaluations_role_uq" ON "adversarial_evaluations" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "adversarial_observations_role_idx" ON "adversarial_observations" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "adversarial_roles_trial_idx" ON "adversarial_roles" USING btree ("trial_id");--> statement-breakpoint
CREATE INDEX "adversarial_roles_operative_idx" ON "adversarial_roles" USING btree ("operative_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "adversarial_roles_operative_uq" ON "adversarial_roles" USING btree ("trial_id","operative_member_id") WHERE "adversarial_roles"."aborted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "adversarial_roles_team_uq" ON "adversarial_roles" USING btree ("team_id") WHERE "adversarial_roles"."aborted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "adversarial_scenarios_key_uq" ON "adversarial_scenarios" USING btree ("key");--> statement-breakpoint
CREATE INDEX "adversarial_triggers_role_idx" ON "adversarial_triggers" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "ticket_events_ticket_idx" ON "ticket_events" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_messages_discord_uq" ON "ticket_messages" USING btree ("discord_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_number_uq" ON "tickets" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_thread_uq" ON "tickets" USING btree ("discord_thread_id");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "tickets_assignee_idx" ON "tickets" USING btree ("assignee_user_id");--> statement-breakpoint
CREATE INDEX "tickets_opener_idx" ON "tickets" USING btree ("opener_user_id");--> statement-breakpoint
CREATE INDEX "tickets_sla_pending_idx" ON "tickets" USING btree ("sla_first_response_due_at") WHERE "tickets"."first_response_at" is null and "tickets"."sla_breached_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "mod_cases_number_uq" ON "mod_cases" USING btree ("number");--> statement-breakpoint
CREATE INDEX "mod_cases_target_idx" ON "mod_cases" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "mod_cases_time_idx" ON "mod_cases" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mod_cases_security_event_idx" ON "mod_cases" USING btree ("security_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_cases_live_uq" ON "mod_cases" USING btree ("target_user_id","action") WHERE "mod_cases"."ended_at" is null and "mod_cases"."action" in ('timeout', 'quarantine', 'ban');--> statement-breakpoint
CREATE INDEX "mod_cases_expiry_idx" ON "mod_cases" USING btree ("expires_at") WHERE "mod_cases"."ended_at" is null and "mod_cases"."expires_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "security_events_number_uq" ON "security_events" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "security_events_dedupe_uq" ON "security_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "security_events_time_idx" ON "security_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "security_events_user_idx" ON "security_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "security_events_status_idx" ON "security_events" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_key_uq" ON "campaigns" USING btree ("key");--> statement-breakpoint
CREATE INDEX "invite_codes_inviter_idx" ON "invite_codes" USING btree ("inviter_user_id");--> statement-breakpoint
CREATE INDEX "invite_codes_campaign_idx" ON "invite_codes" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "referral_codes_owner_idx" ON "referral_codes" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "referrals_inviter_idx" ON "referrals" USING btree ("inviter_user_id","status");--> statement-breakpoint
CREATE INDEX "referrals_invitee_idx" ON "referrals" USING btree ("invitee_user_id");--> statement-breakpoint
CREATE INDEX "referrals_joined_idx" ON "referrals" USING btree ("joined_at");--> statement-breakpoint
CREATE INDEX "referrals_status_idx" ON "referrals" USING btree ("status","joined_at");--> statement-breakpoint
CREATE INDEX "referrals_campaign_idx" ON "referrals" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_invitee_joined_uq" ON "referrals" USING btree ("invitee_user_id","joined_at");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_live_invitee_uq" ON "referrals" USING btree ("invitee_user_id") WHERE "referrals"."status" in ('joined', 'retained');--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_valid_invitee_uq" ON "referrals" USING btree ("invitee_user_id") WHERE "referrals"."status" = 'valid';--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_code_claim_uq" ON "referrals" USING btree ("invitee_user_id") WHERE "referrals"."referral_code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "member_achievements_active_uq" ON "member_achievements" USING btree ("member_id","achievement_key") WHERE "member_achievements"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "member_achievements_key_idx" ON "member_achievements" USING btree ("achievement_key");--> statement-breakpoint
CREATE INDEX "member_achievements_member_idx" ON "member_achievements" USING btree ("member_id","awarded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contributions_external_ref_uq" ON "contributions" USING btree ("external_ref");--> statement-breakpoint
CREATE INDEX "contributions_member_idx" ON "contributions" USING btree ("member_id","status");--> statement-breakpoint
CREATE INDEX "contributions_project_idx" ON "contributions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_links_project_idx" ON "project_links" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_uq" ON "project_members" USING btree ("project_id","member_id");--> statement-breakpoint
CREATE INDEX "project_members_member_idx" ON "project_members" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_one_owner_uq" ON "project_members" USING btree ("project_id") WHERE "project_members"."role" = 'owner' and "project_members"."left_at" is null;--> statement-breakpoint
CREATE INDEX "project_milestones_project_idx" ON "project_milestones" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slug_uq" ON "projects" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_github_repo_uq" ON "projects" USING btree ("github_repo");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_owner_idx" ON "projects" USING btree ("owner_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_assignments_member_uq" ON "mission_assignments" USING btree ("mission_id","member_id");--> statement-breakpoint
CREATE INDEX "mission_assignments_member_idx" ON "mission_assignments" USING btree ("member_id","status");--> statement-breakpoint
CREATE INDEX "mission_assignments_due_idx" ON "mission_assignments" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "mission_assignments_team_idx" ON "mission_assignments" USING btree ("mission_id","team_key");--> statement-breakpoint
CREATE UNIQUE INDEX "missions_number_uq" ON "missions" USING btree ("number");--> statement-breakpoint
CREATE INDEX "missions_status_idx" ON "missions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "event_rsvps_uq" ON "event_rsvps" USING btree ("event_id","member_id");--> statement-breakpoint
CREATE INDEX "event_rsvps_member_idx" ON "event_rsvps" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "event_rsvps_status_idx" ON "event_rsvps" USING btree ("event_id","status","responded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_team_members_event_member_uq" ON "event_team_members" USING btree ("event_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_teams_name_uq" ON "event_teams" USING btree ("event_id","name");--> statement-breakpoint
CREATE INDEX "events_starts_idx" ON "events" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "events_ends_idx" ON "events" USING btree ("ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_matches_pos_uq" ON "tournament_matches" USING btree ("event_id","round","position");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_uq" ON "notification_deliveries" USING btree ("notification_id","channel");--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries" USING btree ("status","deliver_after");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_action_proposals_status_idx" ON "ai_action_proposals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ai_action_proposals_requester_idx" ON "ai_action_proposals" USING btree ("requested_by_user_id","status");--> statement-breakpoint
CREATE INDEX "ai_action_proposals_expiry_idx" ON "ai_action_proposals" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "ai_requests_user_idx" ON "ai_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_requests_time_idx" ON "ai_requests" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "research_items_doi_uq" ON "research_items" USING btree ("doi");--> statement-breakpoint
CREATE UNIQUE INDEX "research_items_canonical_url_uq" ON "research_items" USING btree ("canonical_url");--> statement-breakpoint
CREATE UNIQUE INDEX "research_items_discord_message_uq" ON "research_items" USING btree ("discord_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_items_arxiv_uq" ON "research_items" USING btree ("arxiv_id");--> statement-breakpoint
CREATE INDEX "research_items_status_idx" ON "research_items" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "research_items_submitter_idx" ON "research_items" USING btree ("submitted_by_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_accounts_member_provider_uq" ON "external_accounts" USING btree ("member_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "external_accounts_username_uq" ON "external_accounts" USING btree ("provider","username");--> statement-breakpoint
CREATE UNIQUE INDEX "external_accounts_external_id_uq" ON "external_accounts" USING btree ("provider","external_id") WHERE "external_accounts"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_slug_uq" ON "integrations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_deliveries_uq" ON "outbound_deliveries" USING btree ("webhook_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_idempotency_uq" ON "webhook_deliveries" USING btree ("integration_id","delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_signature_uq" ON "webhook_deliveries" USING btree ("integration_id","signature_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_github_delivery_uq" ON "webhook_deliveries" USING btree ("provider","delivery_id") WHERE "webhook_deliveries"."provider" = 'github';--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_github_signature_uq" ON "webhook_deliveries" USING btree ("provider","signature_digest") WHERE "webhook_deliveries"."provider" = 'github';--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" USING btree ("status","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_snapshots_uq" ON "analytics_snapshots" USING btree ("day","metric","dimension");--> statement-breakpoint
CREATE INDEX "audit_logs_time_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "domain_events_type_subject_idx" ON "domain_events" USING btree ("type","subject_member_id");--> statement-breakpoint
CREATE INDEX "domain_events_aggregate_idx" ON "domain_events" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "domain_events_time_idx" ON "domain_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "jobs_ready_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_live_uq" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."status" in ('pending', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "game_moves_round_uq" ON "game_moves" USING btree ("session_id","user_id","round");--> statement-breakpoint
CREATE UNIQUE INDEX "game_players_uq" ON "game_players" USING btree ("session_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_players_seat_uq" ON "game_players" USING btree ("session_id","seat");--> statement-breakpoint
CREATE INDEX "game_players_user_idx" ON "game_players" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "game_sessions_status_idx" ON "game_sessions" USING btree ("game_key","status");--> statement-breakpoint
CREATE INDEX "game_sessions_activity_idx" ON "game_sessions" USING btree ("activity_instance_id");--> statement-breakpoint
CREATE INDEX "game_sessions_sweep_idx" ON "game_sessions" USING btree ("status","last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "game_sessions_live_channel_uq" ON "game_sessions" USING btree ("discord_channel_id") WHERE "game_sessions"."status" in ('lobby', 'active') and "game_sessions"."discord_channel_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "game_sessions_live_activity_uq" ON "game_sessions" USING btree ("activity_instance_id") WHERE "game_sessions"."status" in ('lobby', 'active') and "game_sessions"."activity_instance_id" is not null;