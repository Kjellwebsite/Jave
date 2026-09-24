import type { SettingsSection } from '@jave/core';
import { ROLE_KEYS, type RoleKey, roleVisual } from '@jave/ui/roles';
import { formBoolean, formString, formStrings } from './form-data';
import { timeToMinutes } from './time';

/**
 * Declarative form description for every settings section. Values are
 * validated by the core zod schemas on save; this layer only turns form
 * fields into typed values. `settings-form.test.ts` fails when a section
 * gains a field that has no control here.
 */
export type SettingsControl =
  | { kind: 'text'; maxLength: number }
  | { kind: 'color' }
  | { kind: 'integer'; min: number; max?: number; unit?: string }
  | { kind: 'decimal'; min: number; max: number; step: number }
  | { kind: 'boolean' }
  | { kind: 'select'; options: readonly { value: string; label: string }[] }
  | { kind: 'role' }
  | { kind: 'snowflake' }
  | { kind: 'roleSnowflakes' }
  | { kind: 'domains'; maxItems: number }
  | { kind: 'minuteList'; maxItems: number }
  | { kind: 'roles' }
  | { kind: 'quietHours' };

export interface SettingsField {
  /** Dot path inside the section value; also the form field name. */
  path: string;
  label: string;
  description?: string;
  control: SettingsControl;
}

export interface SettingsSectionSpec {
  section: SettingsSection;
  title: string;
  description: string;
  fields: readonly SettingsField[];
}

const channel = (path: string, label: string): SettingsField => ({
  path,
  label,
  control: { kind: 'snowflake' },
});

