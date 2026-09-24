/**
 * Make model output safe to post on Discord: no mass pings, no mention
 * syntax, no deceptive masked links, and within Discord's length limits.
 * Bots should still send with `allowedMentions: { parse: [] }` — this is the
 * second line of defense, and it also keeps the rendered text honest.
 */

export const DISCORD_MESSAGE_LIMIT = 2000;
export const DISCORD_EMBED_DESCRIPTION_LIMIT = 4096;
const ELLIPSIS = '…';
const ZERO_WIDTH_SPACE = '\u200B';

/** @everyone / @here (any case). */
const MASS_MENTION = /@(everyone|here)/gi;
/** <@123>, <@!123>, <@&123>, <#123>. */
const ENTITY_MENTION = /<(@[!&]?|#)(\d{15,25})>/g;
/** Slash-command mentions: </name sub:123>. */
const COMMAND_MENTION = /<\/([\w-]{1,32}(?: [\w-]{1,32}){0,2}):(\d{15,25})>/g;
/** Masked links: [text](https://…) — the text can impersonate a different URL. */
const MASKED_LINK = /\[([^\]\n]{1,256})\]\(\s*<?(https?:\/\/[^\s)>]{1,2048})>?\s*\)/gi;

/** Cut to at most `max` UTF-16 units without splitting a surrogate pair, adding an ellipsis. */
export function truncateForDiscord(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = Math.max(0, max - ELLIPSIS.length);
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return `${text.slice(0, cut)}${ELLIPSIS}`;
}

export function sanitizeForDiscord(text: string, max: number = DISCORD_MESSAGE_LIMIT): string {
  const neutralized = text
    .replace(MASS_MENTION, `@${ZERO_WIDTH_SPACE}$1`)
    .replace(ENTITY_MENTION, `<${ZERO_WIDTH_SPACE}$1$2>`)
    .replace(COMMAND_MENTION, `<${ZERO_WIDTH_SPACE}/$1:$2>`)
    .replace(MASKED_LINK, (_match, label: string, url: string) => `${label} (<${url}>)`);
  return truncateForDiscord(neutralized, max);
}
