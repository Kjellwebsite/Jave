import { eq } from 'drizzle-orm';
import { integrations, webhookDeliveries } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { isJaveError } from '../kernel/errors';
import { isUuid } from '../kernel/ids';
import { recordAudit } from '../audit/audit.service';
import { type JobHandler, PermanentJobError } from '../jobs/worker';
import type { JobRecord } from '../jobs/queue';
import { MAX_ERROR_LENGTH, MAX_STATUS_REASON_LENGTH } from './constants';
import type { ProcessingResult, ProcessorRegistry } from './processors';

/** Error codes the worker dead-letters immediately (mirrors Worker.execute). */
const PERMANENT_ERROR_CODES = new Set(['VALIDATION', 'NOT_FOUND', 'FORBIDDEN', 'INVALID_STATE']);

export function isPermanentFailure(error: unknown): boolean {
  return (
    error instanceof PermanentJobError ||
    (isJaveError(error) && PERMANENT_ERROR_CODES.has(error.code))
  );
}

export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

const FINAL_STATUSES = new Set(['processed', 'ignored']);

async function recordProcessingFailure(
  ctx: ServiceContext,
  job: JobRecord,
  delivery: { id: string; integrationId: string },
  error: unknown,
): Promise<void> {
  const message = errorText(error);
  const dead = isPermanentFailure(error) || job.attempts >= job.maxAttempts;
  await withTransaction(ctx, async (t) => {
    await t.db
      .update(webhookDeliveries)
      .set({ status: dead ? 'dead' : 'failed', lastError: message, attempts: job.attempts })
      .where(eq(webhookDeliveries.id, delivery.id));
    await t.db
      .update(integrations)
      .set({
        lastErrorAt: t.clock.now(),
        lastError: `processing failed: ${message}`.slice(0, MAX_ERROR_LENGTH),
      })
      .where(eq(integrations.id, delivery.integrationId));
    if (dead) {
      await recordAudit(t, {
        action: 'webhook.delivery_dead',
        targetType: 'webhook_delivery',
        targetId: delivery.id,
        result: 'failure',
        context: { attempts: job.attempts, error: message },
      });
    }
  });
}

/**
 * `integrations.process_delivery` — run the provider's processor for one
 * stored delivery. Status moves received → processing → processed/ignored,
 * or failed (retrying with the queue's backoff) → dead after the last attempt.
 * The processor's effects and the final status commit together.
 */
export function createProcessDeliveryHandler(processors: ProcessorRegistry): JobHandler {
  return async (ctx, payload, job) => {
    const deliveryId = payload.deliveryId;
    if (typeof deliveryId !== 'string' || !isUuid(deliveryId)) {
      throw new PermanentJobError('deliveryId missing');
    }
    const [row] = await ctx.db
      .select({ delivery: webhookDeliveries, integration: integrations })
      .from(webhookDeliveries)
      .innerJoin(integrations, eq(integrations.id, webhookDeliveries.integrationId))
      .where(eq(webhookDeliveries.id, deliveryId));
    if (!row) throw new PermanentJobError(`delivery ${deliveryId} not found`);
    const { delivery, integration } = row;
    if (FINAL_STATUSES.has(delivery.status)) return { skipped: delivery.status };

    await ctx.db
      .update(webhookDeliveries)
      .set({ status: 'processing', attempts: job.attempts })
      .where(eq(webhookDeliveries.id, delivery.id));

    try {
      const result = await withTransaction(ctx, async (t): Promise<ProcessingResult> => {
        const outcome = integration.enabled
          ? await processors[delivery.provider](t, delivery, integration)
          : { status: 'ignored' as const, reason: 'integration disabled' };
        await t.db
          .update(webhookDeliveries)
          .set({
            status: outcome.status,
            statusReason: outcome.reason.slice(0, MAX_STATUS_REASON_LENGTH),
            lastError: null,
            processedAt: t.clock.now(),
          })
          .where(eq(webhookDeliveries.id, delivery.id));
        return outcome;
      });
      return { status: result.status, reason: result.reason };
    } catch (error) {
      await recordProcessingFailure(ctx, job, delivery, error);
      throw error;
    }
  };
}
