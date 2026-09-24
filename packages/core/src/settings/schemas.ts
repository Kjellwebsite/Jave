import { z } from 'zod';
import { ROLE_KEYS } from '../permissions/roles';

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');
const optionalSnowflake = snowflake.optional();
const orgRoleKey = z.enum(ROLE_KEYS as [string, ...string[]]);
const domainPattern = z
  .string()
  .toLowerCase()
  .regex(
    /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/,
    'must be a domain like example.com or *.example.com',
  );

/**
 * Server configuration, one section per concern. Every field has a default so
 * a fresh install works with zero configuration. Secrets never live here —
 * they come from the environment.
 */
export const settingsSchemas = {
  branding: z.object({
    organizationName: z.string().min(1).max(40).default('JAVELIN'),
    botName: z.string().min(1).max(32).default('JAVE'),
    motto: z.string().max(80).default('YOU THINK YOU’RE ELITE? PROVE IT.'),
    /** Embed accent (hex). Kept near-monochrome by design. */
    accentColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default('#B8BDC3'),
  }),
  roles: z.object({
    /** JAVE role → Discord role ID. Unmapped roles exist only inside JAVE. */
    discordRoleIds: z.partialRecord(orgRoleKey, snowflake).default({}),
    /** Role applied during quarantine; must deny access to all channels but one. */
    quarantineRoleId: optionalSnowflake,
    /** Push JAVE role changes to Discord. */
    syncToDiscord: z.boolean().default(true),
  }),
  channels: z.object({
    welcome: optionalSnowflake,
    announcements: optionalSnowflake,
    modLog: optionalSnowflake,
    auditLog: optionalSnowflake,
    securityAlerts: optionalSnowflake,
    applicationsReview: optionalSnowflake,
    tickets: optionalSnowflake,
    ticketArchive: optionalSnowflake,
    trialsCategory: optionalSnowflake,
    events: optionalSnowflake,
    research: optionalSnowflake,
    achievements: optionalSnowflake,
    staffAlerts: optionalSnowflake,
    /** Staff channel for verification queue cards (discord.verification.queue_card). Unset = no cards. */
    verificationQueue: optionalSnowflake,
  }),
  moderation: z.object({
    automodEnabled: z.boolean().default(true),
    spam: z
      .object({
        maxMessages: z.number().int().min(3).max(50).default(7),
        windowSeconds: z.number().int().min(2).max(120).default(10),
        duplicateThreshold: z.number().int().min(2).max(20).default(4),
      })
      .default({ maxMessages: 7, windowSeconds: 10, duplicateThreshold: 4 }),
    maxMentions: z.number().int().min(2).max(50).default(6),
    links: z
      .object({
        mode: z.enum(['off', 'denylist', 'allowlist']).default('denylist'),
        allowlist: z.array(domainPattern).max(200).default([]),
        denylist: z.array(domainPattern).max(500).default([]),
      })
      .default({ mode: 'denylist', allowlist: [], denylist: [] }),
    blockForeignInvites: z.boolean().default(true),
    spamTimeoutSeconds: z.number().int().min(60).max(2_419_200).default(600),
    /** Risk score at or above which automod quarantines instead of timing out. */
    quarantineRiskScore: z.number().int().min(1).max(100).default(85),
    /** Roles exempt from automod. */
    exemptRoles: z.array(orgRoleKey).default(['founder', 'core', 'operations', 'moderator']),
  }),
  security: z.object({
    joinBurstCount: z.number().int().min(3).max(500).default(10),
    joinBurstWindowSeconds: z.number().int().min(10).max(3600).default(60),
    suspiciousAccountAgeDays: z.number().int().min(0).max(365).default(7),
    quarantineSuspiciousJoins: z.boolean().default(false),
    /** Raid mode: new joins are quarantined until staff clears it. */
    raidMode: z.boolean().default(false),
    autoRaidMode: z.boolean().default(true),
  }),
  tickets: z.object({
    enabled: z.boolean().default(true),
    maxOpenPerUser: z.number().int().min(1).max(20).default(3),
    /** Minutes to first staff response, per priority. */
    slaMinutes: z
      .object({
        low: z.number().int().min(5).default(2880),
        normal: z.number().int().min(5).default(1440),
        high: z.number().int().min(5).default(240),
        urgent: z.number().int().min(5).default(60),
      })
      .default({ low: 2880, normal: 1440, high: 240, urgent: 60 }),
    archiveAfterDays: z.number().int().min(1).max(365).default(7),
  }),
  applications: z.object({
    open: z.boolean().default(true),
    /** Role granted on acceptance. */
    acceptedRole: orgRoleKey.default('trial'),
    minReviewsBeforeDecision: z.number().int().min(0).max(10).default(1),
    cooldownDaysAfterRejection: z.number().int().min(0).max(365).default(30),
  }),
  trials: z.object({
    enabled: z.boolean().default(true),
    defaultTeamSize: z.number().int().min(1).max(12).default(3),
    passThreshold: z.number().min(0).max(10).default(6),
    distinctionThreshold: z.number().min(0).max(10).default(8.5),
    teamWeight: z.number().min(0).max(1).default(0.6),
    deadlineWarningsMinutes: z.array(z.number().int().min(1).max(10_080)).max(5).default([60, 10]),
    /** Global kill switch for adversarial roles. */
    adversarialEnabled: z.boolean().default(false),
  }),
  ai: z.object({
    enabled: z.boolean().default(true),
    dailyRequestsPerUser: z.number().int().min(0).max(10_000).default(50),
    maxInputChars: z.number().int().min(200).max(100_000).default(8000),
    proposalTtlMinutes: z.number().int().min(1).max(1440).default(30),
  }),
  integrations: z.object({
    githubAutoContributions: z.boolean().default(true),
    sidusAutoSync: z.boolean().default(false),
  }),
  notifications: z.object({
    dmEnabled: z.boolean().default(true),
    announceAchievements: z.boolean().default(true),
    /** Default quiet hours for users who have not set their own (minutes after midnight UTC). */
    defaultQuietHours: z
      .object({ start: z.number().int().min(0).max(1439), end: z.number().int().min(0).max(1439) })
      .nullable()
      .default(null),
  }),
  analytics: z.object({
    enabled: z.boolean().default(true),
    /** Days a referred member must stay to count as RETAINED. */
    retentionDays: z.number().int().min(1).max(90).default(7),
    /** VALID additionally requires completed onboarding. */
    validRequiresOnboarding: z.boolean().default(true),
    referralAnomalyThreshold: z.number().int().min(1).max(100).default(50),
  }),
} as const;

export type SettingsSection = keyof typeof settingsSchemas;
export type Settings<S extends SettingsSection> = z.infer<(typeof settingsSchemas)[S]>;
export type AllSettings = { [S in SettingsSection]: Settings<S> };

export const SETTINGS_SECTIONS = Object.keys(settingsSchemas) as SettingsSection[];

export function defaultSettings<S extends SettingsSection>(section: S): Settings<S> {
  return settingsSchemas[section].parse({}) as Settings<S>;
}
