import { and, desc, eq, gt, inArray, lte, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { sanitizeForDiscord } from '@jave/ai';
import { aiActionProposals, aiProposalStatus, aiRequests } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { MINUTE } from '../kernel/clock';
import { sha256Hex } from '../kernel/crypto';
import {
  ConflictError,
  DisabledError,
  ForbiddenError,
  InvalidStateError,
  isJaveError,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import { type Page, pageSchema } from '../kernel/pagination';
import { truncate } from '../kernel/redact';
import { parseInput } from '../kernel/validation';
import { notify } from '../notifications/notifications.service';
import type { UserActor } from '../permissions/actor';
import { authorize, can, requireUser } from '../permissions/authorize';
import { memberIdForUser } from '../research/model';
import { getSettings } from '../settings/settings.service';
import { ACTION_KIND_NAMES, getActionKind } from './actions/kinds';
import type { RegisteredActionKind } from './actions/registry';
import {
  MAX_PENDING_PROPOSALS_PER_USER,
  MAX_PREVIEW_CHARS,
  MAX_PROPOSAL_ERROR_LENGTH,
  MAX_PROPOSAL_PAYLOAD_CHARS,
  MAX_REJECTION_REASON_LENGTH,
} from './constants';

export type ProposalRecord = typeof aiActionProposals.$inferSelect;
export type ProposalStatus = ProposalRecord['status'];

export interface ProposalView {
  id: string;
  kind: string;
  status: ProposalStatus;
  preview: string;
  payload: Record<string, unknown>;
  capabilityToConfirm: string;
  requestedByUserId: string;
  aiRequestId: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  executedAt: Date | null;
  result: Record<string, unknown> | null;
  error: string | null;
  expiresAt: Date;
  createdAt: Date;
}

/** REPORT: what happened, in one calm line plus structured data. */
export interface ActionReport {
  proposalId: string;
  kind: string;
  /** `executed`, or `confirmed` when a side effect (e.g. a Discord post) is still queued. */
  status: 'executed' | 'confirmed';
  summary: string;
  data: Record<string, unknown>;
}

function toView(row: ProposalRecord, kind: RegisteredActionKind | null): ProposalView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    preview: row.preview,
    payload: row.payload,
    capabilityToConfirm: kind?.capabilityToConfirm ?? 'unknown',
    requestedByUserId: row.requestedByUserId,
    aiRequestId: row.aiRequestId,
    decidedByUserId: row.decidedByUserId,
    decidedAt: row.decidedAt,
    executedAt: row.executedAt,
    result: row.result,
    error: row.error,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/** Deterministic JSON (sorted keys) so the hash survives jsonb key reordering. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function payloadHash(payload: Record<string, unknown>): string {
  return sha256Hex(canonicalJson(payload));
}

async function requireAiEnabled(ctx: ServiceContext): Promise<void> {
  if (!(await getSettings(ctx, 'ai')).enabled) throw new DisabledError('JAVE AI');
}

async function loadProposal(ctx: ServiceContext, id: string): Promise<ProposalRecord> {
  const [row] = await ctx.db.select().from(aiActionProposals).where(eq(aiActionProposals.id, id));
  if (!row) throw new NotFoundError('Proposal');
  return row;
}

/** Can this actor act on (confirm/reject) someone's proposal of this kind? */
function mayDecide(actor: UserActor, row: ProposalRecord, kind: RegisteredActionKind): boolean {
  if (row.requestedByUserId === actor.userId) return true;
  return (
    kind.confirmableBy === 'capability' &&
    actor.capabilities.has('canConfirmAIActions') &&
    actor.capabilities.has(kind.capabilityToConfirm)
  );
}

/**
 * A user may hold at most MAX_PENDING_PROPOSALS_PER_USER live pending
 * proposals. Draft features check this before spending a model request.
 */
export async function assertProposalCapacity(ctx: ServiceContext, userId: string): Promise<void> {
  const [pending] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiActionProposals)
    .where(
      and(
        eq(aiActionProposals.requestedByUserId, userId),
        eq(aiActionProposals.status, 'pending'),
        gt(aiActionProposals.expiresAt, ctx.clock.now()),
      ),
    );
  if ((pending?.count ?? 0) >= MAX_PENDING_PROPOSALS_PER_USER) {
    throw new ConflictError('Too many pending proposals. Confirm or reject some first.');
  }
}

export const proposeActionSchema = z.object({
  kind: z.string().max(48),
  payload: z.record(z.string(), z.unknown()),
  aiRequestId: z.uuid().optional(),
});

/**
 * SUGGEST → PREVIEW. Validates the payload for its kind and stores a pending
 * proposal with a human-readable preview and an expiry. Nothing executes.
 */
export async function proposeAction(
  ctx: ServiceContext,
  input: z.input<typeof proposeActionSchema>,
): Promise<ProposalView> {
  const actor = requireUser(ctx);
  const data = parseInput(proposeActionSchema, input);
  const kind = getActionKind(data.kind);
  if (!kind)
    throw new ValidationError(`Unknown action kind. Known: ${ACTION_KIND_NAMES.join(', ')}.`);
  await authorize(ctx, 'canUseAI', { type: 'ai_proposal' });
  await authorize(ctx, kind.capabilityToPropose, { type: 'ai_proposal' });
  await requireAiEnabled(ctx);
  const payload = kind.parse(data.payload);
  if (canonicalJson(payload).length > MAX_PROPOSAL_PAYLOAD_CHARS) {
    throw new ValidationError('Proposal is too large.');
  }
  if (data.aiRequestId) {
    const [request] = await ctx.db
      .select({ userId: aiRequests.userId })
      .from(aiRequests)
      .where(eq(aiRequests.id, data.aiRequestId));
    if (request?.userId !== actor.userId) throw new ValidationError('Unknown AI request.');
  }
  await assertProposalCapacity(ctx, actor.userId);
  const now = ctx.clock.now();
  const { proposalTtlMinutes } = await getSettings(ctx, 'ai');
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(aiActionProposals)
      .values({
        kind: kind.kind,
        requestedByUserId: actor.userId,
        aiRequestId: data.aiRequestId ?? null,
        payload,
        payloadHash: payloadHash(payload),
        preview: sanitizeForDiscord(kind.preview(payload), MAX_PREVIEW_CHARS),
        status: 'pending',
        expiresAt: new Date(now.getTime() + proposalTtlMinutes * MINUTE),
        createdAt: now,
      })
      .returning();
    await recordAudit(tx, {
      action: 'ai.action_proposed',
      targetType: 'ai_proposal',
      targetId: row!.id,
      context: { kind: kind.kind, aiRequestId: data.aiRequestId ?? null },
    });
    return toView(row!, kind);
  });
}

