import { ROLE_KEYS, type Settings } from '@jave/core';
import type {
  BotMemberSnapshot,
  ChannelAccessSnapshot,
  DiscordPermission,
  RoleSnapshot,
} from '../../discord/gateway';
import { REQUIRED_PERMISSIONS } from '../../discord/permissions';
import {
  acceptsChannel,
  CHANNELS,
  type ChannelKey,
  describeKinds,
  elevatedPermissions,
  mayCarryElevated,
  permissionLabel,
  QUARANTINE_TARGET,
  roleHolders,
  type RoleTarget,
  roleTargetLabel,
} from './settings-catalog';

/**
 * Pure readiness evaluation for /jave setup: given what Discord reports and
 * the current settings, list what works, what is broken and how to fix it.
 * No I/O here — readiness-probe.ts gathers the input.
 */

export type CheckState = 'ok' | 'warn' | 'fail' | 'off';

export interface CheckItem {
  state: CheckState;
  text: string;
  /** How to fix it, when there is something to fix. */
  fix?: string;
}

export type SectionKey = 'permissions' | 'hierarchy' | 'mapping' | 'channels';

export interface ReadinessSection {
  key: SectionKey;
  title: string;
  items: CheckItem[];
}

export interface ReadinessReport {
  sections: ReadinessSection[];
  failures: number;
  warnings: number;
}

export interface ReadinessInput {
  bot: BotMemberSnapshot;
  roles: readonly RoleSnapshot[];
  roleSettings: Settings<'roles'>;
  channelSettings: Settings<'channels'>;
  /** Probe result per configured channel id (null: not in the guild). */
  channels: ReadonlyMap<string, ChannelAccessSnapshot | null>;
}

export const REQUIRED_PERMISSION_NAMES = Object.keys(REQUIRED_PERMISSIONS) as DiscordPermission[];

function permissionsSection(bot: BotMemberSnapshot): ReadinessSection {
  const items: CheckItem[] = [];
  const missing = REQUIRED_PERMISSION_NAMES.filter((p) => !bot.permissions.includes(p));
  for (const permission of missing) {
    items.push({
      state: 'fail',
      text: `${permissionLabel(permission)} missing — ${REQUIRED_PERMISSIONS[permission as keyof typeof REQUIRED_PERMISSIONS]}`,
      fix: 'Grant it to the JAVE role in Server Settings → Roles.',
    });
  }
  if (missing.length === 0) {
    items.push({
      state: 'ok',
      text: `All ${REQUIRED_PERMISSION_NAMES.length} required server permissions granted.`,
    });
  }
  if (bot.administrator) {
    items.push({
      state: 'warn',
      text: 'Administrator granted. JAVE needs only the permissions it lists.',
      fix: 'Remove Administrator from the JAVE role (least privilege).',
    });
  }
  return { key: 'permissions', title: 'Server permissions', items };
}

interface MappedRole {
  target: RoleTarget;
  label: string;
  id: string;
}

function mappedRoles(settings: Settings<'roles'>): MappedRole[] {
  const mapped: MappedRole[] = ROLE_KEYS.flatMap((role) => {
    const id = settings.discordRoleIds[role];
    return id ? [{ target: role, label: roleTargetLabel(role), id }] : [];
  });
  if (settings.quarantineRoleId) {
    mapped.push({
      target: QUARANTINE_TARGET,
      label: roleTargetLabel(QUARANTINE_TARGET),
      id: settings.quarantineRoleId,
    });
  }
  return mapped;
}

function hierarchySection(input: ReadinessInput): ReadinessSection {
  const byId = new Map(input.roles.map((r) => [r.id, r]));
  const mapped = mappedRoles(input.roleSettings).filter((m) => byId.has(m.id));
  const items: CheckItem[] = [];
  for (const { label, id } of mapped) {
    const role = byId.get(id)!;
    if (role.position >= input.bot.highestRolePosition) {
      items.push({
        state: 'fail',
        text: `<@&${id}> (${label}) sits at or above JAVE's highest role.`,
        fix: "Drag JAVE's role above it in Server Settings → Roles.",
      });
    }
  }
  if (mapped.length === 0) {
    items.push({ state: 'off', text: 'No Discord roles mapped yet.' });
  } else if (items.length === 0) {
    items.push({
      state: 'ok',
      text: `JAVE's role sits above all ${mapped.length} managed roles.`,
    });
  }
  return { key: 'hierarchy', title: 'Role hierarchy', items };
}

function roleProblem(target: RoleTarget, role: RoleSnapshot | undefined): string | null {
  if (!role) return 'no longer exists';
  if (role.everyone) return 'is @everyone';
  if (role.managed) return 'is managed by an integration; Discord will not let JAVE assign it';
  const elevated = elevatedPermissions(role);
  if (elevated.length > 0 && !mayCarryElevated(target)) {
    return `grants ${elevated.map(permissionLabel).join(', ')} to ${roleHolders(target)}`;
  }
  return null;
}

