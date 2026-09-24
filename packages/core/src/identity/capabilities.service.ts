import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { evidence, memberCapabilities, members, rankHistory, users } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ForbiddenError, NotFoundError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { authorize, can, isSelf, requireMember } from '../permissions/authorize';
import { notify } from '../notifications/notifications.service';
import { isValidFacet, isValidRank, loadCatalog } from './ranks';
import { getMemberById } from './users.service';

const url = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value), 'must be an http(s) URL');

export const claimRankSchema = z.object({
  facetKey: z.string().max(48),
  /** Null withdraws the claim. */
  rank: z.string().max(4).nullable(),
  evidence: z
    .object({
      title: z.string().trim().min(2).max(200),
      url: url.optional(),
      description: z.string().trim().max(2000).optional(),
    })
    .optional(),
});

export type RankSource = 'evaluator' | 'trial' | 'verification' | 'system';

export const setVerifiedRankSchema = z.object({
  memberId: z.uuid(),
  facetKey: z.string().max(48),
  /** Null clears the verified rank (status reverts to CLAIMED/UNKNOWN). */
  rank: z.string().max(4).nullable(),
  reason: z.string().trim().min(3, 'A reason is required for every rank change').max(2000),
  evidenceId: z.uuid().optional(),
  source: z.enum(['evaluator', 'trial', 'verification', 'system']).default('evaluator'),
  sourceRef: z.uuid().optional(),
});

async function upsertCapability(ctx: ServiceContext, memberId: string, facetKey: string) {
  await ctx.db.insert(memberCapabilities).values({ memberId, facetKey }).onConflictDoNothing();
  const [row] = await ctx.db
    .select()
    .from(memberCapabilities)
    .where(
      and(eq(memberCapabilities.memberId, memberId), eq(memberCapabilities.facetKey, facetKey)),
    )
    .for('update');
  return row!;
}

/** Self-reported claim. Always labeled CLAIMED; never affects verified ranks. */
export async function claimRank(ctx: ServiceContext, input: z.input<typeof claimRankSchema>) {
  const actor = requireMember(ctx);
  const data = parseInput(claimRankSchema, input);
  const catalog = await loadCatalog(ctx);
  if (!isValidFacet(catalog, data.facetKey)) throw new ValidationError('Unknown capability.');
  if (data.rank !== null && !isValidRank(catalog, data.rank))
    throw new ValidationError('Unknown rank.');

  return withTransaction(ctx, async (t) => {
    const current = await upsertCapability(t, actor.memberId, data.facetKey);
    if (current.claimedRank === data.rank && !data.evidence) return current;
    const now = t.clock.now();
    let evidenceId: string | null = null;
    if (data.evidence) {
      const [row] = await t.db
        .insert(evidence)
        .values({
          memberId: actor.memberId,
          kind: 'link',
          title: data.evidence.title,
          url: data.evidence.url ?? null,
          description: data.evidence.description ?? null,
          facetKey: data.facetKey,
          createdByUserId: actor.userId,
        })
        .returning({ id: evidence.id });
      evidenceId = row!.id;
    }
    const [updated] = await t.db
      .update(memberCapabilities)
      .set({ claimedRank: data.rank, claimedAt: data.rank ? now : null })
      .where(eq(memberCapabilities.id, current.id))
      .returning();
    if (current.claimedRank !== data.rank) {
      await t.db.insert(rankHistory).values({
        memberId: actor.memberId,
        facetKey: data.facetKey,
        track: 'claimed',
        fromRank: current.claimedRank,
        toRank: data.rank,
        source: 'self',
        evidenceId,
        actorUserId: actor.userId,
        createdAt: now,
      });
      await publishEvent(t, {
        type: 'capability.claimed',
        aggregateType: 'member',
        aggregateId: actor.memberId,
        subjectMemberId: actor.memberId,
        payload: { facetKey: data.facetKey, rank: data.rank },
      });
    }
    return updated!;
  });
}