const proposalIdSchema = z.object({ proposalId: z.uuid() });

function safeFailureMessage(error: unknown): string {
  return truncate(
    isJaveError(error) ? error.userMessage : 'Execution failed.',
    MAX_PROPOSAL_ERROR_LENGTH,
  );
}

/** Record a terminal failure outside any transaction (survives the rollback). */
async function markFailed(
  ctx: ServiceContext,
  row: ProposalRecord,
  actor: UserActor,
  reason: string,
): Promise<void> {
  await ctx.rootDb
    .update(aiActionProposals)
    .set({
      status: 'failed',
      error: reason,
      decidedByUserId: actor.userId,
      decidedAt: ctx.clock.now(),
    })
    .where(and(eq(aiActionProposals.id, row.id), eq(aiActionProposals.status, 'pending')));
  await recordAudit(
    ctx,
    {
      action: 'ai.action_failed',
      targetType: 'ai_proposal',
      targetId: row.id,
      context: { kind: row.kind, reason },
      result: 'failure',
    },
    { durable: true },
  );
}

async function authorizeDecision(
  ctx: ServiceContext,
  actor: UserActor,
  row: ProposalRecord,
  kind: RegisteredActionKind,
): Promise<void> {
  const target = { type: 'ai_proposal', id: row.id };
  const isRequester = row.requestedByUserId === actor.userId;
  if (kind.confirmableBy === 'requester' && !isRequester) {
    await recordAudit(
      ctx,
      {
        action: 'access.denied',
        targetType: target.type,
        targetId: row.id,
        context: { reason: 'requester_only', kind: kind.kind },
        result: 'denied',
      },
      { durable: true },
    );
    throw new ForbiddenError('Only the member who asked can confirm this proposal.');
  }
  if (!isRequester) await authorize(ctx, 'canConfirmAIActions', target);
  await authorize(ctx, kind.capabilityToConfirm, target);
}

