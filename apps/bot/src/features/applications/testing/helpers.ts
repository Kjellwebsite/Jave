import {
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
  ComponentType,
} from 'discord.js';
import type { ModalPayload, ReplyPayload } from '../../../interactions/types';
import type { MessagePayload } from '../../../discord/gateway';
import type { FakeInteraction, RecordedResponse } from '../../../testing/fake-interaction';

/** Test-only helpers for reading rendered Discord payloads. */

type AnyPayload = ReplyPayload | MessagePayload | null | undefined;

export interface RenderedControl {
  type: 'button' | 'link' | 'select';
  label: string;
  customId: string | null;
  url: string | null;
  disabled: boolean;
  options: string[];
}

export function controls(payload: AnyPayload): RenderedControl[] {
  const rows: APIActionRowComponent<APIComponentInMessageActionRow>[] = payload?.components ?? [];
  return rows.flatMap((r) =>
    r.components.map((c): RenderedControl => {
      if (c.type === ComponentType.Button) {
        const url = 'url' in c ? (c.url ?? null) : null;
        return {
          type: url ? 'link' : 'button',
          label: 'label' in c ? (c.label ?? '') : '',
          customId: 'custom_id' in c ? c.custom_id : null,
          url,
          disabled: c.disabled ?? false,
          options: [],
        };
      }
      if (c.type === ComponentType.StringSelect) {
        return {
          type: 'select',
          label: c.placeholder ?? '',
          customId: c.custom_id,
          url: null,
          disabled: c.disabled ?? false,
          options: c.options.map((o) => o.value),
        };
      }
      return { type: 'button', label: '', customId: null, url: null, disabled: false, options: [] };
    }),
  );
}

export function buttonLabels(payload: AnyPayload): string[] {
  return controls(payload)
    .filter((c) => c.type !== 'select')
    .map((c) => c.label);
}

/** The custom id of the button labelled `label` (labels render uppercase). */
export function buttonId(payload: AnyPayload, label: string): string {
  const found = controls(payload).find(
    (c) => c.type === 'button' && c.label === label.toUpperCase(),
  );
  if (!found?.customId)
    throw new Error(`no button ${label}; have ${buttonLabels(payload).join(', ')}`);
  return found.customId;
}

export function selectControl(payload: AnyPayload): RenderedControl {
  const found = controls(payload).find((c) => c.type === 'select');
  if (!found?.customId) throw new Error('no select menu');
  return found;
}

export function modalOf(interaction: FakeInteraction): ModalPayload {
  const response = interaction.responses.find(
    (r): r is Extract<RecordedResponse, { type: 'modal' }> => r.type === 'modal',
  );
  if (!response) throw new Error(`no modal; responses: ${JSON.stringify(interaction.responses)}`);
  return response.modal;
}

/** Custom ids of every input in a modal (text inputs and selects inside labels). */
export function modalInputIds(modal: ModalPayload): string[] {
  const ids: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (typeof record.custom_id === 'string') ids.push(record.custom_id);
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  (modal.components as unknown[]).forEach(visit);
  return ids;
}

/** Plain text of a payload's embeds (titles, descriptions, fields, footers). */
export function payloadText(payload: AnyPayload): string {
  const parts: string[] = [payload?.content ?? ''];
  for (const embed of payload?.embeds ?? []) {
    parts.push(embed.author?.name ?? '', embed.title ?? '', embed.description ?? '');
    for (const f of embed.fields ?? []) parts.push(f.name, f.value);
    parts.push(embed.footer?.text ?? '');
  }
  return parts.filter(Boolean).join('\n');
}
