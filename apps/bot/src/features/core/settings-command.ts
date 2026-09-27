import { type APIEmbed, ChannelType, SlashCommandBuilder } from 'discord.js';
import {
  type AllSettings,
  assertMayMapRole,
  authorize,
  can,
  getAllSettings,
  getSettingsFresh,
  isSnowflake,
  mayMapRole,
  NotFoundError,
  type OrgRole,
  retiredRoleIds,
  type Settings,
  type SettingsSection,
  updateSettings,
  ValidationError,
} from '@jave/core';
import type { CommandDefinition, ComponentHandler, HandlerContext } from '../../interactions/types';
import { failure, field, panel, success } from '../../ui/components';
import { COLORS } from '../../ui/theme';
import { introspect } from './readiness-probe';
import {
  acceptsChannel,
  audienceRoleIds,
  channelExposure,
  CHANNELS,
  type ChannelSpec,
  channelSpec,
  describeKinds,
  elevatedPermissions,
  FLAGS,
  type FlagSpec,
  flagSpec,
  mayCarryElevated,
  parseRoleTarget,
  permissionLabel,
  QUARANTINE_TARGET,
  roleHolders,
  ROLE_TARGETS,
  type RoleTarget,
  roleTargetLabel,
} from './settings-catalog';
import {
  parseFlagChoice,
  renderChannelEditor,
  renderChannels,
  renderFlagConfirm,
  renderFlags,
  renderRoleEditor,
  renderRoles,
  renderSummary,
} from './settings-panels';
import { acknowledge, keepingPanel, SETTINGS_NS, showPanel } from './settings-ui';

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

// ─── Channels ────────────────────────────────────────────────────────────────

