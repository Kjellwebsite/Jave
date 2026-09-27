import {
  AttachmentBuilder,
  ChannelType,
  type Client,
  DiscordAPIError,
  DiscordjsError,
  DiscordjsErrorCodes,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  type Guild,
  OverwriteType,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  type Role,
  type TextChannel,
  ThreadAutoArchiveDuration,
  type ThreadChannel,
} from 'discord.js';
import {
  type BotMemberSnapshot,
  type ChannelAccessSnapshot,
  type ChannelAccess,
  type ChannelSubject,
  DiscordActionError,
  type DiscordGateway,
  MESSAGE_NONCE_MAX,
  type GuildMemberSnapshot,
  type InviteSnapshot,
  type MessagePayload,
  type PermissionName,
  type PermissionOverwriteSpec,
  type ReadableMessage,
  type RoleSnapshot,
  type ScheduledEventEdit,
  type ScheduledEventSpec,
  type ScheduledEventStatus,
  type SentMessage,
  type ThreadAutoArchiveMinutes,
  type ThreadState,
} from './gateway';
import { channelKind, permissionNames, roleCanView } from './introspection';
import { isDiscordError, UNKNOWN_OBJECT } from './discord-errors';
import { planScheduledEventUpdate, scheduledStartEdit } from './scheduled-event-status';

const AUTO_ARCHIVE_DURATION: Record<ThreadAutoArchiveMinutes, ThreadAutoArchiveDuration> = {
  60: ThreadAutoArchiveDuration.OneHour,
  1440: ThreadAutoArchiveDuration.OneDay,
  4320: ThreadAutoArchiveDuration.ThreeDays,
  10080: ThreadAutoArchiveDuration.OneWeek,
};

/** Discord error codes that retrying will never fix. */
const PERMANENT_CODES = new Set<number>([
  RESTJSONErrorCodes.UnknownMember,
  RESTJSONErrorCodes.UnknownUser,
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.UnknownRole,
  RESTJSONErrorCodes.UnknownBan,
  RESTJSONErrorCodes.UnknownGuildScheduledEvent,
  RESTJSONErrorCodes.MissingAccess,
  RESTJSONErrorCodes.MissingPermissions,
  RESTJSONErrorCodes.CannotSendMessagesToThisUser,
  RESTJSONErrorCodes.InvalidFormBodyOrContentType,
]);

function normalize(error: unknown, action: string): never {
  if (error instanceof DiscordAPIError) {
    const code = typeof error.code === 'number' ? error.code : null;
    const permanent = code !== null && PERMANENT_CODES.has(code);
    const hint =
      code === RESTJSONErrorCodes.MissingPermissions
        ? ' (check the bot role permissions and hierarchy)'
        : '';
    throw new DiscordActionError(
      `${action} failed: ${error.message}${hint}`,
      error.code,
      permanent,
    );
  }
  throw error;
}

/** A guild role, or null when it no longer exists (a deleted role still mapped). */
async function roleOrNull(guild: Guild, roleId: string): Promise<Role | null> {
  const cached = guild.roles.cache.get(roleId);
  if (cached) return cached;
  try {
    return await guild.roles.fetch(roleId);
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownRole)
      return null;
    throw error;
  }
}

async function attempt<T>(action: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    return normalize(error, action);
  }
}

/** Lookups whose failure means "not there / not yours", never "retry". */
const NOT_READABLE_CODES = new Set<number>([
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.UnknownMember,
  RESTJSONErrorCodes.MissingAccess,
  RESTJSONErrorCodes.MissingPermissions,
]);

/** Resolves to null for "not there / not readable" API errors; rethrows the rest normalized. */
async function readable<T>(action: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    if (
      error instanceof DiscordAPIError &&
      typeof error.code === 'number' &&
      NOT_READABLE_CODES.has(error.code)
    )
      return null;
    return normalize(error, action);
  }
}

