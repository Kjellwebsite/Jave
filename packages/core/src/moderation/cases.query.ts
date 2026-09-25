import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lte, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { modAction, modCases, modSource, users } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { NotFoundError } from '../kernel/errors';
import { type Page, pageSchema } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { authorize } from '../permissions/authorize';
import {
  type CaseEndReason,
  LIVE_ACTIONS,
  loadLiveCases,
  type ModCaseRecord,
  type ModSource,
  timeoutInForce,
} from './case-engine';
import { MAX_CASE_HISTORY } from './constants';
import { caseReference, type ModAction } from './copy';

export interface CasePerson {
  userId: string;
  discordId: string;
  name: string;
}

export interface ModCaseView {
  id: string;
  number: number;
  reference: string;
  action: ModAction;
  source: ModSource;
  reason: string;
  target: CasePerson;
  /** Null for automod / system cases. */
  moderator: CasePerson | null;
  durationSeconds: number | null;
  expiresAt: Date | null;
  deleteMessageDays: number | null;
  securityEventId: string | null;
  revertsCaseId: string | null;
  discordSync: ModCaseRecord['discordSync'];
  discordError: string | null;
  discordSyncedAt: Date | null;
  /** True while a timeout / quarantine / ban is in force. */
  inForce: boolean;
  endedAt: Date | null;
  endedReason: CaseEndReason | null;
  revokedAt: Date | null;
  revokedBy: CasePerson | null;
  revokeReason: string | null;
  createdAt: Date;
}

const moderatorUser = alias(users, 'moderator_user');
const revokerUser = alias(users, 'revoker_user');

interface PersonRow {
  id: string;
  discordId: string;
  username: string;
  displayName: string | null;
}

const person = (row: PersonRow | null): CasePerson | null =>
  row ? { userId: row.id, discordId: row.discordId, name: row.displayName ?? row.username } : null;

function caseQuery(ctx: ServiceContext) {
  return ctx.db
    .select({
      record: modCases,
      target: {
        id: users.id,
        discordId: users.discordId,
        username: users.username,
        displayName: users.displayName,
      },
      moderator: {
        id: moderatorUser.id,
        discordId: moderatorUser.discordId,
        username: moderatorUser.username,
        displayName: moderatorUser.displayName,
      },
      revoker: {
        id: revokerUser.id,
        discordId: revokerUser.discordId,
        username: revokerUser.username,
        displayName: revokerUser.displayName,
      },
    })
    .from(modCases)
    .innerJoin(users, eq(users.id, modCases.targetUserId))
    .leftJoin(moderatorUser, eq(moderatorUser.id, modCases.moderatorUserId))
    .leftJoin(revokerUser, eq(revokerUser.id, modCases.revokedByUserId));
}

type CaseRow = Awaited<ReturnType<ReturnType<typeof caseQuery>['where']>>[number];

function inForce(record: ModCaseRecord, now: Date): boolean {
  if (record.endedAt || !(LIVE_ACTIONS as readonly string[]).includes(record.action)) return false;
  return record.action === 'timeout' ? timeoutInForce(record, now) : true;
}

function toView(row: CaseRow, now: Date): ModCaseView {
  const { record } = row;
  return {
    id: record.id,
    number: record.number,
    reference: caseReference(record.number),
    action: record.action,
    source: record.source,
    reason: record.reason,
    target: person(row.target) ?? { userId: record.targetUserId, discordId: '', name: '' },
    moderator: person(row.moderator),
    durationSeconds: record.durationSeconds,
    expiresAt: record.expiresAt,
    deleteMessageDays: record.deleteMessageDays,
    securityEventId: record.securityEventId,
    revertsCaseId: record.revertsCaseId,
    discordSync: record.discordSync,
    discordError: record.discordError,
    discordSyncedAt: record.discordSyncedAt,
    inForce: inForce(record, now),
    endedAt: record.endedAt,
    endedReason: record.endedReason,
    revokedAt: record.revokedAt,
    revokedBy: person(row.revoker),
    revokeReason: record.revokeReason,
    createdAt: record.createdAt,
  };
}

/** Load one case view without authorization (internal). */
export async function loadCaseView(ctx: ServiceContext, caseId: string): Promise<ModCaseView> {
  const [row] = await caseQuery(ctx).where(eq(modCases.id, caseId));
  if (!row) throw new NotFoundError('Case');
  return toView(row, ctx.clock.now());
}

export async function getCase(ctx: ServiceContext, caseId: string): Promise<ModCaseView> {
  const id = parseInput(z.uuid(), caseId);
  await authorize(ctx, 'canModerate', { type: 'mod_case', id });
  return loadCaseView(ctx, id);
}

