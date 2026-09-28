'use server';

import { revalidatePath } from 'next/cache';
import { integrations, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formEnum, formOptional, formString, formStrings } from '@/lib/form-data';
import { PROVIDER_LABELS, type SecretActionState } from '@/lib/integration-view';
import { runAction } from '@/server/actions';
import { nullableText, uuidField } from '@/server/projects/form-input';

const INTEGRATION_FIELDS = ['provider', 'name', 'slug', 'relayChannelId', 'config'] as const;
const OUTBOUND_FIELDS = ['name', 'url', 'eventTypes'] as const;

function refresh(): void {
  revalidatePath('/integrations');
}

/**
 * Runs a secret-issuing action. The secret travels back once, in this
 * response only, to the operator who asked for it; it is never logged or
 * stored in plaintext (core keeps it AES-256-GCM encrypted).
 */
async function withSecret(
  action: string,
  work: Parameters<typeof runAction>[1],
  holder: { secret: string | null },
  fieldNames: readonly string[] = [],
): Promise<SecretActionState> {
  const state = await runAction(action, work, { fieldNames });
  return state.status === 'success' && holder.secret ? { ...state, secret: holder.secret } : state;
}

type ConfigScalar = string | number | boolean;

function isScalar(value: unknown): value is ConfigScalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * Non-secret config from the form: only the Discord relay channel is edited
 * here; other stored keys are kept as they are (core validates the result).
 */
function relayConfig(
  data: FormData,
  current: Record<string, unknown> = {},
): Record<string, ConfigScalar> {
  const kept = Object.entries(current).filter(
    (entry): entry is [string, ConfigScalar] =>
      entry[0] !== integrations.RELAY_CHANNEL_KEY && isScalar(entry[1]),
  );
  const channel = nullableText(data, 'relayChannelId');
  return Object.fromEntries(channel ? [...kept, [integrations.RELAY_CHANNEL_KEY, channel]] : kept);
}

export async function createIntegrationAction(
  _: SecretActionState,
  data: FormData,
): Promise<SecretActionState> {
  const holder = { secret: null as string | null };
  return withSecret(
    'integration.create',
    async (ctx) => {
      const provider = formEnum(data, 'provider', integrations.INTEGRATION_PROVIDERS);
      if (!provider) {
        throw new ValidationError('Choose a provider.', [
          { path: 'provider', message: 'Choose a provider.' },
        ]);
      }
      const created = await integrations.createIntegration(ctx, {
        provider,
        name: formString(data, 'name'),
        slug: formString(data, 'slug'),
        config: relayConfig(data),
      });
      holder.secret = created.signingSecret;
      refresh();
      return created.signingSecret
        ? `INTEGRATION CREATED — ${created.integration.name}. Copy the signing secret now; it is not shown again.`
        : `INTEGRATION CREATED — ${created.integration.name} — ${PROVIDER_LABELS[provider]} deliveries are verified with GITHUB_WEBHOOK_SECRET. On GitHub, paste the endpoint URL and set Content type to application/json.`;
    },
    holder,
    INTEGRATION_FIELDS,
  );
}

export async function updateIntegrationAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction(
    'integration.update',
    async (ctx) => {
      const integrationId = uuidField(data, 'integrationId', 'integration');
      const current = await integrations.getIntegration(ctx, { integrationId });
      const updated = await integrations.updateIntegration(ctx, {
        integrationId,
        name: formString(data, 'name'),
        config: relayConfig(data, current.config),
      });
      refresh();
      return `INTEGRATION UPDATED — ${updated.name}.`;
    },
    { fieldNames: INTEGRATION_FIELDS },
  );
}

