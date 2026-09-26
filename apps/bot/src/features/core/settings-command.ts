import { type APIEmbed, ChannelType, SlashCommandBuilder } from 'discord.js';
import {
  type AllSettings,
  authorize,
  can,
  getAllSettings,
  isSnowflake,
  NotFoundError,
  type OrgRole,
  type Settings,
  type SettingsSection,
  updateSettings,
  ValidationError,
} from '@jave/core';
import type { CommandDefinition, ComponentHandler, HandlerContext } from '../../interactions/types';
import { failure, field, panel, success } from '../../ui/components';
import { COLORS } from '../../ui/theme';
import { introspect } from './readiness-probe';
import { permissionLabel } from './readiness';
import {
  CHANNELS,
  type ChannelSpec,
  channelSpec,
  FLAGS,
  type FlagSpec,
  flagSpec,
  parseRoleTarget,
  QUARANTINE_TARGET,
  ROLE_TARGETS,
  type RoleTarget,
  roleTargetLabel,
} from './settings-catalog';
import {
  flagValue,
  renderChannelEditor,
  renderChannels,
  renderFlagConfirm,
  renderFlags,
  renderRoleEditor,
  renderRoles,
  renderSummary,
} from './settings-panels';
import { SETTINGS_NS, showPanel } from './settings-ui';

/** Result banner above a panel: calm success, or a warning when something still needs doing. */
function outcome(title: string, description: string, warnings: string[] = []): APIEmbed {
  if (warnings.length === 0) return success(title, description);
  return panel({
    title: `▲ ${title}`,
    description,
    color: COLORS.warning,
    fields: [field('Action needed', warnings.join('\n'))],
  });
}

async function requireManager(h: HandlerContext, target: string): Promise<void> {
  await authorize(h.ctx, 'canManageSettings', { type: 'settings', id: target });
}

/** Buttons and selects that talk to Discord acknowledge first (3-second limit). */
async function acknowledge(h: HandlerContext): Promise<void> {
  const { interaction } = h;
  if ((interaction.kind === 'button' || interaction.kind === 'select') && !interaction.deferred) {
    await interaction.deferUpdate();
  }
}

// ─── Channels ────────────────────────────────────────────────────────────────

async function setChannel(h: HandlerContext, spec: ChannelSpec, channelId: string) {
  await requireManager(h, 'channels');
  if (!isSnowflake(channelId)) throw new ValidationError('Choose a channel.');
  await acknowledge(h);
  const probe = await introspect(() => h.services.gateway.botPermissionsIn(channelId));
  if (!probe) throw new NotFoundError('Channel');
  const expected = spec.kind === 'category' ? ['category'] : ['text', 'announcement'];
  if (probe.visible && !expected.includes(probe.kind)) {
    throw new ValidationError(
      `${spec.label} needs ${spec.kind === 'category' ? 'a category' : 'a text or announcement channel'}.`,
    );
  }
  await updateSettings(h.ctx, 'channels', { [spec.key]: channelId });
  const warnings: string[] = [];
  if (!probe.visible)
    warnings.push('JAVE cannot see this channel. Allow View Channel for its role.');
  else {
    const missing = spec.needs.filter((p) => !probe.permissions.includes(p));
    if (missing.length)
      warnings.push(`JAVE is missing ${missing.map(permissionLabel).join(', ')}.`);
  }
  const settings = await getAllSettings(h.ctx);
  await showPanel(
    h,
    renderChannelEditor(
      settings,
      spec,
      outcome('Channel set', `${spec.label.toUpperCase()} → <#${channelId}>`, warnings),
    ),
  );
}

async function clearChannel(h: HandlerContext, spec: ChannelSpec) {
  await requireManager(h, 'channels');
  await updateSettings(h.ctx, 'channels', { [spec.key]: undefined });
  const settings = await getAllSettings(h.ctx);
  await showPanel(
    h,
    renderChannelEditor(settings, spec, success('Channel cleared', `${spec.label} is off.`)),
  );
}

// ─── Roles ───────────────────────────────────────────────────────────────────