/**
 * Evaluator sets (or clears) a VERIFIED rank. Requires canModifyRanks, a
 * reason, and a different person: nobody verifies their own capability.
 */
export async function setVerifiedRank(
  ctx: ServiceContext,
  input: z.input<typeof setVerifiedRankSchema>,
) {
  const data = parseInput(setVerifiedRankSchema, input);
  await authorize(ctx, 'canModifyRanks', { type: 'member', id: data.memberId });
  if (isSelf(ctx.actor, data.memberId)) {
    await recordAudit(
      ctx,
      {
        action: 'rank.self_verification_blocked',
        targetType: 'member',
        targetId: data.memberId,
        result: 'denied',
        context: { facetKey: data.facetKey },
      },
      { durable: true },
    );
    throw new ForbiddenError(
      'You cannot verify your own capabilities. Another evaluator must do it.',
    );
  }
  const catalog = await loadCatalog(ctx);
  if (!isValidFacet(catalog, data.facetKey)) throw new ValidationError('Unknown capability.');
  if (data.rank !== null && !isValidRank(catalog, data.rank))
    throw new ValidationError('Unknown rank.');
  const member = await getMemberById(ctx, data.memberId);

  if (data.evidenceId) {
    const [ev] = await ctx.db
      .select({ memberId: evidence.memberId })
      .from(evidence)
      .where(eq(evidence.id, data.evidenceId));
    if (!ev || ev.memberId !== member.id)
      throw new ValidationError('Evidence does not belong to this member.');
  }

  const result = await withTransaction(ctx, async (t) => {
    const current = await upsertCapability(t, member.id, data.facetKey);
    if (current.verifiedRank === data.rank) return { changed: false, row: current };
    const now = t.clock.now();
    const evaluatorId = t.actor.kind === 'user' ? t.actor.userId : null;
    const [row] = await t.db
      .update(memberCapabilities)
      .set({
        verifiedRank: data.rank,
        verifiedAt: data.rank ? now : null,
        verifiedByUserId: data.rank ? evaluatorId : null,
      })
      .where(eq(memberCapabilities.id, current.id))
      .returning();
    const [history] = await t.db
      .insert(rankHistory)
      .values({
        memberId: member.id,
        facetKey: data.facetKey,
        track: 'verified',
        fromRank: current.verifiedRank,
        toRank: data.rank,
        source: data.source,
        sourceRef: data.sourceRef ?? null,
        reason: data.reason,
        evidenceId: data.evidenceId ?? null,
        actorUserId: evaluatorId,
        createdAt: now,
      })
      .returning({ id: rankHistory.id });
    if (data.evidenceId) {
      await t.db
        .update(evidence)
        .set({ status: 'accepted', reviewedAt: now, reviewedByUserId: evaluatorId })
        .where(eq(evidence.id, data.evidenceId));
    }
    await recordAudit(t, {
      action: 'rank.verified_changed',
      targetType: 'member',
      targetId: member.id,
      context: {
        facetKey: data.facetKey,
        from: current.verifiedRank,
        to: data.rank,
        reason: data.reason,
        source: data.source,
      },
    });
    await publishEvent(t, {
      type: 'capability.verified',
      aggregateType: 'member',
      aggregateId: member.id,
      subjectMemberId: member.id,
      payload: {
        facetKey: data.facetKey,
        from: current.verifiedRank,
        to: data.rank,
        source: data.source,
      },
    });
    const facet = catalog.facets.find((f) => f.key === data.facetKey)!;
    await notify(t, {
      recipientUserId: member.userId,
      type: 'rank.updated',
      title: 'RANK UPDATED',
      body: data.rank
        ? `${facet.label.toUpperCase()} — verified at ${data.rank}.`
        : `${facet.label.toUpperCase()} — verified rank cleared.`,
      data: { facetKey: data.facetKey, rank: data.rank },
      dedupeKey: `rank:${history!.id}`,
    });
    return { changed: true, row: row!, historyId: history!.id };
  });
  return result;
}