export const SETTINGS_FORM: readonly SettingsSectionSpec[] = [
  {
    section: 'branding',
    title: 'Branding',
    description: 'Names and accent used in Discord embeds and the dashboard.',
    fields: [
      {
        path: 'organizationName',
        label: 'Organization name',
        control: { kind: 'text', maxLength: 40 },
      },
      { path: 'botName', label: 'Bot name', control: { kind: 'text', maxLength: 32 } },
      { path: 'motto', label: 'Motto', control: { kind: 'text', maxLength: 80 } },
      {
        path: 'accentColor',
        label: 'Accent colour',
        description: 'Hex, e.g. #B8BDC3. Keep it near-monochrome.',
        control: { kind: 'color' },
      },
    ],
  },
  {
    section: 'roles',
    title: 'Roles',
    description: 'How JAVE roles map onto Discord roles. JAVE stays the source of truth.',
    fields: [
      {
        path: 'discordRoleIds',
        label: 'Discord role IDs',
        description: 'Leave blank to keep a role inside JAVE only.',
        control: { kind: 'roleSnowflakes' },
      },
      {
        path: 'quarantineRoleId',
        label: 'Quarantine role ID',
        description: 'Applied during quarantine. Must deny every channel but one.',
        control: { kind: 'snowflake' },
      },
      {
        path: 'syncToDiscord',
        label: 'Sync roles to Discord',
        description: 'Push JAVE role changes to Discord.',
        control: { kind: 'boolean' },
      },
    ],
  },
  {
    section: 'channels',
    title: 'Channels',
    description: 'Discord channel IDs JAVE posts to. Blank disables that output.',
    fields: [
      channel('welcome', 'Welcome'),
      channel('announcements', 'Announcements'),
      channel('modLog', 'Moderation log'),
      channel('auditLog', 'Audit log'),
      channel('securityAlerts', 'Security alerts'),
      channel('applicationsReview', 'Applications review'),
      channel('tickets', 'Tickets'),
      channel('ticketArchive', 'Ticket archive'),
      channel('trialsCategory', 'Trials category'),
      channel('events', 'Events'),
      channel('research', 'Research'),
      channel('achievements', 'Achievements'),
      channel('staffAlerts', 'Staff alerts'),
    ],
  },
  {
    section: 'moderation',
    title: 'Moderation',
    description: 'Automated moderation thresholds.',
    fields: [
      { path: 'automodEnabled', label: 'Automod', control: { kind: 'boolean' } },
      {
        path: 'spam.maxMessages',
        label: 'Spam: max messages',
        control: { kind: 'integer', min: 3, max: 50 },
      },
      {
        path: 'spam.windowSeconds',
        label: 'Spam: window',
        control: { kind: 'integer', min: 2, max: 120, unit: 's' },
      },
      {
        path: 'spam.duplicateThreshold',
        label: 'Spam: duplicate threshold',
        control: { kind: 'integer', min: 2, max: 20 },
      },
      { path: 'maxMentions', label: 'Max mentions', control: { kind: 'integer', min: 2, max: 50 } },
      {
        path: 'links.mode',
        label: 'Link policy',
        control: {
          kind: 'select',
          options: [
            { value: 'off', label: 'Off' },
            { value: 'denylist', label: 'Denylist' },
            { value: 'allowlist', label: 'Allowlist' },
          ],
        },
      },
      {
        path: 'links.allowlist',
        label: 'Allowed domains',
        description: 'One per line. example.com or *.example.com',
        control: { kind: 'domains', maxItems: 200 },
      },
      {
        path: 'links.denylist',
        label: 'Denied domains',
        description: 'One per line.',
        control: { kind: 'domains', maxItems: 500 },
      },
      { path: 'blockForeignInvites', label: 'Block foreign invites', control: { kind: 'boolean' } },
      {
        path: 'spamTimeoutSeconds',
        label: 'Spam timeout',
        control: { kind: 'integer', min: 60, max: 2_419_200, unit: 's' },
      },
      {
        path: 'quarantineRiskScore',
        label: 'Quarantine risk score',
        description: 'At or above this score automod quarantines instead of timing out.',
        control: { kind: 'integer', min: 1, max: 100 },
      },
      {
        path: 'exemptRoles',
        label: 'Exempt roles',
        description: 'Automod ignores these roles.',
        control: { kind: 'roles' },
      },
    ],
  },
  {
    section: 'security',
    title: 'Security',
    description: 'Raid detection and join screening.',
    fields: [
      {
        path: 'joinBurstCount',
        label: 'Join burst: count',
        control: { kind: 'integer', min: 3, max: 500 },
      },
      {
        path: 'joinBurstWindowSeconds',
        label: 'Join burst: window',
        control: { kind: 'integer', min: 10, max: 3600, unit: 's' },
      },
      {
        path: 'suspiciousAccountAgeDays',
        label: 'Suspicious account age',
        control: { kind: 'integer', min: 0, max: 365, unit: 'd' },
      },
      {
        path: 'quarantineSuspiciousJoins',
        label: 'Quarantine suspicious joins',
        control: { kind: 'boolean' },
      },
      {
        path: 'raidMode',
        label: 'Raid mode',
        description: 'New joins are quarantined until staff clears them.',
        control: { kind: 'boolean' },
      },
      { path: 'autoRaidMode', label: 'Automatic raid mode', control: { kind: 'boolean' } },
    ],
  },
  {
    section: 'tickets',
    title: 'Tickets',
    description: 'Support tickets and response targets.',
    fields: [
      { path: 'enabled', label: 'Tickets enabled', control: { kind: 'boolean' } },
      {
        path: 'maxOpenPerUser',
        label: 'Max open per user',
        control: { kind: 'integer', min: 1, max: 20 },
      },
      {
        path: 'slaMinutes.low',
        label: 'First response: low',
        control: { kind: 'integer', min: 5, unit: 'min' },
      },
      {
        path: 'slaMinutes.normal',
        label: 'First response: normal',
        control: { kind: 'integer', min: 5, unit: 'min' },
      },
      {
        path: 'slaMinutes.high',
        label: 'First response: high',
        control: { kind: 'integer', min: 5, unit: 'min' },
      },
      {
        path: 'slaMinutes.urgent',
        label: 'First response: urgent',
        control: { kind: 'integer', min: 5, unit: 'min' },
      },
      {
        path: 'archiveAfterDays',
        label: 'Archive after',
        control: { kind: 'integer', min: 1, max: 365, unit: 'd' },
      },
    ],
  },
  {
    section: 'applications',
    title: 'Applications',
    description: 'Intake and decisions.',
    fields: [
      { path: 'open', label: 'Applications open', control: { kind: 'boolean' } },
      { path: 'acceptedRole', label: 'Role on acceptance', control: { kind: 'role' } },
      {
        path: 'minReviewsBeforeDecision',
        label: 'Reviews before decision',
        control: { kind: 'integer', min: 0, max: 10 },
      },
      {
        path: 'cooldownDaysAfterRejection',
        label: 'Cooldown after rejection',
        control: { kind: 'integer', min: 0, max: 365, unit: 'd' },
      },
    ],
  },
  {
    section: 'trials',
    title: 'Trials',
    description: 'Trial defaults and scoring thresholds.',
    fields: [
      { path: 'enabled', label: 'Trials enabled', control: { kind: 'boolean' } },
      {
        path: 'defaultTeamSize',
        label: 'Default team size',
        control: { kind: 'integer', min: 1, max: 12 },
      },
      {
        path: 'passThreshold',
        label: 'Pass threshold',
        control: { kind: 'decimal', min: 0, max: 10, step: 0.1 },
      },
      {
        path: 'distinctionThreshold',
        label: 'Distinction threshold',
        control: { kind: 'decimal', min: 0, max: 10, step: 0.1 },
      },
      {
        path: 'teamWeight',
        label: 'Team weight',
        description: 'Share of a participant score that comes from the team (0–1).',
        control: { kind: 'decimal', min: 0, max: 1, step: 0.05 },
      },
      {
        path: 'deadlineWarningsMinutes',
        label: 'Deadline warnings',
        description: 'Minutes before a deadline, comma-separated. Up to 5.',
        control: { kind: 'minuteList', maxItems: 5 },
      },
      {
        path: 'adversarialEnabled',
        label: 'Adversarial roles',
        description: 'Global switch for staff-authorized adversarial roles.',
        control: { kind: 'boolean' },
      },
    ],
  },
  {
    section: 'ai',
    title: 'AI',
    description: 'Limits for JAVE AI. AI proposes; humans confirm.',
    fields: [
      { path: 'enabled', label: 'AI enabled', control: { kind: 'boolean' } },
      {
        path: 'dailyRequestsPerUser',
        label: 'Daily requests per user',
        control: { kind: 'integer', min: 0, max: 10_000 },
      },
      {
        path: 'maxInputChars',
        label: 'Max input length',
        control: { kind: 'integer', min: 200, max: 100_000, unit: 'chars' },
      },
      {
        path: 'proposalTtlMinutes',
        label: 'Proposal lifetime',
        control: { kind: 'integer', min: 1, max: 1440, unit: 'min' },
      },
    ],
  },
  {
    section: 'integrations',
    title: 'Integrations',
    description: 'Automatic behaviour of connected services.',
    fields: [
      {
        path: 'githubAutoContributions',
        label: 'GitHub contributions',
        description: 'Record contributions from linked repositories automatically.',
        control: { kind: 'boolean' },
      },
      { path: 'sidusAutoSync', label: 'SIDUS auto-sync', control: { kind: 'boolean' } },
    ],
  },
  {
    section: 'notifications',
    title: 'Notifications',
    description: 'Organization-wide delivery defaults.',
    fields: [
      { path: 'dmEnabled', label: 'Discord DMs', control: { kind: 'boolean' } },
      {
        path: 'announceAchievements',
        label: 'Announce achievements',
        control: { kind: 'boolean' },
      },
      {
        path: 'defaultQuietHours',
        label: 'Default quiet hours',
        description: 'UTC. Applies to members who have not set their own.',
        control: { kind: 'quietHours' },
      },
    ],
  },
  {
    section: 'analytics',
    title: 'Analytics',
    description: 'Referral and retention measurement.',
    fields: [
      { path: 'enabled', label: 'Analytics enabled', control: { kind: 'boolean' } },
      {
        path: 'retentionDays',
        label: 'Retention window',
        control: { kind: 'integer', min: 1, max: 90, unit: 'd' },
      },
      {
        path: 'validRequiresOnboarding',
        label: 'Valid referrals require onboarding',
        control: { kind: 'boolean' },
      },
      {
        path: 'referralAnomalyThreshold',
        label: 'Referral anomaly threshold',
        control: { kind: 'integer', min: 1, max: 100 },
      },
    ],
  },
];

