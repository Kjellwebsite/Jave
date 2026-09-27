import {
  isStaffRole,
  type OrgRole,
  ROLE_KEYS,
  type Settings,
  type SettingsSection,
  ValidationError,
} from '@jave/core';
import type {
  ChannelAccessSnapshot,
  ChannelKind,
  DiscordPermission,
  RoleSnapshot,
} from '../../discord/gateway';

/**
 * What the Discord surface knows about settings: which channel outputs exist
 * and what the bot needs in each, and which boolean flags may be switched
 * from Discord. Values are always validated and written by core
 * (`updateSettings`); this file only describes them.
 */

export type ChannelKey = keyof Settings<'channels'>;

/** Channel kinds an output can live in. */
export type OutputChannelKind = Extract<ChannelKind, 'text' | 'announcement' | 'category'>;

export interface ChannelSpec {
  key: ChannelKey;
  label: string;
  purpose: string;
  /** Channel kinds that can hold this output. */
  accepts: readonly OutputChannelKind[];
  /** Permissions the bot needs inside this channel. */
  needs: readonly DiscordPermission[];
  /** Readiness warns when a recommended channel is unset. */
  recommended: boolean;
  /**
   * Carries staff-only data (applicant answers, moderation reasons, private
   * transcripts…): refused, and failed by readiness, in a channel members can read.
   */
  staffOnly: boolean;
}

const POSTABLE: readonly OutputChannelKind[] = ['text', 'announcement'];
/** Discord creates private threads only in plain text channels. */
const THREAD_PARENT: readonly OutputChannelKind[] = ['text'];
const CATEGORY: readonly OutputChannelKind[] = ['category'];

