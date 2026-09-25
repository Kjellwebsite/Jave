import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { evidence, memberCapabilities, trialResults } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { actorUserId } from '../permissions/actor';
import { authorize, isSelf } from '../permissions/authorize';
import { setVerifiedRank } from '../identity/capabilities.service';
import { compareRanks, isValidRank, loadCatalog } from '../identity/ranks';
import { LIMITS, trialRef } from './constants';
import { assertNoConflictOfInterest } from './guards';
import { formatScore } from './notices';
import { loadTrial } from './repository';
import { applyRankConsequenceSchema } from './schemas';
import { isPassing } from './scoring';
import { assertStatus } from './state-machine';

export interface RankConsequenceReceipt {
  trialId: string;
  memberId: string;
  facetKey: string;
  rank: string;
  rankHistoryId: string;
  evidenceId: string;
}

/**
 * Turn a passing trial result into a VERIFIED rank for the trial's primary
 * facet. Never automatic: an evaluator with canModifyRanks applies it
 * explicitly, once per result. It records trial evidence, goes through
 * `setVerifiedRank` (source 'trial', sourceRef = trial id) and stores the
 * rank-history id on the result. The rank defaults to the recommendation and
 * may be set lower, never higher: the trial is evidence for at most what it
 * measured. A trial result never lowers or repeats a verified rank.
 */
export async function applyRankConsequence(
  ctx: ServiceContext,
  input: z.input<typeof applyRankConsequenceSchema>,
): Promise<RankConsequenceReceipt> {
  const data = parseInput(applyRankConsequenceSchema, input);
  await authorize(ctx, 'canModifyRanks', { type: 'member', id: data.memberId });
  if (isSelf(ctx.actor, data.memberId)) {
    await recordAudit(
      ctx,
      {
        action: 'rank.self_verification_blocked',
        targetType: 'member',
        targetId: data.memberId,
        result: 'denied',
        context: { source: 'trial', trialId: data.trialId },
      },
      { durable: true },
    ).catch((error: unknown) => ctx.logger.error({ err: error }, 'failed to audit self-rank'));
    throw new ForbiddenError('You cannot verify your own capabilities. Another evaluator must.');
  }
  await assertNoConflictOfInterest(ctx, data.trialId, 'apply its rank consequences');
  const catalog = await loadCatalog(ctx);

  return withTransaction(ctx, async (t) => {
    const trial = await loadTrial(t, data.trialId, 'share');
    assertStatus(trial, ['completed'], 'apply rank consequences');
    const [result] = await t.db
      .select()
      .from(trialResults)
      .where(and(eq(trialResults.trialId, trial.id), eq(trialResults.memberId, data.memberId)))
      .for('update');
    if (!result || !result.publishedAt) throw new NotFoundError('Trial result');
    if (!isPassing(result.outcome))
      throw new InvalidStateError('Only a passing result carries a rank consequence.');
    if (result.rankHistoryId)
      throw new ConflictError('This result’s rank consequence was already applied.');
    if (!result.facetKey) throw new InvalidStateError('This trial maps to no capability facet.');
    const ceiling = result.recommendedRank;
    if (!ceiling || !isValidRank(catalog, ceiling))
      throw new InvalidStateError('This result carries no rank recommendation.');
    const rank = data.rank ?? ceiling;
    if (!isValidRank(catalog, rank)) throw new ValidationError('Unknown rank.');
    if (compareRanks(catalog.tiers, rank, ceiling) > 0)
      throw new ValidationError(
        `This result supports at most ${ceiling}. A higher rank is an evaluator decision, not a trial consequence.`,
        [{ path: 'rank', message: `above the recommended ${ceiling}` }],
      );

    const [current] = await t.db
      .select({ verifiedRank: memberCapabilities.verifiedRank })
      .from(memberCapabilities)
      .where(
        and(
          eq(memberCapabilities.memberId, data.memberId),
          eq(memberCapabilities.facetKey, result.facetKey),
        ),
      );
    if (current?.verifiedRank && compareRanks(catalog.tiers, current.verifiedRank, rank) >= 0)
      throw new ConflictError(
        `Already verified at ${current.verifiedRank}. A trial result never lowers or repeats a verified rank.`,
      );

    const outcomeLabel = result.outcome.toUpperCase();
    const score = result.finalScore === null ? '' : ` (${formatScore(result.finalScore)})`;
    const [record] = await t.db
      .insert(evidence)
      .values({
        memberId: data.memberId,
        kind: 'trial',
        title: `${trialRef(trial)} — ${trial.title} — ${outcomeLabel}${score}`.slice(
          0,
          LIMITS.evidenceTitle,
        ),
        description: `Trial result, ${trial.category}. Evaluated against a published rubric.`,
        facetKey: result.facetKey,
        sourceType: 'trial',
        sourceId: trial.id,
        createdByUserId: actorUserId(t.actor),
      })
      .returning({ id: evidence.id });
    const reason = data.reason ?? `${trialRef(trial)} ${trial.title}: ${outcomeLabel}${score}.`;
    const change = await setVerifiedRank(t, {
      memberId: data.memberId,
      facetKey: result.facetKey,
      rank,
      reason,
      evidenceId: record!.id,
      source: 'trial',
      sourceRef: trial.id,
    });
    if (!('historyId' in change) || !change.historyId)
      throw new ConflictError(`Already verified at ${rank}.`);
    await t.db
      .update(trialResults)
      .set({ rankHistoryId: change.historyId })
      .where(eq(trialResults.id, result.id));
    await recordAudit(t, {
      action: 'trial.rank_consequence_applied',
      targetType: 'member',
      targetId: data.memberId,
      context: {
        trialId: trial.id,
        facetKey: result.facetKey,
        rank,
        recommendedRank: result.recommendedRank,
        rankHistoryId: change.historyId,
      },
    });
    return {
      trialId: trial.id,
      memberId: data.memberId,
      facetKey: result.facetKey,
      rank,
      rankHistoryId: change.historyId,
      evidenceId: record!.id,
    };
  });
}
