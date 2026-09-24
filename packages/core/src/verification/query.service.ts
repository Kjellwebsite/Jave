import { and, asc, count, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { evidence, members, users, verificationEvidence, verifications } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { NotFoundError, UnauthenticatedError } from '../kernel/errors';
import type { Page } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { actorUserId } from '../permissions/actor';
import { authorize, can, isSelf, requireMember } from '../permissions/authorize';
import { findVerification } from './repository';
import { type OpenedBy, openedBy, verificationReference } from './rules';
import { listVerificationsSchema, type ListVerificationsInput } from './schemas';
import type {
  VerificationOutcome,
  VerificationRecord,
  VerificationStatus,
  VerificationType,
} from './types';

export interface VerificationPerson {
  userId: string;
  name: string;
}

export interface VerificationSummary {
  id: string;
  number: number;
  reference: string;
  type: VerificationType;
  status: VerificationStatus;
  claim: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string;
  facetKey: string | null;
  requestedRank: string | null;
  grantedRank: string | null;
  subject: { memberId: string; handle: string; displayName: string };
  openedBy: OpenedBy;
  evidenceCount: number;
  requestedAt: Date;
  expiresAt: Date | null;
  decidedAt: Date | null;
  revokedAt: Date | null;
  /** Verifiers only; null for the subject. */
  assignedVerifier: VerificationPerson | null;
}

export interface VerificationEvidenceItem {
  id: string;
  kind: string;
  title: string;
  url: string | null;
  description: string | null;
  status: string;
  createdAt: Date;
}

export interface VerificationStaffDetail {
  requestedBy: VerificationPerson | null;
  verifier: VerificationPerson | null;
  revokedBy: VerificationPerson | null;
  reviewStartedAt: Date | null;
  outcome: VerificationOutcome | null;
}

export interface VerificationDetail extends VerificationSummary {
  decisionNote: string | null;
  revokeReason: string | null;
  evidence: VerificationEvidenceItem[];
  /** Verifiers only; null for the subject. */
  staff: VerificationStaffDetail | null;
}

const MAX_EVIDENCE_LISTED = 50;

const assignee = alias(users, 'assignee');

function summarySelect(ctx: ServiceContext) {
  return ctx.db
    .select({
      verification: verifications,
      subjectUserId: members.userId,
      subjectHandle: members.handle,
      subjectDisplayName: members.displayName,
      assigneeDisplayName: assignee.displayName,
      assigneeUsername: assignee.username,
      evidenceCount: sql<number>`(select count(*)::int from ${verificationEvidence} where ${verificationEvidence.verificationId} = ${verifications.id})`,
    })
    .from(verifications)
    .innerJoin(members, eq(members.id, verifications.subjectMemberId))
    .leftJoin(assignee, eq(assignee.id, verifications.assignedVerifierUserId));
}

type SummaryRow = Awaited<ReturnType<typeof summarySelect>>[number];

function toSummary(row: SummaryRow, staffView: boolean): VerificationSummary {
  const v = row.verification;
  const assigneeName = row.assigneeDisplayName ?? row.assigneeUsername;
  return {
    id: v.id,
    number: v.number,
    reference: verificationReference(v.number),
    type: v.type,
    status: v.status,
    claim: v.claim,
    targetType: v.targetType,
    targetId: v.targetId,
    targetLabel: v.targetLabel,
    facetKey: v.facetKey,
    requestedRank: v.requestedRank,
    grantedRank: v.grantedRank,
    subject: {
      memberId: v.subjectMemberId,
      handle: row.subjectHandle,
      displayName: row.subjectDisplayName,
    },
    openedBy: openedBy({
      requestedByUserId: v.requestedByUserId,
      subjectUserId: row.subjectUserId,
    }),
    evidenceCount: row.evidenceCount,
    requestedAt: v.requestedAt,
    expiresAt: v.expiresAt,
    decidedAt: v.decidedAt,
    revokedAt: v.revokedAt,
    assignedVerifier:
      staffView && v.assignedVerifierUserId && assigneeName
        ? { userId: v.assignedVerifierUserId, name: assigneeName }
        : null,
  };
}

/**
 * The verification queue (verifiers, with filters) or the acting member's own
 * verifications. Members asking for anyone else's are refused and audited.
 */
export async function listVerifications(
  ctx: ServiceContext,
  query: ListVerificationsInput = {},
): Promise<Page<VerificationSummary>> {
  const q = parseInput(listVerificationsSchema, query);
  const staffView = can(ctx, 'canVerifyMembers');
  const filters: SQL[] = [];
  if (staffView) {
    if (q.subjectMemberId) filters.push(eq(verifications.subjectMemberId, q.subjectMemberId));
    const me = actorUserId(ctx.actor);
    if (q.assignedToMe) {
      if (!me) return { items: [], total: 0, limit: q.limit, offset: q.offset };
      filters.push(eq(verifications.assignedVerifierUserId, me));
    }
    if (q.unassigned) filters.push(isNull(verifications.assignedVerifierUserId));
  } else {
    const actor = requireMember(ctx);
    if (q.subjectMemberId && q.subjectMemberId !== actor.memberId)
      await authorize(ctx, 'canVerifyMembers', { type: 'member', id: q.subjectMemberId });
    filters.push(eq(verifications.subjectMemberId, actor.memberId));
  }
  if (q.status) {
    const statuses = Array.isArray(q.status) ? q.status : [q.status];
    filters.push(inArray(verifications.status, statuses));
  }
  if (q.type) filters.push(eq(verifications.type, q.type));
  const where = filters.length > 0 ? and(...filters) : undefined;
  const order =
    q.sort === 'oldest'
      ? [asc(verifications.requestedAt), asc(verifications.number)]
      : [desc(verifications.requestedAt), desc(verifications.number)];

  const [rows, [total]] = await Promise.all([
    summarySelect(ctx)
      .where(where)
      .orderBy(...order)
      .limit(q.limit)
      .offset(q.offset),
    ctx.db.select({ value: count() }).from(verifications).where(where),
  ]);
  return {
    items: rows.map((row) => toSummary(row, staffView)),
    total: total?.value ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}

async function peopleById(
  ctx: ServiceContext,
  ids: readonly (string | null)[],
): Promise<Map<string, VerificationPerson>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  const rows = await ctx.db
    .select({ id: users.id, displayName: users.displayName, username: users.username })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, { userId: r.id, name: r.displayName ?? r.username }]));
}

