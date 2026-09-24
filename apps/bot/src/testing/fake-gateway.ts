import {
  DiscordActionError,
  type DiscordGateway,
  type GuildMemberSnapshot,
  type InviteSnapshot,
  type MessagePayload,
  type PermissionOverwriteSpec,
  type ScheduledEventSpec,
  type SentMessage,
} from '../discord/gateway';

export interface GatewayCall {
  method: string;
  args: unknown[];
}

let counter = 900_000_000_000_000_000n;
const nextId = () => (++counter).toString();

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
  readonly scheduledEvents = new Map<string, ScheduledEventSpec & { cancelled?: boolean }>();
  invites: InviteSnapshot[] = [];
  /** User ids with DMs closed. */
  readonly closedDms = new Set<string>();
  /** method name → error to throw once. */
  readonly failures = new Map<string, DiscordActionError>();
  ready = true;

  constructor(guildId = '100000000000000999') {
    this.guildId = guildId;
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
    const failure = this.failures.get(method);
    if (failure) {
      this.failures.delete(method);
      throw failure;
    }
  }

  callsTo(method: string): GatewayCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  status() {
    return { ready: this.ready, pingMs: this.ready ? 42 : null };
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
    const messageId = nextId();
    this.messages.set(messageId, { channelId, payload });
    return { channelId, messageId };
  }
  async editMessage(channelId: string, messageId: string, payload: MessagePayload) {
    this.record('editMessage', channelId, messageId, payload);
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
  async createPrivateThread(parentChannelId: string, spec: { name: string; reason: string }) {
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
  async createScheduledEvent(spec: ScheduledEventSpec & { reason: string }) {
    this.record('createScheduledEvent', spec);
    const id = nextId();
    this.scheduledEvents.set(id, spec);
    return id;
  }
  async editScheduledEvent(eventId: string, spec: Partial<ScheduledEventSpec>, reason: string) {
    this.record('editScheduledEvent', eventId, spec, reason);
    const existing = this.scheduledEvents.get(eventId);
    if (existing) Object.assign(existing, spec);
  }
  async cancelScheduledEvent(eventId: string, reason: string) {
    this.record('cancelScheduledEvent', eventId, reason);
    const existing = this.scheduledEvents.get(eventId);
    if (existing) existing.cancelled = true;
  }
}
