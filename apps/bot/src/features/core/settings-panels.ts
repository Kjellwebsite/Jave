import type { APIEmbed } from 'discord.js';
import { type AllSettings, ROLE_KEYS } from '@jave/core';
import type { ReplyPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { button, field, panel, row, stringSelect } from '../../ui/components';
import { userText } from '../../ui/format';
import { GLYPH } from '../../ui/theme';
import {
  CHANNELS,
  type ChannelSpec,
  describeKinds,
  FLAGS,
  type FlagSpec,
  permissionLabel,
  QUARANTINE_TARGET,
  ROLE_TARGETS,
  type RoleTarget,
  roleTargetLabel,
} from './settings-catalog';
import { channelSelect, fitLines, roleSelect, SETTINGS_NS, SETUP_NS } from './settings-ui';

/** Select option descriptions are capped by Discord at 100 characters. */
const OPTION_DESCRIPTION_MAX = 100;

const onOff = (value: boolean) => (value ? 'ON' : 'OFF');
/** 1 → "1 review", 2 → "2 reviews". */
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
/** 'a text channel' → 'A text channel'. */
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const channelRef = (id: string | undefined) => (id ? `<#${id}>` : GLYPH.unknown);
const roleRef = (id: string | undefined) => (id ? `<@&${id}>` : GLYPH.unknown);

export function flagValue(settings: AllSettings, flag: FlagSpec): boolean {
  const section = settings[flag.section] as Record<string, unknown>;
  return section[flag.field] === true;
}

/** Separates a flag key from its target state in a flag select option value. */
const FLAG_CHOICE_SEPARATOR = ':';

/** A flag select option value: the flag and the state it switches to ('applications.open:off'). */
export function flagChoice(flag: FlagSpec, next: boolean): string {
  return `${flag.key}${FLAG_CHOICE_SEPARATOR}${onOff(next).toLowerCase()}`;
}

/** Null for a value without a target state (a flags panel from before the state was carried). */
export function parseFlagChoice(value: string): { key: string; next: boolean } | null {
  const at = value.lastIndexOf(FLAG_CHOICE_SEPARATOR);
  if (at < 0) return null;
  const state = value.slice(at + 1);
  if (state !== 'on' && state !== 'off') return null;
  return { key: value.slice(0, at), next: state === 'on' };
}

export function roleTargetValue(settings: AllSettings, target: RoleTarget): string | undefined {
  return target === QUARANTINE_TARGET
    ? settings.roles.quarantineRoleId
    : settings.roles.discordRoleIds[target];
}

const backRow = (to: string, label = 'Back') =>
  row(
    button(label, customId(SETTINGS_NS, 'panel', to)),
    button('Readiness', customId(SETUP_NS, 'recheck')),
  );

/** The /settings view summary. Management buttons only for those who can use them. */
export function renderSummary(settings: AllSettings, canManage: boolean): ReplyPayload {
  const mappedChannels = CHANNELS.filter((c) => settings.channels[c.key]).length;
  const mappedRoles = ROLE_KEYS.filter((r) => settings.roles.discordRoleIds[r]).length;
  const { applications, trials, tickets, moderation, security, ai, notifications } = settings;
  const fields = [
    field(
      'Organization',
      `${userText(settings.branding.organizationName, 40)} ${GLYPH.dot} ${userText(settings.branding.botName, 32)}`,
    ),
    field('Channels', `${mappedChannels} of ${CHANNELS.length} outputs set`, true),
    field(
      'Roles',
      [
        `${mappedRoles} of ${ROLE_KEYS.length} mapped`,
        `Sync ${onOff(settings.roles.syncToDiscord)}`,
        `Quarantine ${roleRef(settings.roles.quarantineRoleId)}`,
      ].join('\n'),
      true,
    ),
    field(
      'Applications',
      [
        applications.open ? 'OPEN' : 'CLOSED',
        `${plural(applications.minReviewsBeforeDecision, 'review')} before a decision`,
        `${applications.cooldownDaysAfterRejection}d cooldown after rejection`,
      ].join('\n'),
      true,
    ),
    field(
      'Trials',
      [
        trials.enabled ? 'ENABLED' : 'DISABLED',
        `Pass ${trials.passThreshold} ${GLYPH.dot} distinction ${trials.distinctionThreshold}`,
        `Adversarial roles ${onOff(trials.adversarialEnabled)}`,
      ].join('\n'),
      true,
    ),
    field(
      'Tickets',
      [tickets.enabled ? 'ENABLED' : 'DISABLED', `${tickets.maxOpenPerUser} open per member`].join(
        '\n',
      ),
      true,
    ),
    field(
      'Safety',
      [
        `Automod ${onOff(moderation.automodEnabled)} ${GLYPH.dot} links ${moderation.links.mode}`,
        `Raid mode ${onOff(security.raidMode)} ${GLYPH.dot} automatic ${onOff(security.autoRaidMode)}`,
      ].join('\n'),
      true,
    ),
    field(
      'AI',
      [ai.enabled ? 'ENABLED' : 'DISABLED', `${ai.dailyRequestsPerUser} requests per day`].join(
        '\n',
      ),
      true,
    ),
    field(
      'Notifications',
      [
        `DMs ${onOff(notifications.dmEnabled)}`,
        `Achievements announced ${onOff(notifications.announceAchievements)}`,
      ].join('\n'),
      true,
    ),
  ];
  return {
    embeds: [
      panel({
        kicker: 'JAVE SETTINGS',
        title: 'Summary',
        description: canManage
          ? 'Change outputs, role mappings and flags below. Every change is validated and audited.'
          : 'Read-only. Changing settings needs a settings manager.',
        fields,
      }),
    ],
    components: canManage
      ? [
          row(
            button('Channels', customId(SETTINGS_NS, 'panel', 'channels')),
            button('Roles', customId(SETTINGS_NS, 'panel', 'roles')),
            button('Flags', customId(SETTINGS_NS, 'panel', 'flags')),
            button('Readiness', customId(SETUP_NS, 'recheck'), 'primary'),
          ),
        ]
      : [],
  };
}

export function renderChannels(settings: AllSettings, notice?: APIEmbed): ReplyPayload {
  const lines = CHANNELS.map((c) => `\`${c.label}\` ${channelRef(settings.channels[c.key])}`);
  return {
    embeds: [
      ...(notice ? [notice] : []),
      panel({
        kicker: 'JAVE SETTINGS',
        title: 'Channels',
        description: 'Where JAVE posts. Pick an output to change it.',
        fields: [field('Outputs', fitLines(lines))],
      }),
    ],
    components: [
      row(
        stringSelect(
          customId(SETTINGS_NS, 'channel'),
          'Choose an output',
          CHANNELS.map((c) => ({
            label: c.label,
            value: c.key,
            description: c.purpose.slice(0, OPTION_DESCRIPTION_MAX),
          })),
        ),
      ),
      backRow('summary'),
    ],
  };
}

export function renderChannelEditor(
  settings: AllSettings,
  spec: ChannelSpec,
  notice?: APIEmbed,
): ReplyPayload {
  const current = settings.channels[spec.key];
  return {
    embeds: [
      ...(notice ? [notice] : []),
      panel({
        kicker: 'JAVE SETTINGS · CHANNEL',
        title: spec.label,
        description: spec.purpose,
        fields: [
          field('Current', channelRef(current), true),
          field('Accepts', capitalize(describeKinds(spec.accepts)), true),
          field('JAVE needs', spec.needs.map(permissionLabel).join(', ')),
        ],
      }),
    ],
    components: [
      row(
        channelSelect(
          customId(SETTINGS_NS, 'chset', spec.key),
          `Choose ${describeKinds(spec.accepts)}`,
          { accepts: spec.accepts, current },
        ),
      ),
      row(
        button('Clear', customId(SETTINGS_NS, 'chclear', spec.key), 'danger', !current),
        button('Back', customId(SETTINGS_NS, 'panel', 'channels')),
      ),
    ],
  };
}

/**
 * The role mapping panel. `canMap` limits the picker to the targets the
 * viewer may change (staff mappings are founder-only); core enforces it too.
 */
export function renderRoles(
  settings: AllSettings,
  canMap: (target: RoleTarget) => boolean,
  notice?: APIEmbed,
): ReplyPayload {
  const lines = ROLE_TARGETS.map(
    (t) => `\`${roleTargetLabel(t)}\` ${roleRef(roleTargetValue(settings, t))}`,
  );
  const mappable = ROLE_TARGETS.filter(canMap);
  return {
    embeds: [
      ...(notice ? [notice] : []),
      panel({
        kicker: 'JAVE SETTINGS',
        title: 'Roles',
        description: [
          'JAVE is the source of truth for roles; mapped Discord roles follow it.',
          `Role sync ${onOff(settings.roles.syncToDiscord)}.`,
        ].join('\n'),
        footer: 'Staff role mappings are founder-only. JAVE never hands out Administrator.',
        fields: [field('Mapping', fitLines(lines))],
      }),
    ],
    components: [
      row(
        stringSelect(
          customId(SETTINGS_NS, 'role'),
          'Choose a role to map',
          mappable.map((t) => ({
            label: roleTargetLabel(t),
            value: t,
            description:
              t === QUARANTINE_TARGET
                ? 'Applied during quarantine. Must deny every channel but one.'
                : `Discord role that follows JAVE ${t.toUpperCase()}.`,
          })),
        ),
      ),
      backRow('summary'),
    ],
  };
}

export function renderRoleEditor(
  settings: AllSettings,
  target: RoleTarget,
  notice?: APIEmbed,
): ReplyPayload {
  const current = roleTargetValue(settings, target);
  const label = roleTargetLabel(target);
  return {
    embeds: [
      ...(notice ? [notice] : []),
      panel({
        kicker: 'JAVE SETTINGS · ROLE',
        title: label,
        description:
          target === QUARANTINE_TARGET
            ? 'Applied while a member is quarantined. JAVE strips every managed role meanwhile.'
            : `Members holding ${label} in JAVE get this Discord role. JAVE's own role must sit above it. A replaced role is removed from its holders.`,
        fields: [field('Current', roleRef(current))],
      }),
    ],
    components: [
      row(roleSelect(customId(SETTINGS_NS, 'roleset', target), 'Choose a Discord role', current)),
      row(
        button('Clear', customId(SETTINGS_NS, 'roleclear', target), 'danger', !current),
        button('Back', customId(SETTINGS_NS, 'panel', 'roles')),
      ),
    ],
  };
}

export function renderFlags(settings: AllSettings, notice?: APIEmbed): ReplyPayload {
  const lines = FLAGS.map((f) => {
    const on = flagValue(settings, f);
    return `${on ? GLYPH.verified : GLYPH.unknown} \`${onOff(on).padEnd(3)}\` ${f.label}`;
  });
  return {
    embeds: [
      ...(notice ? [notice] : []),
      panel({
        kicker: 'JAVE SETTINGS',
        title: 'Flags',
        description: 'Pick a flag to switch it. Sensitive flags ask for confirmation.',
        fields: [field('State', fitLines(lines))],
        footer: 'Raid mode is switched through moderation.',
      }),
    ],
    components: [
      row(
        stringSelect(
          customId(SETTINGS_NS, 'flag'),
          'Choose a flag to switch',
          FLAGS.map((f) => {
            const on = flagValue(settings, f);
            return {
              label: `${f.label} ${GLYPH.arrow} ${onOff(!on)}`,
              value: flagChoice(f, !on),
              description: f.consequence.slice(0, OPTION_DESCRIPTION_MAX),
            };
          }),
        ),
      ),
      backRow('summary'),
    ],
  };
}

export function renderFlagConfirm(flag: FlagSpec, next: boolean): ReplyPayload {
  return {
    embeds: [
      panel({
        kicker: 'JAVE SETTINGS · CONFIRM',
        title: `${flag.label} ${GLYPH.arrow} ${onOff(next)}`,
        description: [
          `When on: ${flag.consequence}`,
          `Currently ${onOff(!next)}.`,
          '',
          'The change is audited and takes effect immediately.',
        ].join('\n'),
      }),
    ],
    components: [
      row(
        button(
          `Switch ${onOff(next)}`,
          customId(SETTINGS_NS, 'flagset', flag.key, onOff(next).toLowerCase()),
          next ? 'primary' : 'danger',
        ),
        button('Cancel', customId(SETTINGS_NS, 'panel', 'flags')),
      ),
    ],
  };
}
