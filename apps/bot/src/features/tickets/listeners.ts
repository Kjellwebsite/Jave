import {
  createContext,
  type ServiceContext,
  systemActor,
  tickets,
  ValidationError,
} from '@jave/core';
import type { IncomingMessage, MessageDeletion, MessageUpdate } from '../../gateway-events/types';
import type { BotServices } from '../../runtime';
import { clip } from '../../ui/format';

/** Discord allows 10 attachments per message; core stores at most that many. */
const MAX_ATTACHMENTS = 10;
const ATTACHMENT_NAME_MAX = 256;
const MIME_TYPE = /^[\w.+-]+\/[\w.+-]+(;.*)?$/;
const CONTENT_TYPE_MAX = 128;

function systemContext(services: BotServices, reason: string): ServiceContext {
  return createContext({
    db: services.db,
    clock: services.clock,
    cache: services.cache,
    config: services.config,
    logger: services.logger,
    actor: systemActor(reason),
  });
}

function inHomeGuild(services: BotServices, guildId: string | null): boolean {
  return guildId === services.discord.guildId;
}

/** Discord metadata only — attachments are never downloaded. */
function attachmentsOf(message: IncomingMessage) {
  return message.attachments.slice(0, MAX_ATTACHMENTS).map((a) => ({
    name: clip(a.name, ATTACHMENT_NAME_MAX),
    url: a.url,
    size: a.size,
    contentType:
      a.contentType && a.contentType.length <= CONTENT_TYPE_MAX && MIME_TYPE.test(a.contentType)
        ? a.contentType
        : null,
  }));
}

/** A malformed Discord payload is logged and dropped; it must not look like an outage. */
async function tolerateInvalid(
  ctx: ServiceContext,
  event: string,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    ctx.logger.warn({ event, issues: error.issues }, 'ticket message not recorded: invalid input');
  }
}

/**
 * Every human message in a thread goes to core, which records it when the
 * thread belongs to a ticket and ignores it otherwise. A requester's reply may
 * resume a waiting ticket; the card refresh it schedules runs right away.
 */
export async function onTicketMessage(
  services: BotServices,
  message: IncomingMessage,
): Promise<void> {
  if (!message.isThread || message.author.bot || !inHomeGuild(services, message.guildId)) return;
  const attachments = attachmentsOf(message);
  if (!message.content.trim() && attachments.length === 0) return;
  const ctx = systemContext(services, 'gateway:ticket-message');
  await tolerateInvalid(ctx, 'message', () =>
    tickets.recordMessage(ctx, {
      threadId: message.channelId,
      discordMessageId: message.id,
      author: {
        discordId: message.author.id,
        username: message.author.username,
        displayName: message.author.globalName,
        avatarHash: message.author.avatar,
        bot: message.author.bot,
      },
      body: message.content,
      attachments,
      sentAt: message.createdAt,
    }),
  );
  if (ctx.effects.jobIds.length > 0) await services.runJobsNow(ctx.effects.jobIds);
}

/** Edits of recorded messages; core keeps the first text for staff. */
export async function onTicketMessageUpdate(
  services: BotServices,
  update: MessageUpdate,
): Promise<void> {
  if (!inHomeGuild(services, update.guildId)) return;
  const ctx = systemContext(services, 'gateway:ticket-message-edit');
  await tolerateInvalid(ctx, 'messageUpdate', () =>
    tickets.recordMessageEdit(ctx, {
      discordMessageId: update.id,
      body: update.content,
      editedAt: update.editedAt,
    }),
  );
}

/** Deletions are flagged, never purged: staff keep the record. */
export async function onTicketMessageDelete(
  services: BotServices,
  deletion: MessageDeletion,
): Promise<void> {
  if (!inHomeGuild(services, deletion.guildId)) return;
  const ctx = systemContext(services, 'gateway:ticket-message-delete');
  await tolerateInvalid(ctx, 'messageDelete', () =>
    tickets.recordMessageDelete(ctx, {
      discordMessageId: deletion.id,
      deletedAt: services.clock.now(),
    }),
  );
}
