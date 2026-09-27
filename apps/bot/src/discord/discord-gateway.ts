import {
  AttachmentBuilder,
  ChannelType,
  type Client,
  DiscordAPIError,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  type Guild,
  OverwriteType,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  type TextChannel,
  ThreadAutoArchiveDuration,
  type ThreadChannel,
} from 'discord.js';
import {
  type ChannelAccess,
  type ChannelSubject,
  DiscordActionError,
  type DiscordGateway,
  MESSAGE_NONCE_MAX,
  type GuildMemberSnapshot,
  type InviteSnapshot,
  type MessagePayload,
  type PermissionOverwriteSpec,
  type ScheduledEventEdit,
  type ScheduledEventSpec,
  type ScheduledEventStatus,
  type SentMessage,
  type ThreadAutoArchiveMinutes,
  type ThreadState,
} from './gateway';
import { planScheduledEventUpdate } from './scheduled-event-status';

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

async function attempt<T>(action: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
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

  private async scheduledEventStatus(guild: Guild, eventId: string) {
    const event = await attempt('fetch scheduled event', () =>
      guild.scheduledEvents.fetch(eventId),
    );
    return SCHEDULED_EVENT_STATUS[event.status];
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

  async editScheduledEvent(eventId: string, spec: ScheduledEventEdit, reason: string) {
    const guild = await this.guild();
    const current = await this.scheduledEventStatus(guild, eventId);
    const plan = planScheduledEventUpdate(current, spec.status ?? current);
    if (plan.editable) {
      const relocated = spec.channelId !== undefined || spec.location !== undefined;
      const entity = relocated ? await this.scheduledEventEntity(guild, spec) : null;
      await attempt('edit scheduled event', async () => {
        await guild.scheduledEvents.edit(eventId, {
          name: spec.name,
          description: spec.description,
          scheduledStartTime: plan.startEditable ? spec.startAt : undefined,
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
    for (const status of plan.transitions) {
      await this.setScheduledEventStatus(guild, eventId, status, reason);
    }
  }

  async cancelScheduledEvent(eventId: string, reason: string) {
    const guild = await this.guild();
    const current = await this.scheduledEventStatus(guild, eventId);
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
}