export function settingsSpec(section: string): SettingsSectionSpec | null {
  return SETTINGS_FORM.find((spec) => spec.section === section) ?? null;
}

export const ROLE_OPTIONS: readonly { value: RoleKey; label: string }[] = ROLE_KEYS.map((role) => ({
  value: role,
  label: roleVisual(role).label,
}));

/** Reads a nested value by dot path. */
export function valueAtPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function assignPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cursor = target;
  for (const key of keys.slice(0, -1)) {
    const next = cursor[key];
    if (next === null || typeof next !== 'object') cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys.at(-1)!] = value;
}

export interface ParsedSettingsForm {
  value: Record<string, unknown>;
  /** Field path → message for inputs that could not even be read (e.g. "12x"). */
  errors: Record<string, string>;
}

const LIST_SEPARATOR = /[\s,]+/;

function readNumber(raw: string, integer: boolean): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  if (integer && !Number.isInteger(value)) return null;
  return value;
}

/**
 * Turns a submitted section form into the section value. Unknown fields are
 * ignored; ranges and formats are left to the core schema on save.
 */
export function parseSettingsForm(spec: SettingsSectionSpec, data: FormData): ParsedSettingsForm {
  const value: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of spec.fields) {
    const { path, control } = field;
    switch (control.kind) {
      case 'text':
      case 'color':
      case 'select':
      case 'role':
        assignPath(value, path, formString(data, path).trim());
        break;
      case 'integer':
      case 'decimal': {
        const parsed = readNumber(formString(data, path), control.kind === 'integer');
        if (parsed === null) {
          errors[path] = control.kind === 'integer' ? 'Enter a whole number.' : 'Enter a number.';
        } else {
          assignPath(value, path, parsed);
        }
        break;
      }
      case 'boolean':
        assignPath(value, path, formBoolean(data, path));
        break;
      case 'snowflake': {
        // A blank ID clears the setting. The key is kept (as undefined) because
        // updateSettings merges the patch over the stored section: an omitted
        // key would silently keep the old ID.
        const id = formString(data, path).trim();
        assignPath(value, path, id === '' ? undefined : id);
        break;
      }
      case 'roleSnowflakes': {
        const map: Record<string, string> = {};
        for (const role of ROLE_KEYS) {
          const id = formString(data, `${path}.${role}`).trim();
          if (id !== '') map[role] = id;
        }
        assignPath(value, path, map);
        break;
      }
      case 'domains':
        assignPath(
          value,
          path,
          formString(data, path)
            .split(LIST_SEPARATOR)
            .map((entry) => entry.trim())
            .filter(Boolean),
        );
        break;
      case 'minuteList': {
        const entries = formString(data, path).split(LIST_SEPARATOR).filter(Boolean);
        const minutes = entries.map((entry) => readNumber(entry, true));
        if (minutes.some((entry) => entry === null)) {
          errors[path] = 'Use whole minutes separated by commas.';
        } else {
          assignPath(value, path, minutes);
        }
        break;
      }
      case 'roles': {
        const allowed = new Set<string>(ROLE_KEYS);
        assignPath(
          value,
          path,
          [...new Set(formStrings(data, path))].filter((role) => allowed.has(role)),
        );
        break;
      }
      case 'quietHours': {
        if (!formBoolean(data, `${path}.enabled`)) {
          assignPath(value, path, null);
          break;
        }
        const start = timeToMinutes(formString(data, `${path}.start`));
        const end = timeToMinutes(formString(data, `${path}.end`));
        if (start === null || end === null) {
          errors[path] = 'Use 24-hour times, e.g. 22:00 and 07:00.';
        } else {
          assignPath(value, path, { start, end });
        }
        break;
      }
    }
  }
  return { value, errors };
}
