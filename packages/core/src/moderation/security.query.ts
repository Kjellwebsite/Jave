import { and, count, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  securityAction,
  securityEvents,
  securityEventSource,
  securityEventStatus,
  securityTrigger,
  type SecurityEvidence,
  users,
} from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { NotFoundError } from '../kernel/errors';
import { type Page, pageSchema } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { authorize } from '../permissions/authorize';
import { canSeeSubject, visibleSubjectCondition } from './targets';
import { getSettings } from '../settings/settings.service';
import {
  buildSecurityAlertCard,
  type SecurityActionKey,
  type SecurityAlertCard,
  type SecurityEventStatusKey,
} from './alerts';
import { casesForSecurityEvent, type CasePerson, type ModCaseView } from './cases.query';
import { securityReference } from './copy';
import type { SecurityTriggerKey } from './engine/automod';

export type SecuritySourceKey = (typeof securityEventSource.enumValues)[number];

export interface SecurityEventView {
  id: string;
  number: number;
  reference: string;
  user: CasePerson | null;
  riskScore: number;
  trigger: SecurityTriggerKey;
  source: SecuritySourceKey;
  evidence: SecurityEvidence;
  actionTaken: SecurityActionKey;
  status: SecurityEventStatusKey;
  channelId: string | null;
  reportedBy: CasePerson | null;
  reviewedBy: CasePerson | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
}

export interface SecurityEventDetail extends SecurityEventView {
  cases: ModCaseView[];
}

const reporterUser = alias(users, 'reporter_user');
const reviewerUser = alias(users, 'reviewer_user');

function eventQuery(ctx: ServiceContext) {
  return ctx.db
    .select({
      event: securityEvents,
      subject: {
        id: users.id,
        discordId: users.discordId,
        username: users.username,
        displayName: users.displayName,
      },
      reporter: {
        id: reporterUser.id,
        discordId: reporterUser.discordId,
        username: reporterUser.username,
        displayName: reporterUser.displayName,
      },
      reviewer: {
        id: reviewerUser.id,
        discordId: reviewerUser.discordId,
        username: reviewerUser.username,
        displayName: reviewerUser.displayName,
      },
    })
    .from(securityEvents)
    .leftJoin(users, eq(users.id, securityEvents.userId))
    .leftJoin(reporterUser, eq(reporterUser.id, securityEvents.reportedByUserId))
    .leftJoin(reviewerUser, eq(reviewerUser.id, securityEvents.reviewedByUserId));
}

type EventRow = Awaited<ReturnType<ReturnType<typeof eventQuery>['where']>>[number];
type PersonRow = EventRow['subject'];

const person = (row: PersonRow): CasePerson | null =>
  row ? { userId: row.id, discordId: row.discordId, name: row.displayName ?? row.username } : null;

function toView(row: EventRow): SecurityEventView {
  const { event } = row;
  return {
    id: event.id,
    number: event.number,
    reference: securityReference(event.number),
    user: person(row.subject),
    riskScore: event.riskScore,
    trigger: event.trigger,
    source: event.source,
    evidence: event.evidence,
    actionTaken: event.actionTaken,
    status: event.status,
    channelId: event.channelId,
    reportedBy: person(row.reporter),
    reviewedBy: person(row.reviewer),
    reviewedAt: event.reviewedAt,
    reviewNote: event.reviewNote,
    createdAt: event.createdAt,
  };
}

/** Internal: load one event view without authorization. */
export async function loadSecurityEventView(
  ctx: ServiceContext,
  securityEventId: string,
): Promise<SecurityEventView> {
  const [row] = await eventQuery(ctx).where(eq(securityEvents.id, securityEventId));
  if (!row) throw new NotFoundError('Security event');
  return toView(row);
}

