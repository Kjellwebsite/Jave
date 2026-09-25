import type { APIActionRowComponent, APIComponentInMessageActionRow } from 'discord.js';
import type { ReplyPayload } from '../../interactions/types';

/**
 * Test helpers (TEST ONLY): read what a reply offers, the way a user would
 * see it — custom ids, labels and select options.
 */

type Row = APIActionRowComponent<APIComponentInMessageActionRow>;

function components(payload: ReplyPayload | null): Row['components'] {
  return (payload?.components ?? []).flatMap((row) => row.components);
}

/** Every custom id on the payload's buttons and selects. */
export function customIds(payload: ReplyPayload | null): string[] {
  return components(payload)
    .map((component) => ('custom_id' in component ? component.custom_id : null))
    .filter((id): id is string => id !== null);
}

/** Button labels (uppercase, as rendered). */
export function buttonLabels(payload: ReplyPayload | null): string[] {
  return components(payload)
    .map((component) => ('label' in component ? (component.label ?? null) : null))
    .filter((label): label is string => label !== null);
}

/** Option values of the select whose custom id starts with `prefix`. */
export function selectValues(payload: ReplyPayload | null, prefix: string): string[] {
  for (const component of components(payload)) {
    if ('options' in component && component.custom_id.startsWith(prefix))
      return component.options.map((option) => option.value);
  }
  return [];
}