/**
 * CONFIRM → EXECUTE → REPORT. The confirming human must hold the kind's
 * capability; the proposal must be pending and unexpired; the stored payload
 * must match the previewed hash and re-validate. Execution, audit, event and
 * notification commit together. Exactly one concurrent confirmation wins.
 */
export async function confirmProposal(
  ctx: ServiceContext,
  input: { proposalId: string },
): Promise<ActionReport> {
  const actor = requireUser(ctx);
  const { proposalId } = parseInput(proposalIdSchema, input);
  const row = await loadProposal(ctx, proposalId);
  const kind = getActionKind(row.kind);
  if (!kind) throw new InvalidStateError('This proposal kind is no longer supported.');
  await authorizeDecision(ctx, actor, row, kind);
  await requireAiEnabled(ctx);
  const now = ctx.clock.now();
  if (row.status !== 'pending') {
    throw new InvalidStateError(`This proposal is already ${row.status}.`);
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    await ctx.rootDb
      .update(aiActionProposals)
      .set({ status: 'expired' })
      .where(and(eq(aiActionProposals.id, row.id), eq(aiActionProposals.status, 'pending')));
    throw new InvalidStateError('This proposal expired. Ask JAVE to draft it again.');
  }
  if (payloadHash(row.payload) !== row.payloadHash) {
    await markFailed(ctx, row, actor, 'Payload changed after preview.');
    throw new ConflictError('This proposal changed after it was previewed and was not executed.');
  }
  let payload: Record<string, unknown>;
  try {
    payload = kind.parse(row.payload);
  } catch (error) {
    await markFailed(ctx, row, actor, safeFailureMessage(error));
    throw error;
  }
  await kind.authorizeExecution(ctx, payload);

  let claimed = false;
  try {
    return await withTransaction(ctx, async (tx) => {
      const [claim] = await tx.db
        .update(aiActionProposals)
        .set({ status: 'confirmed', decidedByUserId: actor.userId, decidedAt: now })
        .where(
          and(
            eq(aiActionProposals.id, row.id),
            eq(aiActionProposals.status, 'pending'),
            gt(aiActionProposals.expiresAt, now),
          ),
        )
        .returning({ id: aiActionProposals.id });
      if (!claim) throw new ConflictError('This proposal was already decided.');
      claimed = true;
      const outcome = await kind.execute(tx, payload, {
        proposalId: row.id,
        requestedByUserId: row.requestedByUserId,
      });
      const status = outcome.status === 'executed' ? 'executed' : 'confirmed';
      await tx.db
        .update(aiActionProposals)
        .set({
          status,
          executedAt: status === 'executed' ? now : null,
          result: { summary: outcome.summary, ...outcome.data },
        })
        .where(eq(aiActionProposals.id, row.id));
      await recordAudit(tx, {
        action: 'ai.action_executed',
        targetType: 'ai_proposal',
        targetId: row.id,
        context: {
          proposalId: row.id,
          kind: row.kind,
          aiRequestId: row.aiRequestId,
          requestedByUserId: row.requestedByUserId,
          outcome: outcome.status,
        },
      });
      await publishEvent(tx, {
        type: 'ai.action_executed',
        aggregateType: 'ai_proposal',
        aggregateId: row.id,
        subjectMemberId: await memberIdForUser(tx, row.requestedByUserId),
        payload: { kind: row.kind, outcome: outcome.status },
      });
      if (row.requestedByUserId !== actor.userId) {
        await notify(tx, {
          recipientUserId: row.requestedByUserId,
          type: 'ai.proposal_decided',
          title: 'AI PROPOSAL CONFIRMED',
          body: outcome.summary,
          data: { proposalId: row.id, kind: row.kind },
          dedupeKey: `ai:proposal:${row.id}:decided`,
        });
      }
      return {
        proposalId: row.id,
        kind: row.kind,
        status,
        summary: outcome.summary,
        data: outcome.data,
      };
    });
  } catch (error) {
    if (claimed) await markFailed(ctx, row, actor, safeFailureMessage(error));
    throw error;
  }
}

export const rejectProposalSchema = proposalIdSchema.extend({
  reason: z.string().trim().max(MAX_REJECTION_REASON_LENGTH).optional(),
});

