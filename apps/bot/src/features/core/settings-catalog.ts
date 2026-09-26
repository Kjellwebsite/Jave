import {
  type OrgRole,
  ROLE_KEYS,
  type Settings,
  type SettingsSection,
  ValidationError,
} from '@jave/core';
import type { DiscordPermission } from '../../discord/gateway';

/**
 * What the Discord surface knows about settings: which channel outputs exist
 * and what the bot needs in each, and which boolean flags may be switched
 * from Discord. Values are always validated and written by core
 * (`updateSettings`); this file only describes them.
 */

export type ChannelKey = keyof Settings<'channels'>;

export interface ChannelSpec {
  key: ChannelKey;
  label: string;
  purpose: string;
  kind: 'text' | 'category';
  /** Permissions the bot needs inside this channel. */
  needs: readonly DiscordPermission[];
  /** Readiness warns when a recommended channel is unset. */
  recommended: boolean;
}

const POSTING: readonly DiscordPermission[] = [
  'ViewChannel',
  'SendMessages',
  'EmbedLinks',
  'ReadMessageHistory',
];

const CHANNEL_SPECS: Record<ChannelKey, Omit<ChannelSpec, 'key'>> = {
  welcome: {
    label: 'Welcome',
    purpose: 'Greets new members with the onboarding button.',
    kind: 'text',
    needs: POSTING,
    recommended: true,
  },
  announcements: {
    label: 'Announcements',
    purpose: 'Trial and mission announcements.',
    kind: 'text',
    needs: POSTING,
    recommended: true,
  },
  applicationsReview: {
    label: 'Applications review',
    purpose: 'Staff review cards for applications.',
    kind: 'text',
    needs: POSTING,
    recommended: true,
  },
  verificationQueue: {
    label: 'Verification queue',
    purpose: 'Staff cards for verification requests.',
    kind: 'text',
    needs: POSTING,
    recommended: true,
  },
  tickets: {
    label: 'Tickets',
    purpose: 'Parent channel of private ticket threads.',
    kind: 'text',
    needs: [...POSTING, 'CreatePrivateThreads', 'SendMessagesInThreads', 'ManageThreads'],
    recommended: true,
  },
  ticketArchive: {
    label: 'Ticket archive',
    purpose: 'Transcripts of closed tickets.',
    kind: 'text',
    needs: [...POSTING, 'AttachFiles'],
    recommended: false,
  },
  trialsCategory: {
    label: 'Trials category',
    purpose: 'Category for private trial team channels.',
    kind: 'category',
    needs: ['ViewChannel', 'ManageChannels'],
    recommended: true,
  },
  securityAlerts: {
    label: 'Security alerts',
    purpose: 'Security event cards and raid notices.',
    kind: 'text',
    needs: POSTING,
    recommended: true,
  },
  staffAlerts: {
    label: 'Staff alerts',
    purpose: 'Raid notices when no security channel is set.',
    kind: 'text',
    needs: POSTING,
    recommended: false,
  },
  missions: {
    label: 'Missions',
    purpose: 'Mission cards. Falls back to announcements.',
    kind: 'text',
    needs: POSTING,
    recommended: false,
  },
  events: {
    label: 'Events',
    purpose: 'Event announcements.',
    kind: 'text',
    needs: POSTING,
    recommended: false,
  },
  achievements: {
    label: 'Achievements',
    purpose: 'Public achievement announcements.',
    kind: 'text',
    needs: POSTING,
    recommended: false,
  },
  research: {
    label: 'Research',
    purpose: 'Research digests.',
    kind: 'text',
    needs: POSTING,
    recommended: false,
  },
  modLog: {
    label: 'Moderation log',
    purpose: 'Moderation case log.',
    kind: 'text',
    needs: POSTING,
    recommended: false,
  },
  auditLog: {
    label: 'Audit log',
    purpose: 'Audit feed.',
    kind: 'text',
    needs: POSTING,
    recommended: false,
  },
};

/** Every channel output, recommended ones first. */
export const CHANNELS: readonly ChannelSpec[] = (
  Object.entries(CHANNEL_SPECS) as [ChannelKey, Omit<ChannelSpec, 'key'>][]
).map(([key, spec]) => ({ key, ...spec }));

export function channelSpec(key: string): ChannelSpec {
  const spec = CHANNELS.find((c) => c.key === key);
  if (!spec) throw new ValidationError('Unknown channel setting.');
  return spec;
}

/** Role mapping targets: every JAVE role plus the quarantine role. */
export const QUARANTINE_TARGET = 'quarantine';
export type RoleTarget = OrgRole | typeof QUARANTINE_TARGET;

export const ROLE_TARGETS: readonly RoleTarget[] = [...ROLE_KEYS, QUARANTINE_TARGET];

export function parseRoleTarget(value: string): RoleTarget {
  if (value === QUARANTINE_TARGET) return QUARANTINE_TARGET;
  if ((ROLE_KEYS as string[]).includes(value)) return value as OrgRole;
  throw new ValidationError('Unknown role.');
}