function mappingPatch(
  current: Settings<'roles'>,
  target: RoleTarget,
  roleId: string | undefined,
): Partial<Settings<'roles'>> {
  if (target === QUARANTINE_TARGET) return { quarantineRoleId: roleId };
  const next: Partial<Record<OrgRole, string>> = { ...current.discordRoleIds };
  if (roleId) next[target] = roleId;
  else delete next[target];
  return { discordRoleIds: next };
}

async function setRole(h: HandlerContext, target: RoleTarget, roleId: string) {
  await requireManager(h, 'roles');
  if (!isSnowflake(roleId)) throw new ValidationError('Choose a role.');
  await acknowledge(h);
  const [roles, bot] = await introspect(() =>
    Promise.all([h.services.gateway.listRoles(), h.services.gateway.botMember()]),
  );
  const role = roles.find((r) => r.id === roleId);
  if (!role) throw new NotFoundError('Role');
  if (role.everyone) throw new ValidationError('@everyone cannot be mapped.');
  if (role.managed) {
    throw new ValidationError(
      'That role is managed by an integration. Discord does not let JAVE assign it.',
    );
  }
  const before = await getAllSettings(h.ctx);
  await updateSettings(h.ctx, 'roles', mappingPatch(before.roles, target, roleId));
  const warnings =
    role.position >= bot.highestRolePosition
      ? [`JAVE's role sits below <@&${roleId}>. Drag it above, or role changes will fail.`]
      : [];
  const settings = await getAllSettings(h.ctx);
  await showPanel(
    h,
    renderRoleEditor(
      settings,
      target,
      outcome('Role mapped', `${roleTargetLabel(target)} → <@&${roleId}>`, warnings),
    ),
  );
}

async function clearRole(h: HandlerContext, target: RoleTarget) {
  await requireManager(h, 'roles');
  const before = await getAllSettings(h.ctx);
  await updateSettings(h.ctx, 'roles', mappingPatch(before.roles, target, undefined));
  const settings = await getAllSettings(h.ctx);
  const label = roleTargetLabel(target);
  await showPanel(
    h,
    renderRoleEditor(settings, target, success('Mapping cleared', `${label} is JAVE-only.`)),
  );
}

// ─── Flags ───────────────────────────────────────────────────────────────────

async function writeFlag<S extends SettingsSection>(
  h: HandlerContext,
  section: S,
  fieldName: string,
  value: boolean,
): Promise<void> {
  await updateSettings(h.ctx, section, { [fieldName]: value } as Partial<Settings<S>>);
}

async function setFlag(h: HandlerContext, flag: FlagSpec, value: boolean) {
  await requireManager(h, flag.section);
  const before = await getAllSettings(h.ctx);
  const changed = flagValue(before, flag) !== value;
  if (changed) await writeFlag(h, flag.section, flag.field, value);
  const settings = changed ? await getAllSettings(h.ctx) : before;
  const state = value ? 'ON' : 'OFF';
  await showPanel(
    h,
    renderFlags(
      settings,
      changed
        ? success('Flag switched', `${flag.label.toUpperCase()} → ${state}`)
        : success('No change', `${flag.label.toUpperCase()} is already ${state}.`),
    ),
  );
}

/** Pick a flag: sensitive ones go through a confirmation step. */
async function pickFlag(h: HandlerContext, flag: FlagSpec) {
  await requireManager(h, flag.section);
  const settings = await getAllSettings(h.ctx);
  const next = !flagValue(settings, flag);
  if (flag.sensitive) return showPanel(h, renderFlagConfirm(flag, next));
  return setFlag(h, flag, next);
}

function parseSwitch(value: string | undefined): boolean {
  if (value === 'on') return true;
  if (value === 'off') return false;
  throw new ValidationError('Unknown state.');
}

// ─── Panels ──────────────────────────────────────────────────────────────────

type PanelName = 'summary' | 'channels' | 'roles' | 'flags';

async function openPanel(h: HandlerContext, name: PanelName) {
  if (name !== 'summary') await requireManager(h, name);
  const settings = await getAllSettings(h.ctx);
  const payload: Record<PanelName, (s: AllSettings) => ReturnType<typeof renderSummary>> = {
    summary: (s) => renderSummary(s, can(h.ctx, 'canManageSettings')),
    channels: (s) => renderChannels(s),
    roles: (s) => renderRoles(s),
    flags: (s) => renderFlags(s),
  };
  await showPanel(h, payload[name](settings));
}

