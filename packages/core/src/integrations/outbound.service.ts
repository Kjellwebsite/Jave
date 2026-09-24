import { and, desc, eq, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { outboundDeliveries, outboundWebhooks } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { NotFoundError, ValidationError } from '../kernel/errors';
import { type Page, pageSchema } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { DOMAIN_EVENT_TYPES, DOMAIN_EVENTS, type DomainEventType } from '../events/catalog';
import { authorize } from '../permissions/authorize';
import { getSettings } from '../settings/settings.service';
import { MAX_URL_LENGTH, singleLine } from '../projects/schemas';
import { generateSigningSecret, sealSecret } from './secrets';
import { validateOutboundUrl } from './ssrf';

export type OutboundWebhookRecord = typeof outboundWebhooks.$inferSelect;
export type OutboundDeliveryRecord = typeof outboundDeliveries.$inferSelect;

/** Only events declared `external: true` may ever leave JAVE. */
export const EXTERNAL_EVENT_TYPES: readonly DomainEventType[] = DOMAIN_EVENT_TYPES.filter(
  (type) => DOMAIN_EVENTS[type].external,
);

export function isExternalEventType(type: string): type is DomainEventType {
  return (EXTERNAL_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Subscription view. Webhook URLs often embed credentials in their path
 * (chat-app webhooks do), so only the origin is shown after creation.
 */
export interface OutboundWebhookView {
  id: string;
  name: string;
  displayUrl: string;
  eventTypes: string[];
  enabled: boolean;
  consecutiveFailures: number;
  lastDeliveryAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
  disabledAt: Date | null;
  disabledReason: string | null;
  secretRotatedAt: Date | null;
  createdAt: Date;
}

export function maskUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return url.pathname === '/' && !url.search ? url.origin : `${url.origin}/…`;
  } catch {
    return '[invalid URL]';
  }
}

export function toOutboundView(row: OutboundWebhookRecord): OutboundWebhookView {
  return {
    id: row.id,
    name: row.name,
    displayUrl: maskUrl(row.url),
    eventTypes: row.eventTypes,
    enabled: row.enabled,
    consecutiveFailures: row.consecutiveFailures,
    lastDeliveryAt: row.lastDeliveryAt,
    lastFailureAt: row.lastFailureAt,
    lastError: row.lastError,
    disabledAt: row.disabledAt,
    disabledReason: row.disabledReason,
    secretRotatedAt: row.secretRotatedAt,
    createdAt: row.createdAt,
  };
}

const eventTypesSchema = z
  .array(z.string().max(64))
  .min(1, 'Subscribe to at least one event.')
  .max(EXTERNAL_EVENT_TYPES.length)
  .refine((types) => types.every(isExternalEventType), 'Only external events can be delivered.')
  .transform((types) => [...new Set(types)]);

export const createOutboundWebhookSchema = z.object({
  name: singleLine(80, 2),
  url: z.string().trim().max(MAX_URL_LENGTH),
  eventTypes: eventTypesSchema,
});

export const updateOutboundWebhookSchema = z
  .object({
    webhookId: z.uuid(),
    name: singleLine(80, 2).optional(),
    url: z.string().trim().max(MAX_URL_LENGTH).optional(),
    eventTypes: eventTypesSchema.optional(),
    /** Re-enabling clears the failure streak and any auto-disable. */
    enabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.url !== undefined ||
      value.eventTypes !== undefined ||
      value.enabled !== undefined,
    'Nothing to update.',
  );

export const outboundRefSchema = z.object({ webhookId: z.uuid() });

export const listOutboundDeliveriesSchema = pageSchema.extend({
  webhookId: z.uuid().optional(),
  status: z.enum(['received', 'processing', 'processed', 'ignored', 'failed', 'dead']).optional(),
});

async function assertSafeTarget(ctx: ServiceContext, url: string): Promise<string> {
  const settings = await getSettings(ctx, 'integrations');
  const check = validateOutboundUrl(url, { allowInsecure: settings.allowInsecureForDev });
  if (!check.ok) throw new ValidationError(`Webhook URL rejected: ${check.reason}.`);
  return check.url.href;
}

async function loadWebhook(ctx: ServiceContext, id: string): Promise<OutboundWebhookRecord> {
  const [row] = await ctx.db.select().from(outboundWebhooks).where(eq(outboundWebhooks.id, id));
  if (!row) throw new NotFoundError('Webhook');
  return row;
}

/** Create a subscription. The signing secret is returned once and stored encrypted. */
export async function createOutboundWebhook(
  ctx: ServiceContext,
  input: z.input<typeof createOutboundWebhookSchema>,
): Promise<{ webhook: OutboundWebhookView; signingSecret: string }> {
  await authorize(ctx, 'canManageIntegrations', { type: 'outbound_webhook' });
  const data = parseInput(createOutboundWebhookSchema, input);
  const url = await assertSafeTarget(ctx, data.url);
  const signingSecret = generateSigningSecret();
  const secretCiphertext = sealSecret(ctx, signingSecret);
  return withTransaction(ctx, async (t) => {
    const now = t.clock.now();
    const [row] = await t.db
      .insert(outboundWebhooks)
      .values({
        name: data.name,
        url,
        eventTypes: data.eventTypes,
        secretCiphertext,
        secretRotatedAt: now,
        createdByUserId: t.actor.kind === 'user' ? t.actor.userId : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await recordAudit(t, {
      action: 'integration.outbound_created',
      targetType: 'outbound_webhook',
      targetId: row!.id,
      context: { target: maskUrl(url), eventTypes: data.eventTypes },
    });
    return { webhook: toOutboundView(row!), signingSecret };
  });
}

export async function updateOutboundWebhook(
  ctx: ServiceContext,
  input: z.input<typeof updateOutboundWebhookSchema>,
): Promise<OutboundWebhookView> {
  await authorize(ctx, 'canManageIntegrations', { type: 'outbound_webhook' });
  const data = parseInput(updateOutboundWebhookSchema, input);
  const current = await loadWebhook(ctx, data.webhookId);
  const url = data.url !== undefined ? await assertSafeTarget(ctx, data.url) : current.url;
  const reenabling = data.enabled === true && !current.enabled;
  return withTransaction(ctx, async (t) => {
    const [row] = await t.db
      .update(outboundWebhooks)
      .set({
        name: data.name ?? current.name,
        url,
        eventTypes: data.eventTypes ?? current.eventTypes,
        enabled: data.enabled ?? current.enabled,
        ...(reenabling ? { consecutiveFailures: 0, disabledAt: null, disabledReason: null } : {}),
        updatedAt: t.clock.now(),
      })
      .where(eq(outboundWebhooks.id, current.id))
      .returning();
    await recordAudit(t, {
      action: 'integration.outbound_updated',
      targetType: 'outbound_webhook',
      targetId: current.id,
      context: {
        fields: Object.keys(data).filter((key) => key !== 'webhookId'),
        target: maskUrl(url),
        enabled: row!.enabled,
      },
    });
    return toOutboundView(row!);
  });
}

export async function rotateOutboundSecret(
  ctx: ServiceContext,
  input: z.input<typeof outboundRefSchema>,
): Promise<{ webhook: OutboundWebhookView; signingSecret: string }> {
  await authorize(ctx, 'canManageIntegrations', { type: 'outbound_webhook' });
  const data = parseInput(outboundRefSchema, input);
  const current = await loadWebhook(ctx, data.webhookId);
  const signingSecret = generateSigningSecret();
  const secretCiphertext = sealSecret(ctx, signingSecret);
  return withTransaction(ctx, async (t) => {
    const now = t.clock.now();
    const [row] = await t.db
      .update(outboundWebhooks)
      .set({ secretCiphertext, secretRotatedAt: now, updatedAt: now })
      .where(eq(outboundWebhooks.id, current.id))
      .returning();
    await recordAudit(t, {
      action: 'integration.outbound_secret_rotated',
      targetType: 'outbound_webhook',
      targetId: current.id,
    });
    return { webhook: toOutboundView(row!), signingSecret };
  });
}

export async function deleteOutboundWebhook(
  ctx: ServiceContext,
  input: z.input<typeof outboundRefSchema>,
): Promise<void> {
  await authorize(ctx, 'canManageIntegrations', { type: 'outbound_webhook' });
  const data = parseInput(outboundRefSchema, input);
  const current = await loadWebhook(ctx, data.webhookId);
  await withTransaction(ctx, async (t) => {
    await t.db.delete(outboundWebhooks).where(eq(outboundWebhooks.id, current.id));
    await recordAudit(t, {
      action: 'integration.outbound_deleted',
      targetType: 'outbound_webhook',
      targetId: current.id,
      context: { name: current.name, target: maskUrl(current.url) },
    });
  });
}

export async function listOutboundWebhooks(ctx: ServiceContext): Promise<OutboundWebhookView[]> {
  await authorize(ctx, 'canManageIntegrations', { type: 'outbound_webhook' });
  const rows = await ctx.db.select().from(outboundWebhooks).orderBy(outboundWebhooks.name);
  return rows.map(toOutboundView);
}

export async function listOutboundDeliveries(
  ctx: ServiceContext,
  input: z.input<typeof listOutboundDeliveriesSchema>,
): Promise<Page<OutboundDeliveryRecord>> {
  await authorize(ctx, 'canManageIntegrations', { type: 'outbound_webhook' });
  const q = parseInput(listOutboundDeliveriesSchema, input);
  const filters: SQL[] = [];
  if (q.webhookId) filters.push(eq(outboundDeliveries.webhookId, q.webhookId));
  if (q.status) filters.push(eq(outboundDeliveries.status, q.status));
  const where = filters.length > 0 ? and(...filters) : undefined;
  const [rows, [total]] = await Promise.all([
    ctx.db
      .select()
      .from(outboundDeliveries)
      .where(where)
      .orderBy(desc(outboundDeliveries.createdAt), desc(outboundDeliveries.id))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db
      .select({ value: sql<number>`count(*)::int` })
      .from(outboundDeliveries)
      .where(where),
  ]);
  return { items: rows, total: total?.value ?? 0, limit: q.limit, offset: q.offset };
}
