import type { APIEmbed } from 'discord.js';
import { clip } from '../../ui/format';

/** Discord rejects messages whose embeds hold more than 6000 characters in total. */
export const EMBED_TOTAL_CHARS = 6000;
/** A field is never clipped below this, so every field keeps a readable start. */
const MIN_FIELD_CHARS = 64;

function embedLength(embed: APIEmbed): number {
  let total =
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.author?.name.length ?? 0);
  for (const f of embed.fields ?? []) total += f.name.length + f.value.length;
  return total;
}

export function totalEmbedLength(embeds: readonly APIEmbed[]): number {
  return embeds.reduce((sum, embed) => sum + embedLength(embed), 0);
}

/**
 * Shrinks the longest field values until the embeds fit Discord's total
 * budget. Views pick sensible per-field caps; this is the final guard.
 */
export function fitEmbeds(embeds: APIEmbed[], budget = EMBED_TOTAL_CHARS): APIEmbed[] {
  const out = embeds.map((embed) => ({
    ...embed,
    fields: embed.fields?.map((f) => ({ ...f })),
  }));
  let excess = totalEmbedLength(out) - budget;
  while (excess > 0) {
    let longest: { value: string } | null = null;
    for (const embed of out)
      for (const f of embed.fields ?? [])
        if (!longest || f.value.length > longest.value.length) longest = f;
    if (!longest || longest.value.length <= MIN_FIELD_CHARS) break;
    const target = Math.max(MIN_FIELD_CHARS, longest.value.length - excess);
    const before = longest.value.length;
    longest.value = clip(longest.value, target);
    excess -= before - longest.value.length;
  }
  return out;
}
