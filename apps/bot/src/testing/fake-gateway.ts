import { PermissionFlagsBits } from 'discord.js';
import {
  type BotMemberSnapshot,
  type ChannelAccessSnapshot,
  type ChannelKind,
  type ChannelAccess,
  type ChannelSubject,
  DiscordActionError,
  type DiscordGateway,
  type DiscordPermission,
  MESSAGE_NONCE_MAX,
  type GuildMemberSnapshot,
  type InviteSnapshot,
  type MessagePayload,
  type PermissionOverwriteSpec,
  type ReadableMessage,
  type RoleSnapshot,
  type ScheduledEventEdit,
  type ScheduledEventSpec,
  type ScheduledEventStatus,
  type SentMessage,
  type ThreadAutoArchiveMinutes,
  type ThreadState,
} from '../discord/gateway';
import { REQUIRED_PERMISSIONS } from '../discord/permissions';
import { planScheduledEventUpdate, scheduledStartEdit } from '../discord/scheduled-event-status';

/** The fake bot's own user id (matches the harness client id). */
export const FAKE_BOT_USER_ID = '100000000000000888';

export interface FakeGuildChannel {
  name: string;
  kind: ChannelKind;
  /** The bot cannot see the channel at all. */
  hidden?: boolean;
  /** Permission overwrites denying the bot these flags in this channel. */
  denied?: DiscordPermission[];
  /** Roles whose holders can view the channel; the guild id stands for @everyone. */
  viewers?: string[];
}

/** Discord's "Unknown Guild Scheduled Event" error code. */
const UNKNOWN_SCHEDULED_EVENT = 10070;
/** Discord's "Invalid Form Body" (RESTJSONErrorCodes.InvalidFormBodyOrContentType). */
const INVALID_FORM_BODY = 50035;

const FULL_ACCESS: ChannelAccess = {
  textBased: true,
  view: true,
  send: true,
  embedLinks: true,
  readHistory: true,
};

/** Key for `FakeDiscordGateway.channelAccessOverrides`. */
export function channelAccessKey(channelId: string, subject: ChannelSubject): string {
  return `${channelId}:${subject.kind === 'bot' ? 'bot' : subject.userId}`;
}

export interface GatewayCall {
  method: string;
  args: unknown[];
}

let counter = 900_000_000_000_000_000n;
const nextId = () => (++counter).toString();

/** Discord's "Thread is archived" (RESTJSONErrorCodes.ThreadArchived). */
const THREAD_ARCHIVED = 50083;

/**
 * In-memory DiscordGateway for tests. Records every call, keeps simple guild
 * state (members, roles, channels, messages) and can be told to fail.
 */
export class FakeDiscordGateway implements DiscordGateway {
  readonly guildId: string;
  readonly calls: GatewayCall[] = [];
  readonly members = new Map<string, GuildMemberSnapshot>();
  readonly channels = new Map<
    string,
    {
      name: string;
      parentId?: string;
      overwrites: PermissionOverwriteSpec[];
      thread: boolean;
      members: Set<string>;
      locked?: boolean;
      archived?: boolean;
    }
  >();
  readonly messages = new Map<string, { channelId: string; payload: MessagePayload }>();
  readonly dms: { userId: string; payload: MessagePayload }[] = [];
  readonly bans = new Set<string>();
  readonly scheduledEvents = new Map<
    string,
    ScheduledEventSpec & { cancelled?: boolean; status: ScheduledEventStatus }
  >();
  /**
   * `channelAccessKey(channel, subject)` → access (null = unknown channel/member).
   * Without an override the bot has full access everywhere and guild members
   * have full access; users who are not guild members get null.
   */
  readonly channelAccessOverrides = new Map<string, ChannelAccess | null>();
  invites: InviteSnapshot[] = [];
  /** User ids with DMs closed. */
  readonly closedDms = new Set<string>();
  /** method name → error to throw once. */
  readonly failures = new Map<string, DiscordActionError>();
  /**
   * While set, every call throws this error (a Discord outage), and the
   * gateway reports not ready. Clear it to recover.
   */
  outage: DiscordActionError | null = null;
  /** Guild messages readable through fetchMessageAs, by message id. */
  readonly readableMessages = new Map<string, ReadableMessage>();
  /** channel id → the only user ids allowed to read it (absent: everyone in the guild). */
  readonly channelReaders = new Map<string, Set<string>>();
  ready = true;
  /** The clock Discord's own checks read (a scheduled start must lie ahead). */
  private readonly now: () => Date;