/** One security event with the moderation cases it led to (canViewSecurityEvents). */
export async function getSecurityEvent(
  ctx: ServiceContext,
  securityEventId: string,
): Promise<SecurityEventDetail> {
  const id = parseInput(z.uuid(), securityEventId);
  await authorize(ctx, 'canViewSecurityEvents', { type: 'security_event', id });
  const view = await loadSecurityEventView(ctx, id);
  // Events about yourself or about higher-ranked staff do not exist for you.
  if (!(await canSeeSubject(ctx, view.user?.userId ?? null)))
    throw new NotFoundError('Security event');
  return { ...view, cases: await casesForSecurityEvent(ctx, id) };
}

export const listSecurityEventsSchema = pageSchema.extend({
  status: z.array(z.enum(securityEventStatus.enumValues)).max(4).optional(),
  trigger: z.enum(securityTrigger.enumValues).optional(),
  source: z.enum(securityEventSource.enumValues).optional(),
  actionTaken: z.enum(securityAction.enumValues).optional(),
  userId: z.uuid().optional(),
  minRiskScore: z.number().int().min(0).max(100).optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
});

/** Security events, newest first (canViewSecurityEvents). */
export async function listSecurityEvents(
  ctx: ServiceContext,
  input: z.input<typeof listSecurityEventsSchema> = {},
): Promise<Page<SecurityEventView>> {
  const q = parseInput(listSecurityEventsSchema, input);
  await authorize(ctx, 'canViewSecurityEvents', { type: 'security_event' });
  const filters: SQL[] = [];
  if (q.status?.length) filters.push(inArray(securityEvents.status, q.status));
  if (q.trigger) filters.push(eq(securityEvents.trigger, q.trigger));
  if (q.source) filters.push(eq(securityEvents.source, q.source));
  if (q.actionTaken) filters.push(eq(securityEvents.actionTaken, q.actionTaken));
  if (q.userId) filters.push(eq(securityEvents.userId, q.userId));
  if (q.minRiskScore !== undefined) filters.push(gte(securityEvents.riskScore, q.minRiskScore));
  if (q.since) filters.push(gte(securityEvents.createdAt, q.since));
  if (q.until) filters.push(lte(securityEvents.createdAt, q.until));
  const visible = visibleSubjectCondition(ctx, securityEvents.userId);
  if (visible) filters.push(visible);
  const where = filters.length ? and(...filters) : undefined;
  const [rows, [total]] = await Promise.all([
    eventQuery(ctx)
      .where(where)
      .orderBy(desc(securityEvents.createdAt), desc(securityEvents.number))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db.select({ value: count() }).from(securityEvents).where(where),
  ]);
  return { items: rows.map(toView), total: total?.value ?? 0, limit: q.limit, offset: q.offset };
}

/**
 * The alert card for `discord.moderation.alert` (canViewSecurityEvents; the
 * bot worker's system actor qualifies). Always reflects the current state.
 */
export async function getSecurityAlertCard(
  ctx: ServiceContext,
  securityEventId: string,
): Promise<SecurityAlertCard> {
  const id = parseInput(z.uuid(), securityEventId);
  await authorize(ctx, 'canViewSecurityEvents', { type: 'security_event', id });
  const [row] = await eventQuery(ctx).where(eq(securityEvents.id, id));
  if (!row || !(await canSeeSubject(ctx, row.event.userId))) {
    throw new NotFoundError('Security event');
  }
  const [settings, cases] = await Promise.all([
    getSettings(ctx, 'moderation'),
    casesForSecurityEvent(ctx, id),
  ]);
  const subject = person(row.subject);
  const moderator = person(row.reviewer) ?? person(row.reporter);
  return buildSecurityAlertCard({
    event: row.event,
    subject: subject && { discordId: subject.discordId, name: subject.name },
    moderator: moderator && { discordId: moderator.discordId, name: moderator.name },
    quarantineRiskScore: settings.quarantineRiskScore,
    timeoutSeconds: cases.find((c) => c.action === 'timeout')?.durationSeconds ?? null,
  });
}
