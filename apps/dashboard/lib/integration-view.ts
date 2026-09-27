import type { ActionState } from './action-state';

/**
 * Client-safe presentation helpers for integrations, inbound deliveries and
 * outbound webhooks. Pure: no I/O. Everything returned is plain text that
 * React renders escaped — never HTML.
 */

/** An action result that may carry a freshly issued signing secret (shown once). */
export type SecretActionState = ActionState & { secret?: string };

export type ProviderKey = 'github' | 'generic' | 'sidus' | 'supabase' | 'monitoring';
export type DeliveryStatusKey =
  'received' | 'processing' | 'processed' | 'ignored' | 'failed' | 'dead';
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export const PROVIDER_LABELS: Readonly<Record<ProviderKey, string>> = {
  github: 'GitHub',
  generic: 'Generic',
  sidus: 'Sidus',
  supabase: 'Supabase',
  monitoring: 'Monitoring',
};

export const PROVIDER_HINTS: Readonly<Record<ProviderKey, string>> = {
  github:
    'Pull requests, pushes and releases on linked repositories. Signed with the deployment secret GITHUB_WEBHOOK_SECRET.',
  generic:
    'Any sender that signs with the JAVE v1 scheme. Optionally relays a summary to a Discord channel.',
  sidus: 'Research feed. Stored and marked ignored until a processor is configured.',
  supabase: 'Database events. Stored and marked ignored until a processor is configured.',
  monitoring:
    'Uptime and alerting events. Stored and marked ignored until a processor is configured.',
};

export const DELIVERY_STATUS_LABELS: Readonly<Record<DeliveryStatusKey, string>> = {
  received: 'Received',
  processing: 'Processing',
  processed: 'Processed',
  ignored: 'Ignored',
  failed: 'Failed',
  dead: 'Dead',
};

export const DELIVERY_STATUS_TONE: Readonly<Record<DeliveryStatusKey, Tone>> = {
  received: 'info',
  processing: 'info',
  processed: 'success',
  ignored: 'neutral',
  failed: 'warning',
  dead: 'danger',
};

/** Statuses an operator can re-queue (core enforces the same rule). */
export const RETRYABLE_DELIVERY_STATUSES: readonly DeliveryStatusKey[] = ['failed', 'dead'];

/** Payloads larger than this are shown truncated (the full payload stays stored). */
export const PAYLOAD_PREVIEW_MAX_CHARS = 20_000;
const JSON_INDENT = 2;

export interface PayloadPreview {
  text: string;
  truncated: boolean;
  /** Characters in the full pretty-printed payload. */
  length: number;
}

/** Pretty-printed JSON for display, capped so a 1 MiB payload never floods the page. */
export function payloadPreview(payload: unknown, max = PAYLOAD_PREVIEW_MAX_CHARS): PayloadPreview {
  let text: string;
  try {
    text = JSON.stringify(payload, null, JSON_INDENT) ?? 'null';
  } catch {
    text = '[unprintable payload]';
  }
  return text.length > max
    ? { text: text.slice(0, max), truncated: true, length: text.length }
    : { text, truncated: false, length: text.length };
}

/** The absolute endpoint a sender posts to. */
export function webhookEndpoint(publicUrl: string, webhookPath: string): string {
  try {
    return new URL(webhookPath, publicUrl).toString();
  } catch {
    return webhookPath;
  }
}

export interface EventTypeOption {
  type: string;
  description: string;
}

export interface EventTypeGroup {
  /** The event family, e.g. `project` for `project.created`. */
  family: string;
  events: EventTypeOption[];
}

/** Catalog events grouped by family (`project.*`, `member.*`), in catalog order. */
export function groupEventTypes(options: readonly EventTypeOption[]): EventTypeGroup[] {
  const groups = new Map<string, EventTypeOption[]>();
  for (const option of options) {
    const family = option.type.split('.')[0] ?? option.type;
    const list = groups.get(family) ?? [];
    list.push(option);
    groups.set(family, list);
  }
  return [...groups].map(([family, events]) => ({ family, events }));
}

/** `1 event` / `3 events`, for a subscription row. */
export function eventCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'event' : 'events'}`;
}