function person(map: Map<string, VerificationPerson>, id: string | null) {
  return id ? (map.get(id) ?? null) : null;
}

async function staffDetail(
  ctx: ServiceContext,
  v: VerificationRecord,
): Promise<VerificationStaffDetail> {
  const people = await peopleById(ctx, [v.requestedByUserId, v.verifierUserId, v.revokedByUserId]);
  return {
    requestedBy: person(people, v.requestedByUserId),
    verifier: person(people, v.verifierUserId),
    revokedBy: person(people, v.revokedByUserId),
    reviewStartedAt: v.reviewStartedAt,
    outcome: v.outcome,
  };
}

async function listLinkedEvidence(
  ctx: ServiceContext,
  verificationId: string,
): Promise<VerificationEvidenceItem[]> {
  return ctx.db
    .select({
      id: evidence.id,
      kind: evidence.kind,
      title: evidence.title,
      url: evidence.url,
      description: evidence.description,
      status: evidence.status,
      createdAt: evidence.createdAt,
    })
    .from(verificationEvidence)
    .innerJoin(evidence, eq(evidence.id, verificationEvidence.evidenceId))
    .where(and(eq(verificationEvidence.verificationId, verificationId), isNull(evidence.deletedAt)))
    .orderBy(asc(evidence.createdAt), asc(evidence.id))
    .limit(MAX_EVIDENCE_LISTED);
}

/**
 * One verification. Visible to its subject and to verifiers. Anyone else gets
 * NotFound (no existence oracle) and the attempt is audited.
 */
export async function getVerification(
  ctx: ServiceContext,
  verificationId: string,
): Promise<VerificationDetail> {
  const id = parseInput(z.uuid(), verificationId);
  if (ctx.actor.kind === 'anonymous') throw new UnauthenticatedError();
  const staffView = can(ctx, 'canVerifyMembers');
  const found = await findVerification(ctx, id);
  if (!found || (!staffView && !isSelf(ctx.actor, found.subjectMemberId))) {
    if (found) {
      await recordAudit(
        ctx,
        {
          action: 'access.denied',
          targetType: 'verification',
          targetId: id,
          context: { capability: 'canVerifyMembers', reason: 'not_subject' },
          result: 'denied',
        },
        { durable: true },
      ).catch((error: unknown) => ctx.logger.error({ err: error }, 'failed to audit denial'));
    }
    throw new NotFoundError('Verification');
  }
  const [[row], evidenceItems, staff] = await Promise.all([
    summarySelect(ctx).where(eq(verifications.id, id)),
    listLinkedEvidence(ctx, id),
    staffView ? staffDetail(ctx, found) : Promise.resolve(null),
  ]);
  if (!row) throw new NotFoundError('Verification');
  return {
    ...toSummary(row, staffView),
    decisionNote: found.decisionNote,
    revokeReason: found.revokeReason,
    evidence: evidenceItems,
    staff,
  };
}
