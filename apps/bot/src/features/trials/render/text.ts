import type { APIEmbed } from 'discord.js';
import { escapeMarkdown, neutralizeMentions } from '../../../ui/format';
import { LIMITS } from '../../../ui/theme';

/** Discord caps the combined text of every embed in one message. */
export const MESSAGE_EMBED_TEXT_LIMIT = 6000;
/** Discord caps the number of embeds in one message. */
export const MESSAGE_EMBEDS_MAX = 10;
/** Room left in an embed description for a heading line above a chunk. */
const CHUNK_HEADROOM = 96;
/** A description chunk that always fits an embed, with headroom. */
export const DESCRIPTION_CHUNK = LIMITS.embedDescription - CHUNK_HEADROOM;
const BACKSLASH = '\\';

/** Where to cut `line` at most `max` characters in without separating an escape from its character. */
function cutIndex(line: string, max: number): number {
  let cut = max;
  while (cut > 0 && line[cut - 1] === BACKSLASH) cut--;
  if (cut > 0) return cut;
  // The whole prefix is backslashes: escaped backslashes come in pairs, keep them paired.
  return max - (max % 2) || max;
}

/**
 * Escape untrusted text for Discord (markdown and mentions) WITHOUT clipping,
 * then split it into chunks of at most `max` characters — on line breaks
 * when possible. Used where dropping text is not acceptable (a mission
 * brief, an operative's guardrails).
 */
export function safeChunks(text: string, max: number = DESCRIPTION_CHUNK): string[] {
  return splitText(neutralizeMentions(escapeMarkdown(text)), max);
}

/**
 * Split already-safe text (escaped user text plus JAVE's own markup) into
 * chunks of at most `max` characters, on line breaks when possible.
 */
export function splitText(safe: string, max: number = DESCRIPTION_CHUNK): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of safe.split('\n')) {
    let rest = line;
    while (rest.length > max) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      const cut = cutIndex(rest, max);
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    const candidate = current ? `${current}\n${rest}` : rest;
    if (candidate.length > max) {
      chunks.push(current);
      current = rest;
    } else {
      current = candidate;
    }
  }
  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}

/** The characters Discord counts toward the per-message embed limit. */
export function embedTextLength(embed: APIEmbed): number {
  let total = (embed.title ?? '').length + (embed.description ?? '').length;
  total += (embed.footer?.text ?? '').length + (embed.author?.name ?? '').length;
  for (const field of embed.fields ?? []) total += field.name.length + field.value.length;
  return total;
}

/**
 * Group embeds into as few messages as Discord allows (≤ 10 embeds and
 * ≤ 6000 characters each), preserving order.
 */
export function packEmbeds(embeds: readonly APIEmbed[]): APIEmbed[][] {
  const messages: APIEmbed[][] = [];
  let current: APIEmbed[] = [];
  let size = 0;
  for (const embed of embeds) {
    const length = embedTextLength(embed);
    if (
      current.length > 0 &&
      (current.length >= MESSAGE_EMBEDS_MAX || size + length > MESSAGE_EMBED_TEXT_LIMIT)
    ) {
      messages.push(current);
      current = [];
      size = 0;
    }
    current.push(embed);
    size += length;
  }
  if (current.length > 0) messages.push(current);
  return messages;
}