/** Decline a proposal. The requester may withdraw their own. */
export async function rejectProposal(
  ctx: ServiceContext,
  input: z.input<typeof rejectProposalSchema>,
): Promise<ProposalView> {
  const actor = requireUser(ctx);
  const data = parseInput(rejectProposalSchema, input);
  const row = await loadProposal(ctx, data.proposalId);
  const kind = getActionKind(row.kind);
  if (row.requestedByUserId !== actor.userId) {
    if (!kind) throw new NotFoundError('Proposal');
    await authorizeDecision(ctx, actor, row, kind);
  }
  return withTransaction(ctx, async (tx) => {
    const now = tx.clock.now();
    const [updated] = await tx.db
      .update(aiActionProposals)
      .set({
        status: 'rejected',
        decidedByUserId: actor.userId,
        decidedAt: now,
        result: { reason: data.reason ?? null },
      })
      .where(and(eq(aiActionProposals.id, row.id), eq(aiActionProposals.status, 'pending')))
      .returning();
    if (!updated) throw new InvalidStateError(`This proposal is already ${row.status}.`);
    await recordAudit(tx, {
      action: 'ai.action_rejected',
      targetType: 'ai_proposal',
      targetId: row.id,
      context: { kind: row.kind, reason: data.reason ?? null },
    });
    if (row.requestedByUserId !== actor.userId) {
      await notify(tx, {
        recipientUserId: row.requestedByUserId,
        type: 'ai.proposal_decided',
        title: 'AI PROPOSAL DECLINED',
        body: data.reason ? `Reason: ${data.reason}` : 'A staff member declined the proposal.',
        data: { proposalId: row.id, kind: row.kind },
        dedupeKey: `ai:proposal:${row.id}:decided`,
      });
    }
    return toView(updated, kind);
  });
}

/** A proposal visible to its requester or to someone who may decide it; otherwise not found. */
export async function getProposal(
  ctx: ServiceContext,
  input: { proposalId: string },
): Promise<ProposalView> {
  const actor = requireUser(ctx);
  const { proposalId } = parseInput(proposalIdSchema, input);
  const row = await loadProposal(ctx, proposalId);
  const kind = getActionKind(row.kind);
  const visible =
    row.requestedByUserId === actor.userId || (kind !== null && mayDecide(actor, row, kind));
  if (!visible) throw new NotFoundError('Proposal');
  return toView(row, kind);
}

export const listProposalsSchema = pageSchema.extend({
  status: z.enum(aiProposalStatus.enumValues).optional(),
  scope: z.enum(['mine', 'to_confirm']).default('mine'),
});

/** Your proposals, or the pending ones you are allowed to confirm. */
export async function listProposals(
  ctx: ServiceContext,
  input: z.input<typeof listProposalsSchema> = {},
): Promise<Page<ProposalView>> {
  const actor = requireUser(ctx);
  const q = parseInput(listProposalsSchema, input);
  const filters: SQL[] = [];
  if (q.scope === 'mine') {
    filters.push(eq(aiActionProposals.requestedByUserId, actor.userId));
    if (q.status) filters.push(eq(aiActionProposals.status, q.status));
  } else {
    const confirmable = ACTION_KIND_NAMES.filter((name) => {
      const kind = getActionKind(name)!;
      return kind.confirmableBy === 'capability' && can(ctx, kind.capabilityToConfirm);
    });
    if (!can(ctx, 'canConfirmAIActions') || confirmable.length === 0) {
      return { items: [], total: 0, limit: q.limit, offset: q.offset };
    }
    filters.push(
      inArray(aiActionProposals.kind, confirmable),
      eq(aiActionProposals.status, q.status ?? 'pending'),
    );
  }
  const where = and(...filters);
  const [rows, [count]] = await Promise.all([
    ctx.db
      .select()
      .from(aiActionProposals)
      .where(where)
      .orderBy(desc(aiActionProposals.createdAt), desc(aiActionProposals.id))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(aiActionProposals)
      .where(where),
  ]);
  return {
    items: rows.map((row) => toView(row, getActionKind(row.kind))),
    total: count?.total ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}

/** Sweep: pending proposals past their expiry become `expired`. */
export async function expireProposals(ctx: ServiceContext): Promise<number> {
  const rows = await ctx.db
    .update(aiActionProposals)
    .set({ status: 'expired' })
    .where(
      and(
        eq(aiActionProposals.status, 'pending'),
        lte(aiActionProposals.expiresAt, ctx.clock.now()),
      ),
    )
    .returning({ id: aiActionProposals.id });
  return rows.length;
}