export const listCasesSchema = pageSchema.extend({
  targetUserId: z.uuid().optional(),
  moderatorUserId: z.uuid().optional(),
  action: z.enum(modAction.enumValues).optional(),
  source: z.enum(modSource.enumValues).optional(),
  /** Only timeouts / quarantines / bans that have not ended. */
  liveOnly: z.boolean().default(false),
  includeRevoked: z.boolean().default(true),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
});

export async function listCases(
  ctx: ServiceContext,
  input: z.input<typeof listCasesSchema> = {},
): Promise<Page<ModCaseView>> {
  const q = parseInput(listCasesSchema, input);
  await authorize(ctx, 'canModerate', { type: 'mod_case' });
  const filters: SQL[] = [];
  if (q.targetUserId) filters.push(eq(modCases.targetUserId, q.targetUserId));
  if (q.moderatorUserId) filters.push(eq(modCases.moderatorUserId, q.moderatorUserId));
  if (q.action) filters.push(eq(modCases.action, q.action));
  if (q.source) filters.push(eq(modCases.source, q.source));
  if (q.liveOnly) {
    filters.push(isNull(modCases.endedAt), inArray(modCases.action, [...LIVE_ACTIONS]));
  }
  if (!q.includeRevoked) filters.push(isNull(modCases.revokedAt));
  if (q.since) filters.push(gte(modCases.createdAt, q.since));
  if (q.until) filters.push(lte(modCases.createdAt, q.until));
  const where = filters.length ? and(...filters) : undefined;
  const now = ctx.clock.now();
  const [rows, [total]] = await Promise.all([
    caseQuery(ctx)
      .where(where)
      .orderBy(desc(modCases.createdAt), desc(modCases.number))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db.select({ value: count() }).from(modCases).where(where),
  ]);
  return {
    items: rows.map((row) => toView(row, now)),
    total: total?.value ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}

export interface CaseHistorySummary {
  /** Unrevoked warnings. */
  warnings: number;
  timeoutUntil: Date | null;
  quarantined: boolean;
  banned: boolean;
  totalCases: number;
}

export interface CaseHistory {
  target: CasePerson;
  summary: CaseHistorySummary;
  /** Most recent first, capped. */
  cases: ModCaseView[];
}

export const caseHistorySchema = z
  .object({
    targetUserId: z.uuid().optional(),
    targetDiscordId: z
      .string()
      .regex(/^\d{17,20}$/)
      .optional(),
  })
  .refine((v) => Boolean(v.targetUserId) !== Boolean(v.targetDiscordId), {
    message: 'Give exactly one of targetUserId or targetDiscordId.',
  });

/** A member's full moderation record (staff only). */
export async function getCaseHistory(
  ctx: ServiceContext,
  input: z.input<typeof caseHistorySchema>,
): Promise<CaseHistory> {
  const q = parseInput(caseHistorySchema, input);
  await authorize(ctx, 'canModerate', {
    type: 'user',
    id: q.targetUserId ?? q.targetDiscordId ?? null,
  });
  const [user] = await ctx.db
    .select()
    .from(users)
    .where(
      q.targetUserId ? eq(users.id, q.targetUserId) : eq(users.discordId, q.targetDiscordId ?? ''),
    );
  if (!user) throw new NotFoundError('User');
  const now = ctx.clock.now();
  const [rows, [totals]] = await Promise.all([
    caseQuery(ctx)
      .where(eq(modCases.targetUserId, user.id))
      .orderBy(desc(modCases.createdAt), desc(modCases.number))
      .limit(MAX_CASE_HISTORY),
    ctx.db.select({ value: count() }).from(modCases).where(eq(modCases.targetUserId, user.id)),
  ]);
  const cases = rows.map((row) => toView(row, now));
  const live = await loadLiveCases(ctx, user.id);
  const [warnings] = await ctx.db
    .select({ value: count() })
    .from(modCases)
    .where(
      and(
        eq(modCases.targetUserId, user.id),
        eq(modCases.action, 'warn'),
        isNull(modCases.revokedAt),
      ),
    );
  return {
    target: {
      userId: user.id,
      discordId: user.discordId,
      name: user.displayName ?? user.username,
    },
    summary: {
      warnings: warnings?.value ?? 0,
      timeoutUntil: timeoutInForce(live.timeout, now) ? (live.timeout?.expiresAt ?? null) : null,
      quarantined: live.quarantine !== null,
      banned: live.ban !== null,
      totalCases: totals?.value ?? 0,
    },
    cases,
  };
}

/** Cases linked to a security event (for the event detail view). */
export async function casesForSecurityEvent(
  ctx: ServiceContext,
  securityEventId: string,
): Promise<ModCaseView[]> {
  const now = ctx.clock.now();
  const rows = await caseQuery(ctx)
    .where(and(isNotNull(modCases.securityEventId), eq(modCases.securityEventId, securityEventId)))
    .orderBy(desc(modCases.createdAt));
  return rows.map((row) => toView(row, now));
}