export async function rotateIntegrationSecretAction(
  _: SecretActionState,
  data: FormData,
): Promise<SecretActionState> {
  const holder = { secret: null as string | null };
  return withSecret(
    'integration.rotate_secret',
    async (ctx) => {
      const rotated = await integrations.rotateIntegrationSecret(ctx, {
        integrationId: uuidField(data, 'integrationId', 'integration'),
      });
      holder.secret = rotated.signingSecret;
      refresh();
      return `SECRET ROTATED — ${rotated.integration.name}. The previous secret no longer verifies.`;
    },
    holder,
  );
}

export async function setIntegrationEnabledAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction('integration.set_enabled', async (ctx) => {
    const enabled = formString(data, 'enabled') === 'true';
    const updated = await integrations.setIntegrationEnabled(ctx, {
      integrationId: uuidField(data, 'integrationId', 'integration'),
      enabled,
    });
    refresh();
    return enabled
      ? `INTEGRATION ENABLED — ${updated.name}.`
      : `INTEGRATION DISABLED — ${updated.name} — its endpoint answers 404.`;
  });
}

export async function retryDeliveryAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('integration.retry_delivery', async (ctx) => {
    const delivery = await integrations.retryWebhookDelivery(ctx, {
      deliveryId: uuidField(data, 'deliveryId', 'delivery'),
    });
    refresh();
    return `DELIVERY REQUEUED — ${delivery.eventType}.`;
  });
}

export async function createOutboundAction(
  _: SecretActionState,
  data: FormData,
): Promise<SecretActionState> {
  const holder = { secret: null as string | null };
  return withSecret(
    'integration.outbound_create',
    async (ctx) => {
      const created = await integrations.createOutboundWebhook(ctx, {
        name: formString(data, 'name'),
        url: formString(data, 'url'),
        eventTypes: formStrings(data, 'eventTypes'),
      });
      holder.secret = created.signingSecret;
      refresh();
      return `WEBHOOK CREATED — ${created.webhook.name}. Copy the signing secret now; it is not shown again.`;
    },
    holder,
    OUTBOUND_FIELDS,
  );
}

export async function updateOutboundAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'integration.outbound_update',
    async (ctx) => {
      const updated = await integrations.updateOutboundWebhook(ctx, {
        webhookId: uuidField(data, 'webhookId', 'webhook'),
        name: formString(data, 'name'),
        // Blank keeps the stored URL (it is never sent back to the browser in full).
        url: formOptional(data, 'url'),
        eventTypes: formStrings(data, 'eventTypes'),
      });
      refresh();
      return `WEBHOOK UPDATED — ${updated.name}.`;
    },
    { fieldNames: OUTBOUND_FIELDS },
  );
}

export async function setOutboundEnabledAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction('integration.outbound_set_enabled', async (ctx) => {
    const enabled = formString(data, 'enabled') === 'true';
    const updated = await integrations.updateOutboundWebhook(ctx, {
      webhookId: uuidField(data, 'webhookId', 'webhook'),
      enabled,
    });
    refresh();
    return enabled
      ? `WEBHOOK ENABLED — ${updated.name} — failure streak cleared.`
      : `WEBHOOK DISABLED — ${updated.name}.`;
  });
}

export async function rotateOutboundSecretAction(
  _: SecretActionState,
  data: FormData,
): Promise<SecretActionState> {
  const holder = { secret: null as string | null };
  return withSecret(
    'integration.outbound_rotate_secret',
    async (ctx) => {
      const rotated = await integrations.rotateOutboundSecret(ctx, {
        webhookId: uuidField(data, 'webhookId', 'webhook'),
      });
      holder.secret = rotated.signingSecret;
      refresh();
      return `SECRET ROTATED — ${rotated.webhook.name}. Update the receiver before the next event.`;
    },
    holder,
  );
}

export async function deleteOutboundAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('integration.outbound_delete', async (ctx) => {
    await integrations.deleteOutboundWebhook(ctx, {
      webhookId: uuidField(data, 'webhookId', 'webhook'),
    });
    refresh();
    return 'WEBHOOK DELETED — queued deliveries are skipped.';
  });
}
