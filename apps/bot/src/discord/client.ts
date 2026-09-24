import { Client, Events, type Message, type PartialMessage, Partials } from 'discord.js';
import type { Logger } from '@jave/core';
import type { BotApp } from '../app';
import { adaptInteraction } from '../interactions/adapter';
import type { IncomingMessage } from '../gateway-events/types';
import { INTENTS } from './permissions';

export function createDiscordClient(): Client {
  return new Client({
    intents: [...INTENTS],
    partials: [Partials.GuildMember, Partials.Message, Partials.Channel],
    allowedMentions: { parse: [] },
  });
}

function normalizeMessage(message: Message): IncomingMessage {
  const isThread = message.channel.isThread();
  return {
    id: message.id,
    channelId: message.channelId,
    guildId: message.guildId,
    parentChannelId: isThread ? (message.channel.parentId ?? null) : null,
    isThread,
    author: {
      id: message.author.id,
      username: message.author.username,
      globalName: message.author.globalName,
      avatar: message.author.avatar,
      bot: message.author.bot,
    },
    authorRoleIds: message.member?.roles.cache.map((r) => r.id) ?? [],
    content: message.content,
    mentionCount: message.mentions.users.size + message.mentions.roles.size,
    mentionsEveryone: message.mentions.everyone,
    attachments: message.attachments.map((a) => ({
      name: a.name,
      url: a.url,
      size: a.size,
      contentType: a.contentType,
    })),
    createdAt: message.createdAt,
    url: message.url,
  };
}

/**
 * Wire discord.js events into the app. Every listener is guarded so a failing
 * handler never crashes the process; only the home guild is served.
 */
export function wireClient(client: Client, app: BotApp, guildId: string, logger: Logger): void {
  const guard = (event: string, fn: () => Promise<unknown>) => {
    fn().catch((error: unknown) => logger.error({ err: error, event }, 'gateway listener failed'));
  };

  client.once(Events.ClientReady, (ready) => {
    logger.info({ user: ready.user.tag, guilds: ready.guilds.cache.size }, 'discord ready');
    if (!ready.guilds.cache.has(guildId))
      logger.warn(
        { guildId },
        'bot is not in the configured guild — invite it with the URL from `pnpm --filter @jave/bot commands:print`',
      );
    guard('ready', () => app.events.ready());
  });

  client.on(Events.InteractionCreate, (interaction) => {
    const adapted = adaptInteraction(interaction);
    if (!adapted) return;
    guard('interactionCreate', () => app.router.handle(adapted));
  });

  client.on(Events.MessageCreate, (message) => {
    if (message.guildId !== guildId || message.author.bot || message.system) return;
    guard('messageCreate', () => app.events.message(normalizeMessage(message)));
  });

  client.on(Events.MessageUpdate, (_old, updated) => {
    if (updated.guildId !== guildId || updated.partial || updated.author?.bot) return;
    guard('messageUpdate', () =>
      app.events.messageUpdate({
        id: updated.id,
        channelId: updated.channelId,
        guildId: updated.guildId,
        content: updated.content,
        editedAt: updated.editedAt ?? new Date(),
      }),
    );
  });

  client.on(Events.MessageDelete, (message: Message | PartialMessage) => {
    if (message.guildId !== guildId) return;
    guard('messageDelete', () =>
      app.events.messageDelete({
        id: message.id,
        channelId: message.channelId,
        guildId: message.guildId,
      }),
    );
  });

  client.on(Events.GuildMemberAdd, (member) => {
    if (member.guild.id !== guildId) return;
    guard('guildMemberAdd', () =>
      app.events.memberJoin({
        id: member.id,
        username: member.user.username,
        globalName: member.user.globalName,
        avatar: member.user.avatar,
        bot: member.user.bot,
        joinedAt: member.joinedAt ?? new Date(),
      }),
    );
  });

  client.on(Events.GuildMemberRemove, (member) => {
    if (member.guild.id !== guildId) return;
    guard('guildMemberRemove', () => app.events.memberLeave(member.id));
  });

  client.on(Events.InviteCreate, (invite) => {
    if (invite.guild?.id !== guildId) return;
    guard('inviteCreate', () => app.events.invitesChanged());
  });
  client.on(Events.InviteDelete, (invite) => {
    if (invite.guild?.id !== guildId) return;
    guard('inviteDelete', () => app.events.invitesChanged());
  });

  client.on(Events.ShardDisconnect, (event, shardId) =>
    logger.warn({ shardId, code: event.code }, 'discord shard disconnected'),
  );
  client.on(Events.ShardReconnecting, (shardId) =>
    logger.info({ shardId }, 'discord shard reconnecting'),
  );
  client.on(Events.ShardResume, (shardId, replayed) =>
    logger.info({ shardId, replayed }, 'discord shard resumed'),
  );
  client.on(Events.ShardError, (error, shardId) =>
    logger.error({ err: error, shardId }, 'discord shard error'),
  );
  client.on(Events.Warn, (message) => logger.warn({ message }, 'discord warning'));
  client.on(Events.Error, (error) => logger.error({ err: error }, 'discord client error'));
}