  constructor(guildId = '100000000000000999', options: { now?: () => Date } = {}) {
    this.guildId = guildId;
    this.now = options.now ?? (() => new Date());
  }

  addMember(
    userId: string,
    username = `user${userId.slice(-4)}`,
    roleIds: string[] = [],
  ): GuildMemberSnapshot {
    const member = {
      userId,
      username,
      roleIds: [...roleIds],
      joinedAt: new Date(),
      timedOutUntil: null,
      isOwner: false,
    };
    this.members.set(userId, member);
    return member;
  }

  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
    if (this.outage) throw this.outage;
    const failure = this.failures.get(method);
    if (failure) {
      this.failures.delete(method);
      throw failure;
    }
  }

  /** Put a message in the fake guild so fetchMessageAs can find it. */
  seedMessage(
    message: Pick<ReadableMessage, 'channelId' | 'content'> & Partial<ReadableMessage>,
  ): ReadableMessage {
    const id = message.id ?? nextId();
    const full: ReadableMessage = {
      id,
      authorId: '100000000000000777',
      authorName: 'author',
      authorIsBot: false,
      embedsText: [],
      createdAt: new Date('2026-03-01T11:00:00.000Z'),
      url: `https://discord.com/channels/${this.guildId}/${message.channelId}/${id}`,
      ...message,
    };
    this.readableMessages.set(id, full);
    return full;
  }

  callsTo(method: string): GatewayCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  /**
   * Discord's archived-thread rules: messages in an archived thread cannot be
   * edited and members cannot be added; a new message unarchives the thread
   * unless it is locked.
   */
  private refuseIfArchived(channelId: string, action: string) {
    const channel = this.channels.get(channelId);
    if (channel?.thread && channel.archived) {
      throw new DiscordActionError(`${action} failed: Thread is archived`, THREAD_ARCHIVED, false);
    }
  }

  status() {
    const ready = this.ready && !this.outage;
    return { ready, pingMs: ready ? 42 : null };
  }

  async fetchMember(userId: string) {
    this.record('fetchMember', userId);
    const m = this.members.get(userId);
    return m ? { ...m, roleIds: [...m.roleIds] } : null;
  }
  async addRoles(userId: string, roleIds: string[], reason: string) {
    this.record('addRoles', userId, roleIds, reason);
    const m = this.members.get(userId);
    if (!m) throw new DiscordActionError('unknown member', 10007, true);
    for (const id of roleIds) if (!m.roleIds.includes(id)) m.roleIds.push(id);
  }
  async removeRoles(userId: string, roleIds: string[], reason: string) {
    this.record('removeRoles', userId, roleIds, reason);
    const m = this.members.get(userId);
    if (!m) throw new DiscordActionError('unknown member', 10007, true);
    m.roleIds = m.roleIds.filter((id) => !roleIds.includes(id));
  }
  async timeout(userId: string, until: Date | null, reason: string) {
    this.record('timeout', userId, until, reason);
    const m = this.members.get(userId);
    if (m) m.timedOutUntil = until;
  }
  async kick(userId: string, reason: string) {
    this.record('kick', userId, reason);
    this.members.delete(userId);
  }
  async ban(userId: string, options: { reason: string; deleteMessageSeconds?: number }) {
    this.record('ban', userId, options);
    this.bans.add(userId);
    this.members.delete(userId);
  }
  async unban(userId: string, reason: string) {
    this.record('unban', userId, reason);
    this.bans.delete(userId);
  }
  async createRole(spec: { name: string; color?: number; reason: string }) {
    this.record('createRole', spec);
    return nextId();
  }
  async deleteRole(roleId: string, reason: string) {
    this.record('deleteRole', roleId, reason);
  }
  async listInvites() {
    this.record('listInvites');
    return this.invites.map((i) => ({ ...i }));
  }
  async sendDirectMessage(userId: string, payload: MessagePayload): Promise<SentMessage | null> {
    this.record('sendDirectMessage', userId, payload);
    if (this.closedDms.has(userId)) return null;
    this.dms.push({ userId, payload });
    return { channelId: `dm-${userId}`, messageId: nextId() };
  }
  async sendMessage(channelId: string, payload: MessagePayload) {
    this.record('sendMessage', channelId, payload);
    const channel = this.channels.get(channelId);
    if (channel?.thread && channel.archived) {
      if (channel.locked) this.refuseIfArchived(channelId, 'send message');
      channel.archived = false;
    }
    const messageId = nextId();
    this.messages.set(messageId, { channelId, payload });
    return { channelId, messageId };
  }
  async editMessage(channelId: string, messageId: string, payload: MessagePayload) {
    this.record('editMessage', channelId, messageId, payload);
    this.refuseIfArchived(channelId, 'edit message');
    const existing = this.messages.get(messageId);
    if (!existing) throw new DiscordActionError('unknown message', 10008, true);
    existing.payload = payload;
  }
  async deleteMessage(channelId: string, messageId: string, reason: string) {
    this.record('deleteMessage', channelId, messageId, reason);
    this.messages.delete(messageId);
  }
  async deleteMessages(channelId: string, messageIds: string[], reason: string) {
    this.record('deleteMessages', channelId, messageIds, reason);
    for (const id of messageIds) this.messages.delete(id);
  }
  async createTextChannel(spec: {
    name: string;
    parentId?: string;
    topic?: string;
    overwrites: PermissionOverwriteSpec[];
    reason: string;
  }) {
    this.record('createTextChannel', spec);
    const id = nextId();
    this.channels.set(id, {
      name: spec.name,
      parentId: spec.parentId,
      overwrites: spec.overwrites,
      thread: false,
      members: new Set(),
    });
    return id;
  }
  async setChannelOverwrites(
    channelId: string,
    overwrites: PermissionOverwriteSpec[],
    reason: string,
  ) {
    this.record('setChannelOverwrites', channelId, overwrites, reason);
    const channel = this.channels.get(channelId);
    if (channel) channel.overwrites = overwrites;
  }
  async renameChannel(channelId: string, name: string, reason: string) {
    this.record('renameChannel', channelId, name, reason);
    const channel = this.channels.get(channelId);
    if (channel) channel.name = name;
  }
  async deleteChannel(channelId: string, reason: string) {
    this.record('deleteChannel', channelId, reason);
    this.channels.delete(channelId);
  }
  async createPrivateThread(
    parentChannelId: string,
    spec: { name: string; reason: string; autoArchiveMinutes?: ThreadAutoArchiveMinutes },
  ) {
    this.record('createPrivateThread', parentChannelId, spec);
    const id = nextId();
    this.channels.set(id, {
      name: spec.name,
      parentId: parentChannelId,
      overwrites: [],
      thread: true,
      members: new Set(),
    });
    return id;
  }
  async addThreadMember(threadId: string, userId: string) {
    this.record('addThreadMember', threadId, userId);
    this.refuseIfArchived(threadId, 'add thread member');
    this.channels.get(threadId)?.members.add(userId);
  }
  async setThreadState(
    threadId: string,
    state: { locked?: boolean; archived?: boolean },
    reason: string,
  ) {
    this.record('setThreadState', threadId, state, reason);
    const thread = this.channels.get(threadId);
    if (thread) Object.assign(thread, state);
  }
  async fetchThreadState(threadId: string): Promise<ThreadState> {
    this.record('fetchThreadState', threadId);
    const thread = this.channels.get(threadId);
    if (!thread?.thread) throw new DiscordActionError('unknown channel', 10003, true);
    return { archived: thread.archived ?? false, locked: thread.locked ?? false };
  }
  /** Like Discord: a scheduled start that is not in the future refuses the request. */
  private assertFutureStart(startAt: Date) {
    if (startAt.getTime() <= this.now().getTime()) {
      throw new DiscordActionError(
        'Invalid Form Body: cannot schedule event in the past',
        INVALID_FORM_BODY,
        true,
      );
    }
  }
  async createScheduledEvent(spec: ScheduledEventSpec & { reason: string }) {
    this.record('createScheduledEvent', spec);
    this.assertFutureStart(spec.startAt);
    const id = nextId();
    this.scheduledEvents.set(id, { ...spec, status: 'scheduled' });
    return id;
  }
  private knownScheduledEvent(eventId: string) {
    const existing = this.scheduledEvents.get(eventId);
    if (!existing) {
      throw new DiscordActionError('unknown scheduled event', UNKNOWN_SCHEDULED_EVENT, true);
    }
    return existing;
  }
  async editScheduledEvent(eventId: string, spec: ScheduledEventEdit, reason: string) {
    this.record('editScheduledEvent', eventId, spec, reason);
    const existing = this.knownScheduledEvent(eventId);
    const { status, startAt, ...fields } = spec;
    const plan = planScheduledEventUpdate(existing.status, status ?? existing.status);
    if (plan.remove) {
      this.scheduledEvents.delete(eventId);
      return;
    }
    if (plan.editable) {
      const start = scheduledStartEdit(plan, existing.startAt, startAt, this.now());
      if (start) this.assertFutureStart(start);
      Object.assign(existing, fields, start ? { startAt: start } : {});
    }
    for (const next of plan.transitions) existing.status = next;
  }
  async cancelScheduledEvent(eventId: string, reason: string) {
    this.record('cancelScheduledEvent', eventId, reason);
    const existing = this.knownScheduledEvent(eventId);
    const plan = planScheduledEventUpdate(existing.status, 'canceled');
    if (plan.remove) {
      this.scheduledEvents.delete(eventId);
      return;
    }
    for (const next of plan.transitions) existing.status = next;
    existing.cancelled = existing.status === 'canceled';
  }
  async deleteScheduledEvent(eventId: string, reason: string) {
    this.record('deleteScheduledEvent', eventId, reason);
    this.knownScheduledEvent(eventId);
    this.scheduledEvents.delete(eventId);
  }
  async channelAccess(channelId: string, subject: ChannelSubject) {
    this.record('channelAccess', channelId, subject);
    const key = channelAccessKey(channelId, subject);
    if (this.channelAccessOverrides.has(key)) return this.channelAccessOverrides.get(key) ?? null;
    if (subject.kind === 'member' && !this.members.has(subject.userId)) return null;
    return { ...FULL_ACCESS };
  }
  async setChannelOverwrite(channelId: string, overwrite: PermissionOverwriteSpec, reason: string) {
    this.record('setChannelOverwrite', channelId, overwrite, reason);
    const channel = this.channels.get(channelId);
    if (!channel) throw new DiscordActionError('unknown channel', 10003, true);
    channel.overwrites = [...channel.overwrites.filter((o) => o.id !== overwrite.id), overwrite];
  }
  async roleMemberIds(roleId: string) {
    this.record('roleMemberIds', roleId);
    return [...this.members.values()]
      .filter((member) => member.roleIds.includes(roleId))
      .map((member) => member.userId);
  }

  // Introspection state. Defaults describe a correctly installed bot:
  // exactly the required permissions, no Administrator, role near the top.
  readonly botPermissions = new Set<DiscordPermission>(
    Object.keys(REQUIRED_PERMISSIONS) as DiscordPermission[],
  );
  botAdministrator = false;
  botHighestRolePosition = 50;
  readonly roles = new Map<string, RoleSnapshot>();
  /** Guild channels visible to introspection (created text channels count as text). */
  readonly guildChannels = new Map<string, FakeGuildChannel>();

  addRole(
    id: string,
    name: string,
    position: number,
    managed = false,
    permissions: DiscordPermission[] = [],
  ): RoleSnapshot {
    const role = { id, name, position, managed, everyone: false, permissions };
    this.roles.set(id, role);
    return role;
  }

  addGuildChannel(id: string, channel: FakeGuildChannel): void {
    this.guildChannels.set(id, channel);
  }

  private effectivePermissions(denied: readonly DiscordPermission[] = []): DiscordPermission[] {
    if (this.botAdministrator) return Object.keys(PermissionFlagsBits) as DiscordPermission[];
    return [...this.botPermissions].filter((p) => !denied.includes(p));
  }

  async botMember(): Promise<BotMemberSnapshot> {
    this.record('botMember');
    return {
      userId: FAKE_BOT_USER_ID,
      permissions: this.effectivePermissions(),
      administrator: this.botAdministrator,
      highestRolePosition: this.botHighestRolePosition,
    };
  }

  async botPermissionsIn(
    channelId: string,
    audienceRoleIds: readonly string[] = [],
  ): Promise<ChannelAccessSnapshot | null> {
    this.record('botPermissionsIn', channelId, [...audienceRoleIds]);
    const created = this.channels.get(channelId);
    const channel: FakeGuildChannel | undefined =
      this.guildChannels.get(channelId) ??
      (created ? { name: created.name, kind: created.thread ? 'thread' : 'text' } : undefined);
    if (!channel) return null;
    if (channel.hidden && !this.botAdministrator) {
      return {
        channelId,
        name: null,
        kind: 'other',
        visible: false,
        permissions: [],
        everyoneCanView: false,
        audienceWithView: [],
      };
    }
    const permissions = this.effectivePermissions(channel.denied);
    const viewers = channel.viewers ?? [];
    return {
      channelId,
      name: channel.name,
      kind: channel.kind,
      visible: permissions.includes('ViewChannel'),
      permissions,
      everyoneCanView: viewers.includes(this.guildId),
      audienceWithView: audienceRoleIds.filter((id) => viewers.includes(id)),
    };
  }

  async listRoles(): Promise<RoleSnapshot[]> {
    this.record('listRoles');
    const everyone = { id: this.guildId, name: '@everyone', position: 0, managed: false };
    return [
      { ...everyone, everyone: true, permissions: [] },
      ...[...this.roles.values()].map((r) => ({ ...r, permissions: [...r.permissions] })),
    ];
  }

  /** channelId:nonce → message id, like Discord's enforce_nonce window. */
  readonly nonces = new Map<string, string>();
  async sendMessageOnce(channelId: string, payload: MessagePayload, nonce: string) {
    this.record('sendMessageOnce', channelId, payload, nonce);
    if (nonce.length === 0 || nonce.length > MESSAGE_NONCE_MAX)
      throw new DiscordActionError('invalid nonce', 50035, true);
    const key = `${channelId}:${nonce}`;
    const existing = this.nonces.get(key);
    if (existing) return { channelId, messageId: existing };
    const messageId = nextId();
    this.messages.set(messageId, { channelId, payload });
    this.nonces.set(key, messageId);
    return { channelId, messageId };
  }
  async fetchMessageAs(asUserId: string, channelId: string, messageId: string) {
    this.record('fetchMessageAs', asUserId, channelId, messageId);
    if (!this.members.has(asUserId)) return null;
    const readers = this.channelReaders.get(channelId);
    if (readers && !readers.has(asUserId)) return null;
    const message = this.readableMessages.get(messageId);
    return message && message.channelId === channelId ? { ...message } : null;
  }
}
