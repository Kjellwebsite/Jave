import { and, desc, eq, getTableColumns, inArray, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { integrations, webhookDeliveries } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  ConflictError,
  InvalidStateError,
  isUniqueViolation,
  NotFoundError,
} from '../kernel/errors';
import { type Page, pageSchema } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { enqueueJob } from '../jobs/queue';
import { authorize } from '../permissions/authorize';
import { singleLine } from '../projects/schemas';
import {
  INTEGRATION_PROVIDERS,
  integrationConfigSchema,
  type IntegrationProvider,
  integrationSlugSchema,
  usesJaveSignature,
  WEBHOOK_PATH_PREFIX,
} from './config';
import { PROCESS_DELIVERY_JOB, PROCESS_DELIVERY_MAX_ATTEMPTS } from './constants';
import { generateSigningSecret, sealSecret } from './secrets';

export type IntegrationRecord = typeof integrations.$inferSelect;
export type WebhookDeliveryRecord = typeof webhookDeliveries.$inferSelect;

/** Everything about an integration except its secret. */
export interface IntegrationView {
  id: string;
  provider: IntegrationProvider;
  name: string;
  slug: string;
  enabled: boolean;
  config: Record<string, unknown>;
  /** Where the signing secret lives: GitHub's comes from the deployment environment. */
  secretSource: 'environment' | 'generated';
  hasSecret: boolean;
  webhookPath: string;
  secretRotatedAt: Date | null;
  lastEventAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

export function toIntegrationView(row: IntegrationRecord): IntegrationView {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    slug: row.slug,
    enabled: row.enabled,
    config: row.config,
    secretSource: usesJaveSignature(row.provider) ? 'generated' : 'environment',
    hasSecret: row.secretCiphertext !== null,
    webhookPath: `${WEBHOOK_PATH_PREFIX}${row.slug}`,
    secretRotatedAt: row.secretRotatedAt,
    lastEventAt: row.lastEventAt,
    lastErrorAt: row.lastErrorAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}

export const createIntegrationSchema = z.object({
  provider: z.enum(INTEGRATION_PROVIDERS as [IntegrationProvider, ...IntegrationProvider[]]),
  name: singleLine(80, 2),
  slug: integrationSlugSchema,
  config: integrationConfigSchema.default({}),
});

export const updateIntegrationSchema = z
  .object({
    integrationId: z.uuid(),
    name: singleLine(80, 2).optional(),
    config: integrationConfigSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.config !== undefined, 'Nothing to update.');

export const integrationRefSchema = z.object({ integrationId: z.uuid() });
export const setIntegrationEnabledSchema = integrationRefSchema.extend({ enabled: z.boolean() });

export const listDeliveriesSchema = pageSchema.extend({
  integrationId: z.uuid().optional(),
  status: z.enum(['received', 'processing', 'processed', 'ignored', 'failed', 'dead']).optional(),
});

async function loadIntegration(ctx: ServiceContext, id: string): Promise<IntegrationRecord> {
  const [row] = await ctx.db.select().from(integrations).where(eq(integrations.id, id));
  if (!row) throw new NotFoundError('Integration');
  return row;
}

/**
 * Register an inbound integration. JAVE-signed providers get a signing
 * secret that is returned exactly once and stored AES-256-GCM encrypted.
 */
export async function createIntegration(
  ctx: ServiceContext,
  input: z.input<typeof createIntegrationSchema>,
): Promise<{ integration: IntegrationView; signingSecret: string | null }> {
  await authorize(ctx, 'canManageIntegrations', { type: 'integration' });
  const data = parseInput(createIntegrationSchema, input);
  const signingSecret = usesJaveSignature(data.provider) ? generateSigningSecret() : null;
  const secretCiphertext = signingSecret ? sealSecret(ctx, signingSecret) : null;
  try {
    return await withTransaction(ctx, async (t) => {
      const now = t.clock.now();
      const [row] = await t.db
        .insert(integrations)
        .values({
          provider: data.provider,
          name: data.name,
          slug: data.slug,
          config: data.config,
          secretCiphertext,
          secretRotatedAt: signingSecret ? now : null,
          createdByUserId: t.actor.kind === 'user' ? t.actor.userId : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await recordAudit(t, {
        action: 'integration.created',
        targetType: 'integration',
        targetId: row!.id,
        context: { provider: data.provider, slug: data.slug },
      });
      return { integration: toIntegrationView(row!), signingSecret };
    });
  } catch (error) {
    if (isUniqueViolation(error, 'integrations_slug_uq')) {
      throw new ConflictError('That slug is already in use.');
    }
    throw error;
  }
}

export async function updateIntegration(
  ctx: ServiceContext,
  input: z.input<typeof updateIntegrationSchema>,
): Promise<IntegrationView> {
  await authorize(ctx, 'canManageIntegrations', { type: 'integration' });
  const data = parseInput(updateIntegrationSchema, input);
  const current = await loadIntegration(ctx, data.integrationId);
  return withTransaction(ctx, async (t) => {
    const [row] = await t.db
      .update(integrations)
      .set({
        name: data.name ?? current.name,
        config: data.config ?? current.config,
        updatedAt: t.clock.now(),
      })
      .where(eq(integrations.id, current.id))
      .returning();
    await recordAudit(t, {
      action: 'integration.updated',
      targetType: 'integration',
      targetId: current.id,
      context: {
        fields: Object.keys(data).filter((key) => key !== 'integrationId'),
        config: data.config ?? null,
      },
    });
    return toIntegrationView(row!);
  });
}

/** Replace the signing secret; the new one is returned once. The old one stops working immediately. */
export async function rotateIntegrationSecret(
  ctx: ServiceContext,
  input: z.input<typeof integrationRefSchema>,
): Promise<{ integration: IntegrationView; signingSecret: string }> {
  await authorize(ctx, 'canManageIntegrations', { type: 'integration' });
  const data = parseInput(integrationRefSchema, input);
  const current = await loadIntegration(ctx, data.integrationId);
  if (!usesJaveSignature(current.provider)) {
    throw new InvalidStateError(
      'GitHub webhooks are verified with GITHUB_WEBHOOK_SECRET; rotate it in the deployment.',
    );
  }
  const signingSecret = generateSigningSecret();
  const secretCiphertext = sealSecret(ctx, signingSecret);
  return withTransaction(ctx, async (t) => {
    const now = t.clock.now();
    const [row] = await t.db
      .update(integrations)
      .set({ secretCiphertext, secretRotatedAt: now, updatedAt: now })
      .where(eq(integrations.id, current.id))
      .returning();
    await recordAudit(t, {
      action: 'integration.secret_rotated',
      targetType: 'integration',
      targetId: current.id,
    });
    return { integration: toIntegrationView(row!), signingSecret };
  });
}

export async function setIntegrationEnabled(
  ctx: ServiceContext,
  input: z.input<typeof setIntegrationEnabledSchema>,
): Promise<IntegrationView> {
  await authorize(ctx, 'canManageIntegrations', { type: 'integration' });
  const data = parseInput(setIntegrationEnabledSchema, input);
  const current = await loadIntegration(ctx, data.integrationId);
  if (current.enabled === data.enabled) return toIntegrationView(current);
  return withTransaction(ctx, async (t) => {
    const [row] = await t.db
      .update(integrations)
      .set({ enabled: data.enabled, updatedAt: t.clock.now() })
      .where(eq(integrations.id, current.id))
      .returning();
    await recordAudit(t, {
      action: data.enabled ? 'integration.enabled' : 'integration.disabled',
      targetType: 'integration',
      targetId: current.id,
    });
    return toIntegrationView(row!);
  });
}

export async function listIntegrations(ctx: ServiceContext): Promise<IntegrationView[]> {
  await authorize(ctx, 'canManageIntegrations', { type: 'integration' });
  const rows = await ctx.db.select().from(integrations).orderBy(integrations.name);
  return rows.map(toIntegrationView);
}

export async function getIntegration(
  ctx: ServiceContext,
  input: z.input<typeof integrationRefSchema>,
): Promise<IntegrationView> {
  await authorize(ctx, 'canManageIntegrations', { type: 'integration' });
  const data = parseInput(integrationRefSchema, input);
  return toIntegrationView(await loadIntegration(ctx, data.integrationId));
}

export type WebhookDeliverySummary = Omit<WebhookDeliveryRecord, 'payload' | 'signatureDigest'>;

/** Inbound delivery log (payloads omitted; fetch one delivery for its payload). */
export async function listWebhookDeliveries(
  ctx: ServiceContext,
  input: z.input<typeof listDeliveriesSchema>,
): Promise<Page<WebhookDeliverySummary>> {
  await authorize(ctx, 'canManageIntegrations', { type: 'integration' });
  const q = parseInput(listDeliveriesSchema, input);
  const filters: SQL[] = [];
  if (q.integrationId) filters.push(eq(webhookDeliveries.integrationId, q.integrationId));
  if (q.status) filters.push(eq(webhookDeliveries.status, q.status));
  const where = filters.length > 0 ? and(...filters) : undefined;
  const {
    payload: _payload,
    signatureDigest: _digest,
    ...columns
  } = getTableColumns(webhookDeliveries);
  const [rows, [total]] = await Promise.all([
    ctx.db
      .select(columns)
      .from(webhookDeliveries)
      .where(where)
      .orderBy(desc(webhookDeliveries.receivedAt), desc(webhookDeliveries.id))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db
      .select({ value: sql<number>`count(*)::int` })
      .from(webhookDeliveries)
      .where(where),
  ]);
  return { items: rows, total: total?.value ?? 0, limit: q.limit, offset: q.offset };
}

export const deliveryRefSchema = z.object({ deliveryId: z.uuid() });

export async function getWebhookDelivery(
  ctx: ServiceContext,
  input: z.input<typeof deliveryRefSchema>,
): Promise<WebhookDeliveryRecord> {
  await authorize(ctx, 'canManageIntegrations', { type: 'integration' });
  const data = parseInput(deliveryRefSchema, input);
  const [row] = await ctx.db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, data.deliveryId));
  if (!row) throw new NotFoundError('Delivery');
  return row;
}

/** Re-queue a failed or dead delivery for processing (operator action, audited). */
export async function retryWebhookDelivery(
  ctx: ServiceContext,
  input: z.input<typeof deliveryRefSchema>,
): Promise<WebhookDeliverySummary> {
  await authorize(ctx, 'canManageIntegrations', { type: 'integration' });
  const data = parseInput(deliveryRefSchema, input);
  return withTransaction(ctx, async (t) => {
    const [row] = await t.db
      .update(webhookDeliveries)
      .set({ status: 'received', lastError: null, statusReason: null })
      .where(
        and(
          eq(webhookDeliveries.id, data.deliveryId),
          inArray(webhookDeliveries.status, ['failed', 'dead']),
        ),
      )
      .returning();
    if (!row) throw new InvalidStateError('Only failed or dead deliveries can be retried.');
    await enqueueJob(
      t,
      PROCESS_DELIVERY_JOB,
      { deliveryId: row.id },
      { dedupeKey: `webhook:${row.id}`, maxAttempts: PROCESS_DELIVERY_MAX_ATTEMPTS },
    );
    await recordAudit(t, {
      action: 'webhook.delivery_retried',
      targetType: 'webhook_delivery',
      targetId: row.id,
    });
    const { payload: _payload, signatureDigest: _digest, ...summary } = row;
    return summary;
  });
}