async function setChannel(h: HandlerContext, spec: ChannelSpec, channelId: string) {
  await requireManager(h, 'channels');
  if (!isSnowflake(channelId)) throw new ValidationError('Choose a channel.');
  await acknowledge(h);
  await keepingPanel(h, async () => {
    const audience = spec.staffOnly ? audienceRoleIds(await getSettingsFresh(h.ctx, 'roles')) : [];
    const probe = await introspect(() => h.services.gateway.botPermissionsIn(channelId, audience));
    if (!probe) throw new NotFoundError('Channel');
    if (probe.visible && !acceptsChannel(spec, probe.kind)) {
      throw new ValidationError(`${spec.label} needs ${describeKinds(spec.accepts)}.`);
    }
    const exposedTo = channelExposure(spec, probe);
    if (exposedTo) {
      throw new ValidationError(
        `${spec.label} carries staff-only data and <#${channelId}> is readable by ${exposedTo}. Choose a channel only staff can see.`,
      );
    }
    await updateSettings(h.ctx, 'channels', { [spec.key]: channelId });
    const warnings: string[] = [];
    if (!probe.visible) {
      warnings.push('JAVE cannot see this channel. Allow View Channel for its role.');
    } else {
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
  });
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

/**
 * The mapping change as a function of the stored value: core applies it to
 * the fresh section, so a mapping made meanwhile elsewhere is never dropped.
 */
function mappingPatch(target: RoleTarget, roleId: string | undefined) {
  return (current: Settings<'roles'>): Partial<Settings<'roles'>> => {
    if (target === QUARANTINE_TARGET) return { quarantineRoleId: roleId };
    const next: Partial<Record<OrgRole, string>> = { ...current.discordRoleIds };
    if (roleId) next[target] = roleId;
    else delete next[target];
    return { discordRoleIds: next };
  };
}

/** Write a mapping; returns the Discord roles it retired (JAVE removes them from their holders). */
async function writeMapping(
  h: HandlerContext,
  target: RoleTarget,
  roleId: string | undefined,
): Promise<{ after: Settings<'roles'>; retired: string[] }> {
  let before: Settings<'roles'> | undefined;
  const after = await updateSettings(h.ctx, 'roles', (current) => {
    before = current;
    return mappingPatch(target, roleId)(current);
  });
  return { after, retired: before ? retiredRoleIds(before, after) : [] };
}

/** What happens to the Discord roles a mapping change let go of. */
function retiredNote(retired: readonly string[], after: Settings<'roles'>): string[] {
  if (retired.length === 0) return [];
  const refs = retired.map((id) => `<@&${id}>`).join(', ');
  const one = retired.length === 1;
  return after.syncToDiscord
    ? [
        `${refs} ${one ? 'is' : 'are'} no longer managed. JAVE removes ${one ? 'it' : 'them'} from every member.`,
      ]
    : [`Role sync is off: ${refs} ${one ? 'stays' : 'stay'} on current holders.`];
}

/** Opening a mapping editor: the actor must be allowed to change that mapping. */
function requireMappable(h: HandlerContext, target: RoleTarget): void {
  if (target !== QUARANTINE_TARGET) assertMayMapRole(h.ctx, target);
}

async function openRoleEditor(h: HandlerContext, target: RoleTarget) {
  await requireManager(h, 'roles');
  requireMappable(h, target);
  await showPanel(h, renderRoleEditor(await getAllSettings(h.ctx), target));
}

async function setRole(h: HandlerContext, target: RoleTarget, roleId: string) {
  await requireManager(h, 'roles');
  requireMappable(h, target);
  if (!isSnowflake(roleId)) throw new ValidationError('Choose a role.');
  await acknowledge(h);
  await keepingPanel(h, async () => {
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
    const elevated = elevatedPermissions(role);
    if (elevated.includes('Administrator')) {
      throw new ValidationError(
        'That role grants Administrator. JAVE never hands out Administrator. Map a role without it.',
      );
    }
    if (elevated.length > 0 && !mayCarryElevated(target)) {
      throw new ValidationError(
        `That role grants ${elevated.map(permissionLabel).join(', ')}. JAVE would hand it to ${roleHolders(target)}. Map a role without elevated permissions.`,
      );
    }
    if (role.position >= bot.highestRolePosition) {
      throw new ValidationError(
        `<@&${roleId}> sits at or above JAVE's highest role, so Discord would refuse every change. Drag JAVE's role above it in Server Settings → Roles, then map it.`,
      );
    }
    const { after, retired } = await writeMapping(h, target, roleId);
    const settings = await getAllSettings(h.ctx);
    const description = [
      `${roleTargetLabel(target)} → <@&${roleId}>`,
      ...retiredNote(retired, after),
    ];
    await showPanel(
      h,
      renderRoleEditor(settings, target, success('Role mapped', description.join('\n'))),
    );
  });
}

async function clearRole(h: HandlerContext, target: RoleTarget) {
  await requireManager(h, 'roles');
  requireMappable(h, target);
  const { after, retired } = await writeMapping(h, target, undefined);
  const settings = await getAllSettings(h.ctx);
  const description = [`${roleTargetLabel(target)} is JAVE-only.`, ...retiredNote(retired, after)];
  await showPanel(
    h,
    renderRoleEditor(settings, target, success('Mapping cleared', description.join('\n'))),
  );
}

// ─── Flags ───────────────────────────────────────────────────────────────────

/** Write a flag; true when the stored value actually changed. */
async function writeFlag(h: HandlerContext, flag: FlagSpec, value: boolean): Promise<boolean> {
  let previous: unknown;
  await updateSettings(h.ctx, flag.section, (current: Settings<SettingsSection>) => {
    previous = (current as Record<string, unknown>)[flag.field];
    return { [flag.field]: value } as Partial<Settings<SettingsSection>>;
  });
  return previous !== value;
}

async function setFlag(h: HandlerContext, flag: FlagSpec, value: boolean) {
  await requireManager(h, flag.section);
  const changed = await writeFlag(h, flag, value);
  const settings = await getAllSettings(h.ctx);
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

/**
 * Switch a flag to exactly the state the control showed ("Tickets → OFF"
 * sets OFF, even if someone switched it meanwhile). Sensitive flags go
 * through a confirmation step that carries the same target state.
 */
async function pickFlag(h: HandlerContext, flag: FlagSpec, next: boolean) {
  await requireManager(h, flag.section);
  if (flag.sensitive) return showPanel(h, renderFlagConfirm(flag, next));
  return setFlag(h, flag, next);
}

/** /settings toggle: the opposite of the flag's current stored value (read fresh, not cached). */
async function toggleFlag(h: HandlerContext, flag: FlagSpec) {
  await requireManager(h, flag.section);
  const current = await getSettingsFresh(h.ctx, flag.section);
  const next = (current as Record<string, unknown>)[flag.field] !== true;
  return pickFlag(h, flag, next);
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
    roles: (s) => renderRoles(s, (target) => mayMapTarget(h, target)),
    flags: (s) => renderFlags(s),
  };
  await showPanel(h, payload[name](settings));
}

function mayMapTarget(h: HandlerContext, target: RoleTarget): boolean {
  return target === QUARANTINE_TARGET || mayMapRole(h.ctx.actor, target);
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
        return openRoleEditor(h, parseRoleTarget(role));
      }
      case 'toggle': {
        const flag = o.string('flag');
        if (!flag) return openPanel(h, 'flags');
        return toggleFlag(h, flagSpec(flag));
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
        if (value) return openRoleEditor(h, parseRoleTarget(value));
        break;
      case 'roleset':
        if (first && value) return setRole(h, parseRoleTarget(first), value);
        break;
      case 'roleclear':
        if (first) return clearRole(h, parseRoleTarget(first));
        break;
      case 'flag': {
        const choice = value ? parseFlagChoice(value) : null;
        if (choice) return pickFlag(h, flagSpec(choice.key), choice.next);
        break;
      }
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
