import {
  ChannelType,
  type GuildBasedChannel,
  PermissionFlagsBits,
  PermissionsBitField,
  type Role,
} from 'discord.js';
import type { ChannelKind, DiscordPermission } from './gateway';

const PERMISSION_NAMES = Object.keys(PermissionFlagsBits) as DiscordPermission[];

/** Every flag the bitfield grants. `has` honours Administrator, so an admin holds every flag. */
export function permissionNames(bits: Readonly<PermissionsBitField>): DiscordPermission[] {
  return PERMISSION_NAMES.filter((name) => bits.has(PermissionFlagsBits[name]));
}

const KIND_BY_TYPE: Partial<Record<ChannelType, ChannelKind>> = {
  [ChannelType.GuildText]: 'text',
  [ChannelType.GuildAnnouncement]: 'announcement',
  [ChannelType.GuildCategory]: 'category',
  [ChannelType.GuildVoice]: 'voice',
  [ChannelType.GuildStageVoice]: 'voice',
  [ChannelType.GuildForum]: 'forum',
  [ChannelType.GuildMedia]: 'forum',
  [ChannelType.PublicThread]: 'thread',
  [ChannelType.PrivateThread]: 'thread',
  [ChannelType.AnnouncementThread]: 'thread',
};

export function channelKind(type: ChannelType): ChannelKind {
  return KIND_BY_TYPE[type] ?? 'other';
}

/**
 * Whether a member holding only @everyone and `role` can view `channel`:
 * Discord's algorithm — both roles' server permissions, Administrator
 * short-circuits, then the @everyone overwrite, then the role's overwrite.
 * (`channel.permissionsFor(role)` would ignore @everyone's server permissions.)
 */
export function roleCanView(channel: GuildBasedChannel, everyone: Role, role: Role): boolean {
  const base = new PermissionsBitField(everyone.permissions).add(role.permissions);
  if (base.has(PermissionFlagsBits.Administrator)) return true;
  if (!('permissionOverwrites' in channel)) return base.has(PermissionFlagsBits.ViewChannel);
  const overwrites = channel.permissionOverwrites.cache;
  const atEveryone = overwrites.get(everyone.id);
  const forRole = overwrites.get(role.id);
  return base
    .remove(atEveryone?.deny ?? 0n)
    .add(atEveryone?.allow ?? 0n)
    .remove(forRole?.deny ?? 0n)
    .add(forRole?.allow ?? 0n)
    .has(PermissionFlagsBits.ViewChannel);
}
