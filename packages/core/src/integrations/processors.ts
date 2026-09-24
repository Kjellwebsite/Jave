import type { ServiceContext } from '../kernel/context';
import { enqueueJob } from '../jobs/queue';
import type { IntegrationProvider } from './config';
import { relayChannelOf } from './config';
import { buildRelayPayload, DISCORD_INTEGRATIONS_RELAY_JOB } from './discord-jobs';
import type { IntegrationRecord, WebhookDeliveryRecord } from './registry.service';

export interface ProcessingResult {
  status: 'processed' | 'ignored';
  /** Stored on the delivery as statusReason. */
  reason: string;
}

/**
 * Turns one persisted inbound delivery into domain effects. Runs inside the
 * processing transaction with a system actor; throwing retries with backoff.
 * Processors must be idempotent per delivery.
 */
export type DeliveryProcessor = (
  ctx: ServiceContext,
  delivery: WebhookDeliveryRecord,
  integration: IntegrationRecord,
) => Promise<ProcessingResult>;

export type ProcessorRegistry = Readonly<Record<IntegrationProvider, DeliveryProcessor>>;

/** Explicitly unimplemented providers: stored and marked ignored, never fake-processed. */
export function unconfiguredProcessor(): DeliveryProcessor {
  return async () => ({ status: 'ignored', reason: 'no processor configured' });
}

/** Generic webhooks are stored; with a relayChannelId they are also posted to Discord. */
export const processGenericDelivery: DeliveryProcessor = async (ctx, delivery, integration) => {
  const channelId = relayChannelOf(integration.config);
  if (!channelId) return { status: 'processed', reason: 'stored' };
  await enqueueJob(
    ctx,
    DISCORD_INTEGRATIONS_RELAY_JOB,
    buildRelayPayload({
      deliveryId: delivery.id,
      channelId,
      integrationName: integration.name,
      eventType: delivery.eventType,
      payload: delivery.payload,
    }),
    { dedupeKey: `relay:${delivery.id}` },
  );
  return { status: 'processed', reason: 'stored and relayed' };
};
