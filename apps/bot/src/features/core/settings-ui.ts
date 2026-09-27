import {
  type APIChannelSelectComponent,
  type APIRoleSelectComponent,
  ChannelType,
  ComponentType,
  SelectMenuDefaultValueType,
} from 'discord.js';
import { isJaveError } from '@jave/core';
import type { HandlerContext, ReplyPayload } from '../../interactions/types';
import { renderError } from '../../interactions/errors';
import { LIMITS } from '../../ui/theme';
import type { OutputChannelKind } from './settings-catalog';

/** Custom id namespaces of the settings and setup controls. */
export const SETTINGS_NS = 'settings';
export const SETUP_NS = 'setup';

/** Placeholders are capped by Discord at 150 characters. */
const PLACEHOLDER_MAX = 150;

const CHANNEL_TYPES: Record<
  OutputChannelKind,
  ChannelType.GuildText | ChannelType.GuildAnnouncement | ChannelType.GuildCategory
> = {
  text: ChannelType.GuildText,
  announcement: ChannelType.GuildAnnouncement,
  category: ChannelType.GuildCategory,
};

/** Native Discord channel picker, filtered to the kinds the setting accepts. */
export function channelSelect(
  customId: string,
  placeholder: string,
  options: { accepts: readonly OutputChannelKind[]; current?: string },
): APIChannelSelectComponent {
  return {
    type: ComponentType.ChannelSelect,
    custom_id: customId,
    placeholder: placeholder.slice(0, PLACEHOLDER_MAX),
    channel_types: options.accepts.map((kind) => CHANNEL_TYPES[kind]),
    min_values: 1,
    max_values: 1,
    ...(options.current && {
      default_values: [{ id: options.current, type: SelectMenuDefaultValueType.Channel }],
    }),
  };
}

/** Native Discord role picker. */
export function roleSelect(
  customId: string,
  placeholder: string,
  current?: string,
): APIRoleSelectComponent {
  return {
    type: ComponentType.RoleSelect,
    custom_id: customId,
    placeholder: placeholder.slice(0, PLACEHOLDER_MAX),
    min_values: 1,
    max_values: 1,
    ...(current && { default_values: [{ id: current, type: SelectMenuDefaultValueType.Role }] }),
  };
}

/**
 * Join lines into one embed field value without cutting a line in half: the
 * tail is summarized as "… N more".
 */
export function fitLines(lines: readonly string[], max: number = LIMITS.fieldValue): string {
  const kept: string[] = [];
  let length = 0;
  for (const [index, line] of lines.entries()) {
    const remaining = lines.length - index;
    const overflow = `… ${remaining} more`;
    const next = length + line.length + (kept.length ? 1 : 0);
    const reserve = remaining > 1 ? overflow.length + 1 : 0;
    if (next + reserve > max) {
      kept.push(overflow);
      break;
    }
    kept.push(line);
    length = next;
  }
  return kept.join('\n');
}

/**
 * Show an ephemeral panel: commands reply with it; buttons and selects replace
 * the message they are attached to (after a deferUpdate, through editReply).
 */
export async function showPanel(h: HandlerContext, payload: ReplyPayload): Promise<void> {
  const { interaction } = h;
  if (interaction.kind !== 'button' && interaction.kind !== 'select') {
    await h.respond({ ...payload, ephemeral: true });
  } else if (interaction.deferred) {
    await interaction.editReply(payload);
  } else {
    await interaction.update(payload);
  }
}

/** Buttons and selects that talk to Discord acknowledge first (3-second limit). */
export async function acknowledge(h: HandlerContext): Promise<void> {
  const { interaction } = h;
  if ((interaction.kind === 'button' || interaction.kind === 'select') && !interaction.deferred) {
    await interaction.deferUpdate();
  }
}

/**
 * After a component's deferred update the router would replace the panel with
 * the error. A refusal (wrong channel, role not allowed…) instead arrives as
 * its own ephemeral message and the panel stays usable. Slash commands and
 * unexpected errors go to the router as usual (the latter are logged with a
 * reference).
 */
export async function keepingPanel(h: HandlerContext, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const { interaction } = h;
    const component = interaction.kind === 'button' || interaction.kind === 'select';
    if (!isJaveError(error) || !component || !interaction.deferred || interaction.replied) {
      throw error;
    }
    await interaction.followUp(renderError(error, h.ctx.logger).payload);
  }
}