/** 'SendMessagesInThreads' → 'Send Messages In Threads'. */
export function permissionLabel(permission: DiscordPermission): string {
  return permission.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** True when a channel of this kind can hold the output. */
export function acceptsChannel(spec: Pick<ChannelSpec, 'accepts'>, kind: ChannelKind): boolean {
  return spec.accepts.some((accepted) => accepted === kind);
}

/** 'a text channel', 'a text or announcement channel', 'a category'. */
export function describeKinds(accepts: readonly OutputChannelKind[]): string {
  if (accepts.includes('category')) return 'a category';
  return accepts.includes('announcement') ? 'a text or announcement channel' : 'a text channel';
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
    accepts: POSTABLE,
    needs: POSTING,
    recommended: true,
    staffOnly: false,
  },
  announcements: {
    label: 'Announcements',
    purpose: 'Trial and mission announcements.',
    accepts: POSTABLE,
    needs: POSTING,
    recommended: true,
    staffOnly: false,
  },
  applicationsReview: {
    label: 'Applications review',
    purpose: 'Staff review cards for applications.',
    accepts: POSTABLE,
    needs: POSTING,
    recommended: true,
    staffOnly: true,
  },
  verificationQueue: {
    label: 'Verification queue',
    purpose: 'Staff cards for verification requests.',
    accepts: POSTABLE,
    needs: POSTING,
    recommended: true,
    staffOnly: true,
  },
  tickets: {
    label: 'Tickets',
    purpose: 'Parent channel of private ticket threads.',
    accepts: THREAD_PARENT,
    // Cards live inside the threads: the parent itself can stay closed to posting.
    needs: [
      'ViewChannel',
      'EmbedLinks',
      'ReadMessageHistory',
      'CreatePrivateThreads',
      'SendMessagesInThreads',
      'ManageThreads',
    ],
    recommended: true,
    staffOnly: false,
  },
  ticketArchive: {
    label: 'Ticket archive',
    purpose: 'Transcripts of closed tickets.',
    accepts: POSTABLE,
    needs: [...POSTING, 'AttachFiles'],
    recommended: false,
    staffOnly: true,
  },
  trialsCategory: {
    label: 'Trials category',
    purpose: 'Category for private trial team channels.',
    accepts: CATEGORY,
    needs: ['ViewChannel', 'ManageChannels'],
    recommended: true,
    staffOnly: false,
  },
  securityAlerts: {
    label: 'Security alerts',
    purpose: 'Security event cards and raid notices.',
    accepts: POSTABLE,
    needs: POSTING,
    recommended: true,
    staffOnly: true,
  },
  staffAlerts: {
    label: 'Staff alerts',
    purpose: 'Raid notices when no security channel is set.',
    accepts: POSTABLE,
    needs: POSTING,
    recommended: false,
    staffOnly: true,
  },
  missions: {
    label: 'Missions',
    purpose: 'Mission cards. Falls back to announcements.',
    accepts: POSTABLE,
    needs: POSTING,
    recommended: false,
    staffOnly: false,
  },
  events: {
    label: 'Events',
    purpose: 'Event announcements.',
    accepts: POSTABLE,
    needs: POSTING,
    recommended: false,
    staffOnly: false,
  },
  achievements: {
    label: 'Achievements',
    purpose: 'Public achievement announcements.',
    accepts: POSTABLE,
    needs: POSTING,
    recommended: false,
    staffOnly: false,
  },
  research: {
    label: 'Research',
    purpose: 'Research digests.',
    accepts: POSTABLE,
    needs: POSTING,
    recommended: false,
    staffOnly: false,
  },
  modLog: {
    label: 'Moderation log',
    purpose: 'Moderation case log.',
    accepts: POSTABLE,
    needs: POSTING,
    recommended: false,
    staffOnly: true,
  },
  auditLog: {
    label: 'Audit log',
    purpose: 'Audit feed.',
    accepts: POSTABLE,
    needs: POSTING,
    recommended: false,
    staffOnly: true,
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

/**
 * Discord roles held by non-staff members: the roles mapped to non-staff JAVE
 * roles. A staff-only channel must stay closed to them and to @everyone.
 */
export function audienceRoleIds(roles: Settings<'roles'>): string[] {
  const ids = ROLE_KEYS.filter((role) => !isStaffRole(role)).map((r) => roles.discordRoleIds[r]);
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/**
 * Who beyond staff can read a channel, for a staff-only output: "@everyone",
 * "<@&role>, <@&role>", or null when only staff can.
 */
export function channelExposure(
  spec: Pick<ChannelSpec, 'staffOnly'>,
  probe: Pick<ChannelAccessSnapshot, 'everyoneCanView' | 'audienceWithView'>,
): string | null {
  if (!spec.staffOnly) return null;
  if (probe.everyoneCanView) return '@everyone';
  if (probe.audienceWithView.length === 0) return null;
  return probe.audienceWithView.map((id) => `<@&${id}>`).join(', ');
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

/**
 * Discord's elevated permissions (the ones it gates behind two-factor
 * authentication for moderators). A role carrying one hands real power over
 * the server to everyone who holds it.
 */
export const ELEVATED_PERMISSIONS: readonly DiscordPermission[] = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageWebhooks',
  'ManageMessages',
  'ManageThreads',
  'ManageGuildExpressions',
  'KickMembers',
  'BanMembers',
  'ModerateMembers',
];

/** The elevated permissions a role grants (Administrator alone stands for all of them). */
export function elevatedPermissions(role: Pick<RoleSnapshot, 'permissions'>): DiscordPermission[] {
  if (role.permissions.includes('Administrator')) return ['Administrator'];
  return ELEVATED_PERMISSIONS.filter((permission) => role.permissions.includes(permission));
}

/**
 * Only staff roles may follow a Discord role with elevated permissions. JAVE
 * hands a mapped role to every holder of the JAVE role, so an elevated role
 * behind VERIFIED or MEMBER (or quarantine) would be privilege escalation.
 */
export function mayCarryElevated(target: RoleTarget): boolean {
  return target !== QUARANTINE_TARGET && isStaffRole(target);
}

/** Who would hold a mapped Discord role: "everyone holding VERIFIED", "every quarantined member". */
export function roleHolders(target: RoleTarget): string {
  return target === QUARANTINE_TARGET
    ? 'every quarantined member'
    : `everyone holding ${roleTargetLabel(target)}`;
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