function toMessageOptions(payload: MessagePayload) {
  return {
    content: payload.content,
    embeds: payload.embeds,
    components: payload.components,
    files: payload.files?.map(
      (f) => new AttachmentBuilder(f.data, { name: f.name, description: f.description }),
    ),
    // JAVE never pings roles/everyone from automated messages.
    allowedMentions: { parse: [] as never[] },
  };
}

/** External scheduled events need a location and an end; these fill in when none is given. */
const DEFAULT_EVENT_LOCATION = 'JAVELIN';
const DEFAULT_EXTERNAL_EVENT_MS = 60 * 60 * 1000;

const SCHEDULED_EVENT_STATUS: Record<GuildScheduledEventStatus, ScheduledEventStatus> = {
  [GuildScheduledEventStatus.Scheduled]: 'scheduled',
  [GuildScheduledEventStatus.Active]: 'active',
  [GuildScheduledEventStatus.Completed]: 'completed',
  [GuildScheduledEventStatus.Canceled]: 'canceled',
};

/** Channel lookups that mean "not there for us" rather than a failure. */
const MISSING_CHANNEL_CODES = new Set<number>([
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.MissingAccess,
]);

type ScheduledEventEntity =
  | {
      entityType: GuildScheduledEventEntityType.Voice | GuildScheduledEventEntityType.StageInstance;
      channel: string;
    }
  | {
      entityType: GuildScheduledEventEntityType.External;
      channel: null;
      entityMetadata: { location: string };
    };

function toOverwrites(overwrites: PermissionOverwriteSpec[]) {
  return overwrites.map((o) => ({
    id: o.id,
    type: o.type === 'member' ? OverwriteType.Member : OverwriteType.Role,
    allow: (o.allow ?? []).map((p) => PermissionFlagsBits[p]),
    deny: (o.deny ?? []).map((p) => PermissionFlagsBits[p]),
  }));
}

/** Production DiscordGateway backed by a logged-in discord.js client. */
export class DiscordJsGateway implements DiscordGateway {
  constructor(
    private readonly client: Client,
    readonly guildId: string,
  ) {}

  status() {
    const ping = this.client.ws.ping;
    return { ready: this.client.isReady(), pingMs: ping >= 0 ? ping : null };
  }

  private async guild(): Promise<Guild> {
    return attempt('fetch guild', () => this.client.guilds.fetch(this.guildId));
  }

  private async textChannel(channelId: string): Promise<TextChannel | ThreadChannel> {
    const channel = await attempt('fetch channel', () => this.client.channels.fetch(channelId));
    if (
      !channel ||
      !(
        channel.type === ChannelType.GuildText ||
        channel.isThread() ||
        channel.type === ChannelType.GuildAnnouncement
      )
    ) {
      throw new DiscordActionError(`channel ${channelId} is not a text channel`, null, true);
    }
    return channel as TextChannel | ThreadChannel;
  }