function mappingSection(input: ReadinessInput): ReadinessSection {
  const { roleSettings } = input;
  const byId = new Map(input.roles.map((r) => [r.id, r]));
  const items: CheckItem[] = [];
  if (!roleSettings.syncToDiscord) {
    items.push({
      state: 'warn',
      text: 'Role sync is off. JAVE roles stay inside JAVE.',
      fix: '/settings toggle → Role sync.',
    });
  }
  for (const { target, label, id } of mappedRoles(roleSettings)) {
    const problem = roleProblem(target, byId.get(id));
    if (problem) {
      items.push({
        state: 'fail',
        text: `${label} → role \`${id}\` ${problem}.`,
        fix: `/settings role → ${label}.`,
      });
    }
  }
  const unmapped = ROLE_KEYS.filter((role) => !roleSettings.discordRoleIds[role]);
  const mappedCount = ROLE_KEYS.length - unmapped.length;
  if (mappedCount === 0) {
    items.push({
      state: 'warn',
      text: 'No JAVE role is mapped to a Discord role.',
      fix: '/settings role.',
    });
  } else {
    items.push({ state: 'ok', text: `${mappedCount} of ${ROLE_KEYS.length} JAVE roles mapped.` });
    if (unmapped.length > 0) {
      items.push({
        state: 'off',
        text: `Inside JAVE only: ${unmapped.map((r) => r.toUpperCase()).join(', ')}.`,
      });
    }
  }
  if (!roleSettings.quarantineRoleId) {
    items.push({
      state: 'warn',
      text: 'No quarantine role. Quarantine falls back to a Discord timeout (28 days at most).',
      fix: '/settings role → QUARANTINE.',
    });
  }
  return { key: 'mapping', title: 'Role mapping', items };
}

function channelItem(
  key: ChannelKey,
  id: string,
  probe: ChannelAccessSnapshot | null | undefined,
): CheckItem {
  const spec = CHANNELS.find((c) => c.key === key)!;
  const fix = `/settings channel → ${spec.label}.`;
  if (!probe) return { state: 'fail', text: `${spec.label} — channel no longer exists.`, fix };
  if (!probe.visible) {
    return {
      state: 'fail',
      text: `${spec.label} — JAVE cannot see <#${id}>.`,
      fix: 'Allow View Channel for the JAVE role there.',
    };
  }
  if (!acceptsChannel(spec, probe.kind)) {
    return {
      state: 'fail',
      text: `${spec.label} — <#${id}> must be ${describeKinds(spec.accepts)}.`,
      fix,
    };
  }
  const missing = spec.needs.filter((p) => !probe.permissions.includes(p));
  if (missing.length > 0) {
    return {
      state: 'fail',
      text: `${spec.label} — <#${id}> missing ${missing.map(permissionLabel).join(', ')}.`,
      fix: 'Adjust the channel permissions for the JAVE role.',
    };
  }
  return { state: 'ok', text: `${spec.label} — <#${id}>` };
}

function channelsSection(input: ReadinessInput): ReadinessSection {
  const items: CheckItem[] = [];
  const unsetRecommended: string[] = [];
  const unsetOptional: string[] = [];
  for (const spec of CHANNELS) {
    const id = input.channelSettings[spec.key];
    if (!id) {
      (spec.recommended ? unsetRecommended : unsetOptional).push(spec.label);
      continue;
    }
    items.push(channelItem(spec.key, id, input.channels.get(id)));
  }
  if (unsetRecommended.length > 0) {
    items.push({
      state: 'warn',
      text: `Not set: ${unsetRecommended.join(', ')}.`,
      fix: '/settings channel.',
    });
  }
  if (unsetOptional.length > 0) {
    items.push({ state: 'off', text: `Optional, not set: ${unsetOptional.join(', ')}.` });
  }
  return { key: 'channels', title: 'Channels', items };
}

export function evaluateReadiness(input: ReadinessInput): ReadinessReport {
  const sections = [
    permissionsSection(input.bot),
    hierarchySection(input),
    mappingSection(input),
    channelsSection(input),
  ];
  const count = (state: CheckState) =>
    sections.reduce((n, s) => n + s.items.filter((i) => i.state === state).length, 0);
  return { sections, failures: count('fail'), warnings: count('warn') };
}

/** The channel ids a readiness check has to probe. */
export function configuredChannelIds(channels: Settings<'channels'>): string[] {
  return [...new Set(CHANNELS.map((c) => channels[c.key]).filter((id): id is string => !!id))];
}
