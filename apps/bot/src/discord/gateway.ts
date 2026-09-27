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

/** Discord's scheduled event states (Discord spells the last one CANCELED). */
export type ScheduledEventStatus = 'scheduled' | 'active' | 'completed' | 'canceled';

/**
 * Fields to change on a scheduled event, plus the status it should end up in.
 * The gateway applies only the transitions Discord allows (scheduled → active →
 * completed) and skips edits Discord refuses (the start of an active event, a
 * start less than a minute ahead, anything on a completed or canceled one); an
 * unchanged start is not re-sent. A refused field edit still applies the status
 * before it throws. Completing an event that never started deletes it: Discord
 * completes only active events, and starting one notifies everyone Interested.
 */
export interface ScheduledEventEdit extends Partial<ScheduledEventSpec> {
  status?: Exclude<ScheduledEventStatus, 'canceled'>;
}

/** Whose channel permissions to check: the bot itself or a guild member. */
export type ChannelSubject = { kind: 'bot' } | { kind: 'member'; userId: string };

/** Effective permissions of a subject in a channel (threads use Send Messages in Threads). */
export interface ChannelAccess {
  /** Messages can be posted in this channel at all (text, announcement or thread). */
  textBased: boolean;
  view: boolean;
  send: boolean;
  embedLinks: boolean;
  readHistory: boolean;
}

export interface SentMessage {
  channelId: string;
  messageId: string;
}

/** A guild message read on behalf of a member (see `fetchMessageAs`). */
export interface ReadableMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  authorIsBot: boolean;
  content: string;
  embedsText: string[];
  createdAt: Date;
  url: string;
}

/** Idle periods after which Discord archives a thread (the values its API accepts). */
export type ThreadAutoArchiveMinutes = 60 | 1440 | 4320 | 10080;

export interface ThreadState {
  archived: boolean;
  locked: boolean;
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
    spec: { name: string; reason: string; autoArchiveMinutes?: ThreadAutoArchiveMinutes },
  ): Promise<string>;
  addThreadMember(threadId: string, userId: string): Promise<void>;
  setThreadState(
    threadId: string,
    state: { locked?: boolean; archived?: boolean },
    reason: string,
  ): Promise<void>;
  /** Current archived/locked flags, read fresh from Discord (not the cache). */
  fetchThreadState(threadId: string): Promise<ThreadState>;

  // Scheduled events
  /** Discord refuses a start that is not in the future (Invalid Form Body). */
  createScheduledEvent(spec: ScheduledEventSpec & { reason: string }): Promise<string>;
  editScheduledEvent(eventId: string, spec: ScheduledEventEdit, reason: string): Promise<void>;
  /** Scheduled → canceled; an active event cannot be canceled on Discord and is deleted. */
  cancelScheduledEvent(eventId: string, reason: string): Promise<void>;
  deleteScheduledEvent(eventId: string, reason: string): Promise<void>;

  // Permissions
  /** Null when the channel or member is unknown, or the channel is outside the guild. */
  channelAccess(channelId: string, subject: ChannelSubject): Promise<ChannelAccess | null>;

  // Trials (appended)
  /**
   * Create or replace one permission overwrite, leaving the channel's other
   * overwrites untouched (e.g. lock a member out of sending without dropping
   * the evaluator roles' access).
   */
  setChannelOverwrite(
    channelId: string,
    overwrite: PermissionOverwriteSpec,
    reason: string,
  ): Promise<void>;
  /** Discord user ids currently holding a role (empty when the role is unknown). */
  roleMemberIds(roleId: string): Promise<string[]>;
  // Introspection (read-only: readiness checks and settings validation)
  botMember(): Promise<BotMemberSnapshot>;
  /**
   * Null when the channel does not exist in the guild. `audienceRoleIds`:
   * roles to test for View Channel there (reported in `audienceWithView`).
   */
  botPermissionsIn(
    channelId: string,
    audienceRoleIds?: readonly string[],
  ): Promise<ChannelAccessSnapshot | null>;
  listRoles(): Promise<RoleSnapshot[]>;

  // Idempotent posting
  /**
   * Post with an enforced nonce (≤ 25 characters, e.g. a prefix plus the job
   * id): within Discord's nonce window a retry with the same nonce returns
   * the message already posted instead of posting a duplicate.
   */
  sendMessageOnce(channelId: string, payload: MessagePayload, nonce: string): Promise<SentMessage>;

  // Member-scoped reads
  /**
   * Read one home-guild message on behalf of a member. Returns null when the
   * message or channel does not exist, is outside the home guild, or the
   * member lacks View Channel + Read Message History there (and, in a
   * private thread, is not a thread member). The bot's own access is never
   * lent to a member.
   */
  fetchMessageAs(
    asUserId: string,
    channelId: string,
    messageId: string,
  ): Promise<ReadableMessage | null>;
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
  /** A member with no roles beyond @everyone can view the channel. */
  everyoneCanView: boolean;
  /**
   * The requested audience roles whose holders can view the channel (with
   * @everyone's permissions and the channel overwrites applied).
   */
  audienceWithView: string[];
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
  /** Permissions the role grants server-wide (Administrator implies every flag). */
  permissions: DiscordPermission[];
}

/** Discord caps message nonces at 25 characters. */
export const MESSAGE_NONCE_MAX = 25;