export function roleTargetLabel(target: RoleTarget): string {
  return target === QUARANTINE_TARGET ? 'QUARANTINE' : target.toUpperCase();
}

type BooleanKeys<T> = { [K in keyof T]-?: T[K] extends boolean ? K : never }[keyof T];

/** A boolean setting reachable from Discord. */
export type FlagSpec = {
  [S in SettingsSection]: {
    key: `${S}.${BooleanKeys<Settings<S>> & string}`;
    section: S;
    field: BooleanKeys<Settings<S>> & string;
    label: string;
    /** Consequence shown on the confirmation step. */
    consequence: string;
    /** Sensitive flags ask for confirmation before either change. */
    sensitive: boolean;
  };
}[SettingsSection];

/**
 * Flags switchable with /settings toggle. Raid mode is deliberately absent:
 * it runs through moderation's setRaidMode (reason, alerts, lockdown job).
 * Development-only switches stay in the dashboard.
 */
export const FLAGS: readonly FlagSpec[] = [
  {
    key: 'applications.open',
    section: 'applications',
    field: 'open',
    label: 'Applications open',
    consequence: 'Members can submit new applications.',
    sensitive: false,
  },
  {
    key: 'trials.enabled',
    section: 'trials',
    field: 'enabled',
    label: 'Trials',
    consequence: 'Trials can be scheduled and run.',
    sensitive: false,
  },
  {
    key: 'trials.adversarialEnabled',
    section: 'trials',
    field: 'adversarialEnabled',
    label: 'Adversarial roles',
    consequence: 'Staff can plan covert adversarial roles inside trials. Global kill switch.',
    sensitive: true,
  },
  {
    key: 'trials.createTeamRoles',
    section: 'trials',
    field: 'createTeamRoles',
    label: 'Trial team roles',
    consequence: 'Each trial team also gets a Discord role (needs Manage Roles).',
    sensitive: false,
  },
  {
    key: 'tickets.enabled',
    section: 'tickets',
    field: 'enabled',
    label: 'Tickets',
    consequence: 'Members can open support tickets.',
    sensitive: false,
  },
  {
    key: 'ai.enabled',
    section: 'ai',
    field: 'enabled',
    label: 'JAVE AI',
    consequence: 'AI features answer requests within the daily limits.',
    sensitive: false,
  },
  {
    key: 'moderation.automodEnabled',
    section: 'moderation',
    field: 'automodEnabled',
    label: 'Automod',
    consequence: 'Spam, mention and link filters act on messages automatically.',
    sensitive: true,
  },
  {
    key: 'moderation.blockForeignInvites',
    section: 'moderation',
    field: 'blockForeignInvites',
    label: 'Block foreign invites',
    consequence: 'Invites to other servers are removed by automod.',
    sensitive: false,
  },
  {
    key: 'security.autoRaidMode',
    section: 'security',
    field: 'autoRaidMode',
    label: 'Automatic raid mode',
    consequence: 'A join burst switches raid mode on without staff.',
    sensitive: true,
  },
  {
    key: 'security.quarantineSuspiciousJoins',
    section: 'security',
    field: 'quarantineSuspiciousJoins',
    label: 'Quarantine suspicious joins',
    consequence: 'Very new accounts are quarantined on join.',
    sensitive: true,
  },
  {
    key: 'roles.syncToDiscord',
    section: 'roles',
    field: 'syncToDiscord',
    label: 'Role sync',
    consequence: 'JAVE role changes are pushed to Discord roles.',
    sensitive: true,
  },
  {
    key: 'notifications.dmEnabled',
    section: 'notifications',
    field: 'dmEnabled',
    label: 'Notification DMs',
    consequence: 'Notifications are also delivered as Discord DMs.',
    sensitive: false,
  },
  {
    key: 'notifications.announceAchievements',
    section: 'notifications',
    field: 'announceAchievements',
    label: 'Announce achievements',
    consequence: 'Achievements are announced in the achievements channel.',
    sensitive: false,
  },
  {
    key: 'analytics.enabled',
    section: 'analytics',
    field: 'enabled',
    label: 'Analytics',
    consequence: 'Organizational analytics are computed.',
    sensitive: false,
  },
  {
    key: 'integrations.githubAutoContributions',
    section: 'integrations',
    field: 'githubAutoContributions',
    label: 'GitHub contributions',
    consequence: 'Linked GitHub activity is recorded as contributions.',
    sensitive: false,
  },
  {
    key: 'integrations.sidusAutoSync',
    section: 'integrations',
    field: 'sidusAutoSync',
    label: 'Sidus sync',
    consequence: 'Research items sync from Sidus automatically.',
    sensitive: false,
  },
];

export function flagSpec(key: string): FlagSpec {
  const spec = FLAGS.find((f) => f.key === key);
  if (!spec) throw new ValidationError('Unknown setting.');
  return spec;
}
