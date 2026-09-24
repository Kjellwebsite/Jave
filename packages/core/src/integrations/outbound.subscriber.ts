import { and, eq, sql } from 'drizzle-orm';
import { outboundDeliveries, outboundWebhooks } from '@jave/database';
import { withTransaction } from '../kernel/context';
import type { DomainEventRecord, EventSubscriber } from '../events/bus';
import { enqueueJob } from '../jobs/queue';
import { DELIVER_OUTBOUND_JOB, OUTBOUND_MAX_ATTEMPTS } from './constants';
import { EXTERNAL_EVENT_TYPES, isExternalEventType } from './outbound.service';

export const OUTBOUND_SUBSCRIBER = 'integrations.outbound_webhooks';

/**
 * Payload convention: an event that carries `visibility` other than
 * 'public' describes something not meant for outsiders (a private or
 * members-only project) and never leaves JAVE.
 */
export function isPubliclyVisible(event: Pick<DomainEventRecord, 'payload'>): boolean {
  const visibility = event.payload.visibility;
  return visibility === undefined || visibility === 'public';
}

/**
 * Fans each external event out to the enabled subscriptions that asked for
 * it: one outbound_deliveries row + one delivery job per subscription.
 * Idempotent: (webhook, event) is unique, so a redelivered event enqueues nothing.
 */
export const outboundWebhookSubscriber: EventSubscriber = {
  name: OUTBOUND_SUBSCRIBER,
  types: EXTERNAL_EVENT_TYPES,
  handle: async (ctx, event) => {
    if (!isExternalEventType(event.type) || !isPubliclyVisible(event)) return;
    const hooks = await ctx.db
      .select({ id: outboundWebhooks.id })
      .from(outboundWebhooks)
      .where(
        and(
          eq(outboundWebhooks.enabled, true),
          sql`${event.type} = any(${outboundWebhooks.eventTypes})`,
        ),
      );
    for (const hook of hooks) {
      await withTransaction(ctx, async (t) => {
        const [delivery] = await t.db
          .insert(outboundDeliveries)
          .values({
            webhookId: hook.id,
            eventId: event.id,
            eventType: event.type,
            createdAt: t.clock.now(),
          })
          .onConflictDoNothing()
          .returning({ id: outboundDeliveries.id });
        if (!delivery) return;
        await enqueueJob(
          t,
          DELIVER_OUTBOUND_JOB,
          { deliveryId: delivery.id },
          { dedupeKey: `outbound:${delivery.id}`, maxAttempts: OUTBOUND_MAX_ATTEMPTS },
        );
      });
    }
  },
};
