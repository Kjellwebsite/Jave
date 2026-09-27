import { ai, ExternalServiceError, NotFoundError, ValidationError } from '@jave/core';
import { DiscordActionError, type ReadableMessage } from '../../discord/gateway';
import type { HandlerContext, TargetMessage } from '../../interactions/types';

/** A Discord message link, split into its ids. */
export interface MessageRef {
  guildId: string;
  channelId: string;
  messageId: string;
}

const MESSAGE_LINK =
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/;
/** Longest link we even try to parse. */
const MAX_LINK_LENGTH = 200;
const FALLBACK_AUTHOR = 'member';
const DISCORD_SERVICE = 'discord';
const DISCORD_UNAVAILABLE = 'Discord did not return that message. Try again in a moment.';

export function parseMessageLink(link: string): MessageRef | null {
  const trimmed = link.trim();
  if (trimmed.length > MAX_LINK_LENGTH) return null;
  const match = MESSAGE_LINK.exec(trimmed);
  if (!match) return null;
  return { guildId: match[1]!, channelId: match[2]!, messageId: match[3]! };
}

/** The readable text of a message: its content plus embed titles/descriptions. */
export function messageText(content: string, embedsText: readonly string[]): string {
  return [content, ...embedsText]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n');
}

/** A message as core's summarize() takes it (author and text capped to core's limits). */
export interface SummarizableMessage {
  author: string;
  content: string;
  sentAt: string;
}

export function summarizable(author: string, text: string, sentAt: Date): SummarizableMessage {
  return {
    author: author.trim().slice(0, ai.MAX_MESSAGE_AUTHOR_LENGTH) || FALLBACK_AUTHOR,
    content: text.slice(0, ai.MAX_SUMMARIZE_MESSAGE_LENGTH),
    sentAt: sentAt.toISOString(),
  };
}

/** The right-clicked message's text, or a calm refusal when there is none to read. */
export function targetText(target: TargetMessage | null): { target: TargetMessage; text: string } {
  if (!target) throw new NotFoundError('Message');
  const text = messageText(target.content, target.embedsText);
  if (!text) throw new ValidationError('That message has no text JAVE can read.');
  return { target, text };
}

export function authorName(target: TargetMessage): string {
  return target.author.globalName ?? target.author.username;
}

/**
 * Resolve a message link for the invoking member. Only JAVELIN messages the
 * member can read themselves are returned; everything else is "not found"
 * (never "exists but hidden").
 */
export async function readLinkedMessage(
  h: HandlerContext,
  link: string,
): Promise<SummarizableMessage> {
  const ref = parseMessageLink(link);
  if (!ref) throw new ValidationError('That is not a Discord message link.');
  if (ref.guildId !== h.services.discord.guildId) {
    throw new ValidationError('JAVE reads messages from JAVELIN only.');
  }
  let message: ReadableMessage | null;
  try {
    message = await h.services.gateway.fetchMessageAs(
      h.interaction.user.id,
      ref.channelId,
      ref.messageId,
    );
  } catch (error) {
    // "Not there / not yours" is already null; anything else is Discord being unavailable.
    if (!(error instanceof DiscordActionError)) throw error;
    h.ctx.logger.warn({ code: error.code }, 'fetchMessageAs failed');
    throw new ExternalServiceError(DISCORD_SERVICE, DISCORD_UNAVAILABLE, !error.permanent);
  }
  if (!message) throw new NotFoundError('Message');
  const text = messageText(message.content, message.embedsText);
  if (!text) throw new ValidationError('That message has no text JAVE can read.');
  return summarizable(message.authorName, text, message.createdAt);
}
