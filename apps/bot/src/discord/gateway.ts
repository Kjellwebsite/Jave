import type { PermissionFlagsBits } from 'discord.js';
import type { ReplyPayload } from '../interactions/types';

/**
 * DiscordGateway — the only way JAVE's job handlers and gateway-event
 * handlers act on Discord. The production implementation wraps discord.js
 * (discord-gateway.ts); tests use FakeDiscordGateway. Keeping this surface
 * explicit makes every Discord side effect testable and least-privilege.
 */

export type MessagePayload = Omit<ReplyPayload, 'ephemeral'>;

export interface GuildMemberSnapshot {
  userId: string;
  username: string;
  roleIds: string[];
  joinedAt: Date | null;
  timedOutUntil: Date | null;
  isOwner: boolean;
}

export interface InviteSnapshot {
  code: string;
  inviterDiscordId: string | null;
  channelId: string | null;
  uses: number;
  maxUses: number | null;
  temporary: boolean;
  createdAt: Date | null;
  expiresAt: Date | null;
}

export interface PermissionOverwriteSpec {
  type: 'member' | 'role';
  id: string;
  allow?: PermissionName[];
  deny?: PermissionName[];
}

/** Subset of Discord permission flag names JAVE ever grants in overwrites. */
export type PermissionName =
  | 'ViewChannel'
  | 'SendMessages'
  | 'SendMessagesInThreads'
  | 'ReadMessageHistory'
  | 'AttachFiles'
  | 'EmbedLinks'
  | 'AddReactions'
  | 'UseApplicationCommands'
  | 'ManageMessages'
  | 'Connect'
  | 'Speak';

export interface ScheduledEventSpec {
  name: string;
  description?: string;
  startAt: Date;
  endAt?: Date;
  /** Either a voice/stage channel id or an external location string. */
  channelId?: string;
  location?: string;
}

export interface SentMessage {
  channelId: string;
  messageId: string;
}

/** A Discord API failure normalized for job handlers. */
export class DiscordActionError extends Error {
  constructor(
    message: string,
    readonly code: number | string | null,
    /** Retrying cannot help (missing permission, unknown entity, closed DMs). */
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = 'DiscordActionError';
  }
}

export interface DiscordGateway {
  readonly guildId: string;
  /** Websocket status for health checks. */
  status(): { ready: boolean; pingMs: number | null };

  // Members & roles
  fetchMember(userId: string): Promise<GuildMemberSnapshot | null>;
  addRoles(userId: string, roleIds: string[], reason: string): Promise<void>;
  removeRoles(userId: string, roleIds: string[], reason: string): Promise<void>;
  timeout(userId: string, until: Date | null, reason: string): Promise<void>;
  kick(userId: string, reason: string): Promise<void>;
  ban(userId: string, options: { reason: string; deleteMessageSeconds?: number }): Promise<void>;
  unban(userId: string, reason: string): Promise<void>;
  createRole(spec: { name: string; color?: number; reason: string }): Promise<string>;
  deleteRole(roleId: string, reason: string): Promise<void>;
  listInvites(): Promise<InviteSnapshot[]>;

  // Messages
  /** Returns null when the user does not accept DMs. */
  sendDirectMessage(userId: string, payload: MessagePayload): Promise<SentMessage | null>;
  sendMessage(channelId: string, payload: MessagePayload): Promise<SentMessage>;
  editMessage(channelId: string, messageId: string, payload: MessagePayload): Promise<void>;
  deleteMessage(channelId: string, messageId: string, reason: string): Promise<void>;
  deleteMessages(channelId: string, messageIds: string[], reason: string): Promise<void>;

  // Channels & threads
  createTextChannel(spec: {
    name: string;
    parentId?: string;
    topic?: string;
    overwrites: PermissionOverwriteSpec[];
    reason: string;
  }): Promise<string>;
  setChannelOverwrites(
    channelId: string,
    overwrites: PermissionOverwriteSpec[],
    reason: string,
  ): Promise<void>;
  renameChannel(channelId: string, name: string, reason: string): Promise<void>;
  deleteChannel(channelId: string, reason: string): Promise<void>;
  createPrivateThread(
    parentChannelId: string,
    spec: { name: string; reason: string },
  ): Promise<string>;
  addThreadMember(threadId: string, userId: string): Promise<void>;
  setThreadState(
    threadId: string,
    state: { locked?: boolean; archived?: boolean },
    reason: string,
  ): Promise<void>;

  // Scheduled events
  createScheduledEvent(spec: ScheduledEventSpec & { reason: string }): Promise<string>;
  editScheduledEvent(
    eventId: string,
    spec: Partial<ScheduledEventSpec>,
    reason: string,
  ): Promise<void>;
  cancelScheduledEvent(eventId: string, reason: string): Promise<void>;

  // Introspection (read-only: readiness checks and settings validation)
  botMember(): Promise<BotMemberSnapshot>;
  /** Null when the channel does not exist in the guild. */
  botPermissionsIn(channelId: string): Promise<ChannelAccessSnapshot | null>;
  listRoles(): Promise<RoleSnapshot[]>;
}

/** A Discord permission flag name, e.g. 'ManageRoles'. */
export type DiscordPermission = keyof typeof PermissionFlagsBits;

/** The bot's own membership in the guild. */
export interface BotMemberSnapshot {
  userId: string;
  /** Effective guild-level permissions (Administrator implies every flag). */
  permissions: DiscordPermission[];
  administrator: boolean;
  /** Position of the bot's highest role; it can only manage roles strictly below. */
  highestRolePosition: number;
}

export type ChannelKind =
  'text' | 'announcement' | 'category' | 'voice' | 'forum' | 'thread' | 'other';

/** What the bot can do in one guild channel (permission overwrites applied). */
export interface ChannelAccessSnapshot {
  channelId: string;
  /** Null when the channel is hidden from the bot. */
  name: string | null;
  kind: ChannelKind;
  /** False when the channel exists but the bot cannot see it. */
  visible: boolean;
  permissions: DiscordPermission[];
}

export interface RoleSnapshot {
  id: string;
  name: string;
  /** Hierarchy position; higher outranks lower. */
  position: number;
  /** Bot, booster and integration roles: Discord never lets anyone assign them. */
  managed: boolean;
  /** The @everyone role (same id as the guild). */
  everyone: boolean;
}
