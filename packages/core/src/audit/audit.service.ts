import { and, desc, eq, gte, lte, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditLogs, users } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { redact } from '../kernel/redact';
import { parseInput } from '../kernel/validation';
import { type Page, pageSchema } from '../kernel/pagination';
import { authorize } from '../permissions/authorize';

export type AuditResult = 'success' | 'denied' | 'failure';

export interface AuditEntry {
  /** `<domain>.<verb>`, e.g. rank.verified_changed, member.banned, settings.updated */
  action: string;
  targetType?: string;
  targetId?: string | null;
  context?: Record<string, unknown>;
  result?: AuditResult;
}

function actorColumns(ctx: ServiceContext) {
  switch (ctx.actor.kind) {
    case 'user':
      return { actorType: 'user' as const, actorUserId: ctx.actor.userId };
    case 'integration':
      return { actorType: 'integration' as const, actorUserId: null };
    default:
      return { actorType: 'system' as const, actorUserId: null };
  }
}

/**
 * Append to the audit log. Context is redacted before storage. Pass
 * `{ durable: true }` to write outside the current transaction so the entry
 * survives a rollback (used for denials and failures).
 */
export async function recordAudit(
  ctx: ServiceContext,
  entry: AuditEntry,
  options: { durable?: boolean } = {},
): Promise<void> {
  const db = options.durable ? ctx.rootDb : ctx.db;
  const context: Record<string, unknown> = redact(entry.context ?? {});
  if (ctx.actor.kind === 'integration') context.integrationId = ctx.actor.integrationId;
  if (ctx.actor.kind === 'system') context.systemReason = ctx.actor.reason;
  await db.insert(auditLogs).values({
    ...actorColumns(ctx),
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    context,
    result: entry.result ?? 'success',
    requestId: ctx.requestId,
    createdAt: ctx.clock.now(),
  });
}

export const auditQuerySchema = pageSchema.extend({
  action: z.string().max(64).optional(),
  actorUserId: z.uuid().optional(),
  targetType: z.string().max(32).optional(),
  targetId: z.string().max(64).optional(),
  result: z.enum(['success', 'denied', 'failure']).optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
});

export interface AuditLogView {
  id: number;
  action: string;
  actorType: string;
  actorUserId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  context: Record<string, unknown>;
  result: AuditResult;
  requestId: string | null;
  createdAt: Date;
}

export async function listAuditLogs(
  ctx: ServiceContext,
  query: z.input<typeof auditQuerySchema>,
): Promise<Page<AuditLogView>> {
  await authorize(ctx, 'canViewAuditLogs');
  const q = parseInput(auditQuerySchema, query);
  const filters: SQL[] = [];
  if (q.action)
    filters.push(
      q.action.endsWith('*')
        ? sql`${auditLogs.action} like ${q.action.slice(0, -1) + '%'}`
        : eq(auditLogs.action, q.action),
    );
  if (q.actorUserId) filters.push(eq(auditLogs.actorUserId, q.actorUserId));
  if (q.targetType) filters.push(eq(auditLogs.targetType, q.targetType));
  if (q.targetId) filters.push(eq(auditLogs.targetId, q.targetId));
  if (q.result) filters.push(eq(auditLogs.result, q.result));
  if (q.since) filters.push(gte(auditLogs.createdAt, q.since));
  if (q.until) filters.push(lte(auditLogs.createdAt, q.until));
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [count]] = await Promise.all([
    ctx.db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        actorType: auditLogs.actorType,
        actorUserId: auditLogs.actorUserId,
        actorName: sql<string | null>`coalesce(${users.displayName}, ${users.username})`,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        context: auditLogs.context,
        result: auditLogs.result,
        requestId: auditLogs.requestId,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(where),
  ]);
  return { items: rows, total: count?.total ?? 0, limit: q.limit, offset: q.offset };
}