export const evaluatorNotesSchema = z.object({
  memberId: z.uuid(),
  facetKey: z.string().max(48),
  notes: z.string().trim().max(4000),
});

export async function setEvaluatorNotes(
  ctx: ServiceContext,
  input: z.input<typeof evaluatorNotesSchema>,
) {
  const data = parseInput(evaluatorNotesSchema, input);
  await authorize(ctx, 'canModifyRanks', { type: 'member', id: data.memberId });
  const catalog = await loadCatalog(ctx);
  if (!isValidFacet(catalog, data.facetKey)) throw new ValidationError('Unknown capability.');
  await getMemberById(ctx, data.memberId);
  await ctx.db
    .insert(memberCapabilities)
    .values({ memberId: data.memberId, facetKey: data.facetKey })
    .onConflictDoNothing();
  await ctx.db
    .update(memberCapabilities)
    .set({ notes: data.notes || null })
    .where(
      and(
        eq(memberCapabilities.memberId, data.memberId),
        eq(memberCapabilities.facetKey, data.facetKey),
      ),
    );
  await recordAudit(ctx, {
    action: 'rank.notes_updated',
    targetType: 'member',
    targetId: data.memberId,
    context: { facetKey: data.facetKey },
  });
}

export const submitEvidenceSchema = z.object({
  memberId: z.uuid().optional(),
  kind: z
    .enum([
      'link',
      'document',
      'project',
      'trial',
      'mission',
      'achievement',
      'contribution',
      'evaluation',
      'other',
    ])
    .default('link'),
  title: z.string().trim().min(2).max(200),
  url: url.optional(),
  description: z.string().trim().max(4000).optional(),
  facetKey: z.string().max(48).optional(),
  sourceType: z.string().max(32).optional(),
  sourceId: z.uuid().optional(),
});

/** Members submit their own evidence; staff with canModifyRanks may attach evidence to anyone. */
export async function submitEvidence(
  ctx: ServiceContext,
  input: z.input<typeof submitEvidenceSchema>,
) {
  const data = parseInput(submitEvidenceSchema, input);
  const memberId = data.memberId ?? requireMember(ctx).memberId;
  if (
    !isSelf(ctx.actor, memberId) &&
    !can(ctx, 'canModifyRanks') &&
    !can(ctx, 'canVerifyMembers')
  ) {
    await authorize(ctx, 'canModifyRanks', { type: 'member', id: memberId });
  }
  if (data.facetKey) {
    const catalog = await loadCatalog(ctx);
    if (!isValidFacet(catalog, data.facetKey)) throw new ValidationError('Unknown capability.');
  }
  await getMemberById(ctx, memberId);
  const [row] = await ctx.db
    .insert(evidence)
    .values({
      memberId,
      kind: data.kind,
      title: data.title,
      url: data.url ?? null,
      description: data.description ?? null,
      facetKey: data.facetKey ?? null,
      sourceType: data.sourceType ?? null,
      sourceId: data.sourceId ?? null,
      createdByUserId: ctx.actor.kind === 'user' ? ctx.actor.userId : null,
    })
    .returning();
  await publishEvent(ctx, {
    type: 'evidence.submitted',
    aggregateType: 'evidence',
    aggregateId: row!.id,
    subjectMemberId: memberId,
    payload: { kind: data.kind, facetKey: data.facetKey },
  });
  return row!;
}

