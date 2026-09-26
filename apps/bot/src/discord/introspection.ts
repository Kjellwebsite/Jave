import { ChannelType, PermissionFlagsBits, type PermissionsBitField } from 'discord.js';
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