function isPanel(value: string | undefined): value is PanelName {
  return value === 'summary' || value === 'channels' || value === 'roles' || value === 'flags';
}

// ─── Command ─────────────────────────────────────────────────────────────────

export const settingsCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('JAVE server settings.')
    .addSubcommand((s) => s.setName('view').setDescription('Summary of the key settings.'))
    .addSubcommand((s) =>
      s
        .setName('channel')
        .setDescription('Choose where JAVE posts an output.')
        .addStringOption((o) =>
          o
            .setName('output')
            .setDescription('Which output')
            .addChoices(...CHANNELS.map((c) => ({ name: c.label, value: c.key }))),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel (category for Trials category)')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildCategory,
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('role')
        .setDescription('Map a JAVE role to a Discord role.')
        .addStringOption((o) =>
          o
            .setName('role')
            .setDescription('JAVE role')
            .addChoices(...ROLE_TARGETS.map((t) => ({ name: roleTargetLabel(t), value: t }))),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('toggle')
        .setDescription('Switch a feature flag.')
        .addStringOption((o) =>
          o
            .setName('flag')
            .setDescription('Flag to switch')
            .addChoices(...FLAGS.map((f) => ({ name: f.label, value: f.key }))),
        ),
    )
    .toJSON(),
  help: {
    category: 'staff',
    summary: 'View settings; managers map channels and roles and switch flags.',
    usage: '/settings view | channel | role | toggle',
  },
  requires: 'canViewSettings',
  defer: 'ephemeral',
  async execute(h) {
    const o = h.interaction.options;
    switch (o.subcommand()) {
      case 'view':
        return openPanel(h, 'summary');
      case 'channel': {
        const output = o.string('output');
        const channelId = o.channel('channel');
        if (!output) return openPanel(h, 'channels');
        const spec = channelSpec(output);
        if (channelId) return setChannel(h, spec, channelId);
        await requireManager(h, 'channels');
        return showPanel(h, renderChannelEditor(await getAllSettings(h.ctx), spec));
      }
      case 'role': {
        const role = o.string('role');
        if (!role) return openPanel(h, 'roles');
        await requireManager(h, 'roles');
        return showPanel(h, renderRoleEditor(await getAllSettings(h.ctx), parseRoleTarget(role)));
      }
      case 'toggle': {
        const flag = o.string('flag');
        if (!flag) return openPanel(h, 'flags');
        return pickFlag(h, flagSpec(flag));
      }
      default:
        throw new ValidationError('Unknown subcommand.');
    }
  },
};

/**
 * Settings controls. Custom ids only route: every action re-authorizes the
 * clicking user, and core validates and audits each write.
 */
export const settingsComponents: ComponentHandler = {
  namespace: SETTINGS_NS,
  async handle(h, action, args) {
    const [first, second] = args;
    const value = h.interaction.values[0];
    switch (action) {
      case 'panel':
        if (isPanel(first)) return openPanel(h, first);
        break;
      case 'channel':
        if (value) {
          await requireManager(h, 'channels');
          return showPanel(h, renderChannelEditor(await getAllSettings(h.ctx), channelSpec(value)));
        }
        break;
      case 'chset':
        if (first && value) return setChannel(h, channelSpec(first), value);
        break;
      case 'chclear':
        if (first) return clearChannel(h, channelSpec(first));
        break;
      case 'role':
        if (value) {
          await requireManager(h, 'roles');
          return showPanel(
            h,
            renderRoleEditor(await getAllSettings(h.ctx), parseRoleTarget(value)),
          );
        }
        break;
      case 'roleset':
        if (first && value) return setRole(h, parseRoleTarget(first), value);
        break;
      case 'roleclear':
        if (first) return clearRole(h, parseRoleTarget(first));
        break;
      case 'flag':
        if (value) return pickFlag(h, flagSpec(value));
        break;
      case 'flagset':
        if (first) return setFlag(h, flagSpec(first), parseSwitch(second));
        break;
    }
    await h.respond({
      embeds: [failure('EXPIRED', 'This control is no longer active.')],
      ephemeral: true,
    });
  },
};