export async function reviewEvidence(
  ctx: ServiceContext,
  input: { evidenceId: string; decision: 'accepted' | 'rejected' },
) {
  if (!can(ctx, 'canVerifyMembers'))
    await authorize(ctx, 'canModifyRanks', { type: 'evidence', id: input.evidenceId });
  const [row] = await ctx.db
    .select()
    .from(evidence)
    .where(and(eq(evidence.id, input.evidenceId), isNull(evidence.deletedAt)));
  if (!row) throw new NotFoundError('Evidence');
  if (isSelf(ctx.actor, row.memberId))
    throw new ForbiddenError('You cannot review your own evidence.');
  const [updated] = await ctx.db
    .update(evidence)
    .set({
      status: input.decision,
      reviewedAt: ctx.clock.now(),
      reviewedByUserId: ctx.actor.kind === 'user' ? ctx.actor.userId : null,
    })
    .where(eq(evidence.id, row.id))
    .returning();
  await recordAudit(ctx, {
    action: 'evidence.reviewed',
    targetType: 'evidence',
    targetId: row.id,
    context: { decision: input.decision },
  });
  await publishEvent(ctx, {
    type: 'evidence.reviewed',
    aggregateType: 'evidence',
    aggregateId: row.id,
    subjectMemberId: row.memberId,
    payload: { decision: input.decision },
  });
  return updated!;
}

export async function listEvidence(ctx: ServiceContext, memberId: string) {
  if (!isSelf(ctx.actor, memberId) && !can(ctx, 'canVerifyMembers')) {
    await authorize(ctx, 'canModifyRanks', { type: 'member', id: memberId });
  }
  return ctx.db
    .select()
    .from(evidence)
    .where(and(eq(evidence.memberId, memberId), isNull(evidence.deletedAt)))
    .orderBy(desc(evidence.createdAt))
    .limit(200);
}

export async function getRankHistory(ctx: ServiceContext, memberId: string) {
  if (!isSelf(ctx.actor, memberId))
    await authorize(ctx, 'canViewRankHistory', { type: 'member', id: memberId });
  return ctx.db
    .select({
      id: rankHistory.id,
      facetKey: rankHistory.facetKey,
      track: rankHistory.track,
      fromRank: rankHistory.fromRank,
      toRank: rankHistory.toRank,
      source: rankHistory.source,
      sourceRef: rankHistory.sourceRef,
      reason: rankHistory.reason,
      evidenceId: rankHistory.evidenceId,
      actorName: sql<string | null>`coalesce(${users.displayName}, ${users.username})`,
      createdAt: rankHistory.createdAt,
    })
    .from(rankHistory)
    .leftJoin(users, eq(users.id, rankHistory.actorUserId))
    .where(eq(rankHistory.memberId, memberId))
    .orderBy(desc(rankHistory.createdAt))
    .limit(500);
}

/** Raw capability rows for evaluator tooling (includes staff notes). */
export async function listMemberCapabilitiesForEvaluator(ctx: ServiceContext, memberId: string) {
  await authorize(ctx, 'canModifyRanks', { type: 'member', id: memberId });
  return ctx.db.select().from(memberCapabilities).where(eq(memberCapabilities.memberId, memberId));
}

/** Members with verified ranks in a facet, for the ranking board. */
export async function rankingBoard(ctx: ServiceContext, facetKey: string, limit = 50) {
  await authorize(ctx, 'canViewMembers');
  const catalog = await loadCatalog(ctx);
  if (!isValidFacet(catalog, facetKey)) throw new ValidationError('Unknown capability.');
  const rows = await ctx.db
    .select({
      memberId: members.id,
      handle: members.handle,
      displayName: members.displayName,
      verifiedRank: memberCapabilities.verifiedRank,
      verifiedAt: memberCapabilities.verifiedAt,
    })
    .from(memberCapabilities)
    .innerJoin(members, eq(members.id, memberCapabilities.memberId))
    .where(
      and(
        eq(memberCapabilities.facetKey, facetKey),
        sql`${memberCapabilities.verifiedRank} is not null`,
        eq(members.showOnLeaderboards, true),
        isNull(members.deletedAt),
      ),
    );
  const ordinal = new Map(catalog.tiers.map((t) => [t.code, t.ordinal]));
  return rows
    .sort(
      (a, b) =>
        (ordinal.get(b.verifiedRank!) ?? 0) - (ordinal.get(a.verifiedRank!) ?? 0) ||
        a.displayName.localeCompare(b.displayName),
    )
    .slice(0, limit);
}