  async fetchMember(userId: string): Promise<GuildMemberSnapshot | null> {
    const guild = await this.guild();
    try {
      const member = await guild.members.fetch(userId);
      return {
        userId: member.id,
        username: member.user.username,
        roleIds: member.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.id),
        joinedAt: member.joinedAt,
        timedOutUntil: member.communicationDisabledUntil,
        isOwner: guild.ownerId === member.id,
      };
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMember)
        return null;
      return normalize(error, 'fetch member');
    }
  }

  async addRoles(userId: string, roleIds: string[], reason: string) {
    if (roleIds.length === 0) return;
    const guild = await this.guild();
    await attempt(
      'add roles',
      async () => void (await guild.members.addRole({ user: userId, role: roleIds[0]!, reason })),
    );
    for (const roleId of roleIds.slice(1)) {
      await attempt(
        'add roles',
        async () => void (await guild.members.addRole({ user: userId, role: roleId, reason })),
      );
    }
  }

  async removeRoles(userId: string, roleIds: string[], reason: string) {
    const guild = await this.guild();
    for (const roleId of roleIds) {
      await attempt(
        'remove role',
        async () => void (await guild.members.removeRole({ user: userId, role: roleId, reason })),
      );
    }
  }

  async timeout(userId: string, until: Date | null, reason: string) {
    const guild = await this.guild();
    await attempt('timeout', async () => {
      await guild.members.edit(userId, { communicationDisabledUntil: until, reason });
    });
  }

  async kick(userId: string, reason: string) {
    const guild = await this.guild();
    await attempt('kick', async () => void (await guild.members.kick(userId, reason)));
  }

  async ban(userId: string, options: { reason: string; deleteMessageSeconds?: number }) {
    const guild = await this.guild();
    await attempt('ban', async () => void (await guild.bans.create(userId, options)));
  }

  async unban(userId: string, reason: string) {
    const guild = await this.guild();
    await attempt('unban', async () => void (await guild.bans.remove(userId, reason)));
  }

  async createRole(spec: { name: string; color?: number; reason: string }) {
    const guild = await this.guild();
    const role = await attempt('create role', () =>
      guild.roles.create({
        name: spec.name,
        colors: spec.color ? { primaryColor: spec.color } : undefined,
        mentionable: false,
        permissions: [],
        reason: spec.reason,
      }),
    );
    return role.id;
  }

  async deleteRole(roleId: string, reason: string) {
    const guild = await this.guild();
    await attempt('delete role', async () => void (await guild.roles.delete(roleId, reason)));
  }

  async listInvites(): Promise<InviteSnapshot[]> {
    const guild = await this.guild();
    const invites = await attempt('list invites', () => guild.invites.fetch());
    const snapshots: InviteSnapshot[] = invites.map((invite) => ({
      code: invite.code,
      inviterDiscordId: invite.inviterId,
      channelId: invite.channelId,
      uses: invite.uses ?? 0,
      maxUses: invite.maxUses || null,
      temporary: invite.temporary ?? false,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
    }));
    if (guild.vanityURLCode) {
      const vanity = await guild.fetchVanityData().catch(() => null);
      if (vanity?.code) {
        snapshots.push({
          code: vanity.code,
          inviterDiscordId: null,
          channelId: null,
          uses: vanity.uses,
          maxUses: null,
          temporary: false,
          createdAt: null,
          expiresAt: null,
        });
      }
    }
    return snapshots;
  }

  async sendDirectMessage(userId: string, payload: MessagePayload): Promise<SentMessage | null> {
    try {
      const user = await this.client.users.fetch(userId);
      const message = await user.send(toMessageOptions(payload));
      return { channelId: message.channelId, messageId: message.id };
    } catch (error) {
      if (
        error instanceof DiscordAPIError &&
        error.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser
      )
        return null;
      return normalize(error, 'send DM');
    }
  }

  async sendMessage(channelId: string, payload: MessagePayload): Promise<SentMessage> {
    const channel = await this.textChannel(channelId);
    const message = await attempt('send message', () => channel.send(toMessageOptions(payload)));
    return { channelId: message.channelId, messageId: message.id };
  }

  async editMessage(channelId: string, messageId: string, payload: MessagePayload) {
    const channel = await this.textChannel(channelId);
    await attempt('edit message', async () => {
      const { files, ...rest } = toMessageOptions(payload);
      await channel.messages.edit(messageId, { ...rest, ...(files ? { files } : {}) });
    });
  }

  async deleteMessage(channelId: string, messageId: string, reason: string) {
    const channel = await this.textChannel(channelId);
    void reason; // message deletes do not accept an audit-log reason
    await attempt('delete message', async () => void (await channel.messages.delete(messageId)));
  }

  async deleteMessages(channelId: string, messageIds: string[], reason: string) {
    if (messageIds.length === 0) return;
    if (messageIds.length === 1) return this.deleteMessage(channelId, messageIds[0]!, reason);
    const channel = await this.textChannel(channelId);
    await attempt('bulk delete', async () => void (await channel.bulkDelete(messageIds, true)));
  }

  async createTextChannel(spec: {
    name: string;
    parentId?: string;
    topic?: string;
    overwrites: PermissionOverwriteSpec[];
    reason: string;
  }) {
    const guild = await this.guild();
    const channel = await attempt('create channel', () =>
      guild.channels.create({
        name: spec.name,
        type: ChannelType.GuildText,
        parent: spec.parentId,
        topic: spec.topic,
        permissionOverwrites: toOverwrites(spec.overwrites),
        reason: spec.reason,
      }),
    );
    return channel.id;
  }

  async setChannelOverwrites(
    channelId: string,
    overwrites: PermissionOverwriteSpec[],
    reason: string,
  ) {
    const channel = await this.textChannel(channelId);
    if (channel.isThread()) throw new DiscordActionError('threads have no overwrites', null, true);
    await attempt(
      'set overwrites',
      async () =>
        void (await (channel as TextChannel).permissionOverwrites.set(
          toOverwrites(overwrites),
          reason,
        )),
    );
  }

  async renameChannel(channelId: string, name: string, reason: string) {
    const channel = await this.textChannel(channelId);
    await attempt('rename channel', async () => void (await channel.setName(name, reason)));
  }

  async deleteChannel(channelId: string, reason: string) {
    const channel = await this.textChannel(channelId);
    await attempt('delete channel', async () => void (await channel.delete(reason)));
  }

  async createPrivateThread(
    parentChannelId: string,
    spec: { name: string; reason: string; autoArchiveMinutes?: ThreadAutoArchiveMinutes },
  ) {
    const parent = await this.textChannel(parentChannelId);
    if (parent.isThread())
      throw new DiscordActionError('cannot create a thread inside a thread', null, true);
    const thread = await attempt('create thread', () =>
      (parent as TextChannel).threads.create({
        name: spec.name,
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: spec.reason,
        ...(spec.autoArchiveMinutes
          ? { autoArchiveDuration: AUTO_ARCHIVE_DURATION[spec.autoArchiveMinutes] }
          : {}),
      }),
    );
    return thread.id;
  }

  async addThreadMember(threadId: string, userId: string) {
    const thread = await this.textChannel(threadId);
    if (!thread.isThread()) throw new DiscordActionError(`${threadId} is not a thread`, null, true);
    await attempt('add thread member', async () => void (await thread.members.add(userId)));
  }

  async setThreadState(
    threadId: string,
    state: { locked?: boolean; archived?: boolean },
    reason: string,
  ) {
    const thread = await this.textChannel(threadId);
    if (!thread.isThread()) throw new DiscordActionError(`${threadId} is not a thread`, null, true);
    await attempt('update thread', async () => void (await thread.edit({ ...state, reason })));
  }

  async fetchThreadState(threadId: string): Promise<ThreadState> {
    const channel = await attempt('fetch thread', () =>
      this.client.channels.fetch(threadId, { force: true }),
    );
    if (!channel?.isThread()) {
      throw new DiscordActionError(`${threadId} is not a thread`, null, true);
    }
    return { archived: channel.archived ?? false, locked: channel.locked ?? false };
  }

  /** A guild channel, or null when it does not exist or the bot cannot see it. */
  private async guildChannel(guild: Guild, channelId: string) {
    try {
      return await guild.channels.fetch(channelId);
    } catch (error) {
      if (error instanceof DiscordAPIError && MISSING_CHANNEL_CODES.has(Number(error.code))) {
        return null;
      }
      return normalize(error, 'fetch channel');
    }
  }

  /**
   * Voice and stage channels host the event; any other channel (or none)
   * becomes an external location, since Discord refuses other channel types.
   */
  private async scheduledEventEntity(
    guild: Guild,
    spec: Pick<ScheduledEventSpec, 'channelId' | 'location'>,
  ): Promise<ScheduledEventEntity> {
    const external = (location: string): ScheduledEventEntity => ({
      entityType: GuildScheduledEventEntityType.External,
      channel: null,
      entityMetadata: { location },
    });
    if (!spec.channelId) return external(spec.location ?? DEFAULT_EVENT_LOCATION);
    const channel = await this.guildChannel(guild, spec.channelId);
    if (channel?.type === ChannelType.GuildVoice) {
      return { entityType: GuildScheduledEventEntityType.Voice, channel: spec.channelId };
    }
    if (channel?.type === ChannelType.GuildStageVoice) {
      return { entityType: GuildScheduledEventEntityType.StageInstance, channel: spec.channelId };
    }
    return external(channel ? `#${channel.name}` : (spec.location ?? DEFAULT_EVENT_LOCATION));
  }

  async createScheduledEvent(spec: ScheduledEventSpec & { reason: string }) {
    const guild = await this.guild();
    const entity = await this.scheduledEventEntity(guild, spec);
    const external = entity.entityType === GuildScheduledEventEntityType.External;
    const event = await attempt('create scheduled event', () =>
      guild.scheduledEvents.create({
        name: spec.name,
        description: spec.description,
        scheduledStartTime: spec.startAt,
        scheduledEndTime:
          spec.endAt ??
          (external ? new Date(spec.startAt.getTime() + DEFAULT_EXTERNAL_EVENT_MS) : undefined),
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: entity.entityType,
        channel: entity.channel ?? undefined,
        entityMetadata: 'entityMetadata' in entity ? entity.entityMetadata : undefined,
        reason: spec.reason,
      }),
    );
    return event.id;
  }

  private async currentScheduledEvent(guild: Guild, eventId: string) {
    const event = await attempt('fetch scheduled event', () =>
      guild.scheduledEvents.fetch(eventId),
    );
    return { status: SCHEDULED_EVENT_STATUS[event.status], startAt: event.scheduledStartAt };
  }

  private async setScheduledEventStatus(
    guild: Guild,
    eventId: string,
    status: Exclude<ScheduledEventStatus, 'scheduled'>,
    reason: string,
  ) {
    await attempt('update scheduled event status', async () => {
      switch (status) {
        case 'active':
          await guild.scheduledEvents.edit(eventId, {
            status: GuildScheduledEventStatus.Active,
            reason,
          });
          return;
        case 'completed':
          await guild.scheduledEvents.edit(eventId, {
            status: GuildScheduledEventStatus.Completed,
            reason,
          });
          return;
        case 'canceled':
          await guild.scheduledEvents.edit(eventId, {
            status: GuildScheduledEventStatus.Canceled,
            reason,
          });
          return;
      }
    });
  }

  private async editScheduledEventFields(
    guild: Guild,
    eventId: string,
    spec: ScheduledEventEdit,
    startAt: Date | undefined,
    reason: string,
  ) {
    const relocated = spec.channelId !== undefined || spec.location !== undefined;
    const entity = relocated ? await this.scheduledEventEntity(guild, spec) : null;
    await attempt('edit scheduled event', async () => {
      await guild.scheduledEvents.edit(eventId, {
        name: spec.name,
        description: spec.description,
        scheduledStartTime: startAt,
        scheduledEndTime: spec.endAt,
        ...(entity && {
          entityType: entity.entityType,
          channel: entity.channel,
          entityMetadata: 'entityMetadata' in entity ? entity.entityMetadata : undefined,
        }),
        reason,
      });
    });
  }

  async editScheduledEvent(eventId: string, spec: ScheduledEventEdit, reason: string) {
    const guild = await this.guild();
    const current = await this.currentScheduledEvent(guild, eventId);
    const plan = planScheduledEventUpdate(current.status, spec.status ?? current.status);
    if (plan.remove) return this.deleteScheduledEvent(eventId, reason);
    // A refused field edit must not hold back the status: going live matters more.
    let fieldFailure: { error: unknown } | null = null;
    if (plan.editable) {
      const startAt = scheduledStartEdit(plan, current.startAt, spec.startAt, new Date());
      try {
        await this.editScheduledEventFields(guild, eventId, spec, startAt, reason);
      } catch (error) {
        if (isDiscordError(error, UNKNOWN_OBJECT.scheduledEvent)) throw error;
        fieldFailure = { error };
      }
    }
    for (const status of plan.transitions) {
      await this.setScheduledEventStatus(guild, eventId, status, reason);
    }
    if (fieldFailure) throw fieldFailure.error;
  }

  async cancelScheduledEvent(eventId: string, reason: string) {
    const guild = await this.guild();
    const { status: current } = await this.currentScheduledEvent(guild, eventId);
    const plan = planScheduledEventUpdate(current, 'canceled');
    if (plan.remove) return this.deleteScheduledEvent(eventId, reason);
    for (const status of plan.transitions) {
      await this.setScheduledEventStatus(guild, eventId, status, reason);
    }
  }

  async deleteScheduledEvent(eventId: string, reason: string) {
    const guild = await this.guild();
    void reason; // scheduled event deletes do not accept an audit-log reason
    await attempt('delete scheduled event', () => guild.scheduledEvents.delete(eventId));
  }

  async channelAccess(channelId: string, subject: ChannelSubject): Promise<ChannelAccess | null> {
    const guild = await this.guild();
    const channel = await this.guildChannel(guild, channelId);
    if (!channel) return null;
    let member;
    if (subject.kind === 'bot') {
      member = await attempt('fetch bot member', () => guild.members.fetchMe());
    } else {
      try {
        member = await guild.members.fetch(subject.userId);
      } catch (error) {
        if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMember) {
          return null;
        }
        return normalize(error, 'fetch member');
      }
    }
    const permissions = channel.permissionsFor(member);
    const thread = channel.isThread();
    return {
      textBased:
        thread ||
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement,
      view: permissions.has(PermissionFlagsBits.ViewChannel),
      send: permissions.has(
        thread ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages,
      ),
      embedLinks: permissions.has(PermissionFlagsBits.EmbedLinks),
      readHistory: permissions.has(PermissionFlagsBits.ReadMessageHistory),
    };
  }

  async setChannelOverwrite(channelId: string, overwrite: PermissionOverwriteSpec, reason: string) {
    const channel = await this.textChannel(channelId);
    if (channel.isThread()) throw new DiscordActionError('threads have no overwrites', null, true);
    const options: Partial<Record<PermissionName, boolean>> = {};
    for (const permission of overwrite.allow ?? []) options[permission] = true;
    for (const permission of overwrite.deny ?? []) options[permission] = false;
    await attempt(
      'set overwrite',
      async () =>
        // create() replaces this one overwrite; the channel's other overwrites stay as they are.
        void (await (channel as TextChannel).permissionOverwrites.create(overwrite.id, options, {
          reason,
          type: overwrite.type === 'member' ? OverwriteType.Member : OverwriteType.Role,
        })),
    );
  }

  async roleMemberIds(roleId: string): Promise<string[]> {
    const guild = await this.guild();
    // role.members reads the member cache: fetch the member list first (GuildMembers intent).
    await attempt('fetch members', () => guild.members.fetch());
    const role = await attempt('fetch role', () => guild.roles.fetch(roleId));
    return role ? [...role.members.keys()] : [];
  }

  async botMember(): Promise<BotMemberSnapshot> {
    const guild = await this.guild();
    const me = await attempt('fetch bot member', () => guild.members.fetchMe());
    return {
      userId: me.id,
      permissions: permissionNames(me.permissions),
      administrator: me.permissions.has(PermissionFlagsBits.Administrator),
      highestRolePosition: me.roles.highest.position,
    };
  }

  async botPermissionsIn(
    channelId: string,
    audienceRoleIds: readonly string[] = [],
  ): Promise<ChannelAccessSnapshot | null> {
    const guild = await this.guild();
    let channel;
    try {
      channel = await guild.channels.fetch(channelId);
    } catch (error) {
      if (error instanceof DiscordjsError && error.code === DiscordjsErrorCodes.GuildChannelUnowned)
        return null;
      if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownChannel)
        return null;
      if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.MissingAccess)
        return {
          channelId,
          name: null,
          kind: 'other',
          visible: false,
          permissions: [],
          everyoneCanView: false,
          audienceWithView: [],
        };
      return normalize(error, 'fetch channel');
    }
    if (!channel) return null;
    const me = await attempt('fetch bot member', () => guild.members.fetchMe());
    const permissions = channel.permissionsFor(me);
    const visible = permissions.has(PermissionFlagsBits.ViewChannel);
    const everyone = guild.roles.everyone;
    const audience = await attempt('fetch roles', () =>
      Promise.all(audienceRoleIds.map((id) => roleOrNull(guild, id))),
    );
    return {
      channelId: channel.id,
      name: visible ? channel.name : null,
      kind: channelKind(channel.type),
      visible,
      permissions: permissionNames(permissions),
      everyoneCanView: roleCanView(channel, everyone, everyone),
      audienceWithView: audience
        .filter((role): role is Role => role !== null && roleCanView(channel, everyone, role))
        .map((role) => role.id),
    };
  }

  async listRoles(): Promise<RoleSnapshot[]> {
    const guild = await this.guild();
    const roles = await attempt('list roles', () => guild.roles.fetch());
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      position: role.position,
      managed: role.managed,
      everyone: role.id === guild.id,
      permissions: permissionNames(role.permissions),
    }));
  }

  async sendMessageOnce(
    channelId: string,
    payload: MessagePayload,
    nonce: string,
  ): Promise<SentMessage> {
    if (nonce.length === 0 || nonce.length > MESSAGE_NONCE_MAX)
      throw new DiscordActionError(`nonce must be 1–${MESSAGE_NONCE_MAX} characters`, null, true);
    const channel = await this.textChannel(channelId);
    const message = await attempt('send message', () =>
      channel.send({ ...toMessageOptions(payload), nonce, enforceNonce: true }),
    );
    return { channelId: message.channelId, messageId: message.id };
  }

  async fetchMessageAs(
    asUserId: string,
    channelId: string,
    messageId: string,
  ): Promise<ReadableMessage | null> {
    const channel = await readable('fetch channel', () => this.client.channels.fetch(channelId));
    if (!channel || !channel.isTextBased() || channel.isDMBased()) return null;
    if (channel.guildId !== this.guildId) return null;
    const member = await readable('fetch member', () => channel.guild.members.fetch(asUserId));
    if (!member) return null;
    const permissions = channel.permissionsFor(member);
    if (
      !permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])
    )
      return null;
    if (channel.type === ChannelType.PrivateThread) {
      const threadMember = await readable('fetch thread member', () =>
        channel.members.fetch({ member: asUserId }),
      );
      if (!threadMember && !permissions.has(PermissionFlagsBits.ManageThreads)) return null;
    }
    const message = await readable('fetch message', () => channel.messages.fetch(messageId));
    if (!message) return null;
    return {
      id: message.id,
      channelId: message.channelId,
      authorId: message.author.id,
      authorName:
        message.member?.displayName ?? message.author.globalName ?? message.author.username,
      authorIsBot: message.author.bot,
      content: message.content,
      embedsText: message.embeds
        .map((e) => [e.title, e.description].filter(Boolean).join('\n'))
        .filter(Boolean),
      createdAt: message.createdAt,
      url: message.url,
    };
  }
}
