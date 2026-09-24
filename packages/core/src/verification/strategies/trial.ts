import { eq } from 'drizzle-orm';
import { trialResults, trials } from '@jave/database';
import type { ServiceContext } from '../../kernel/context';
import { InvalidStateError, NotFoundError } from '../../kernel/errors';
import { isValidFacet, loadCatalog } from '../../identity/ranks';
import { expectOutcome } from '../repository';
import { targetKeys } from '../rules';
import type { VerificationStrategy } from '../types';
import {
  expectTarget,
  recordOutcomeEvidence,
  requireTargetId,
  withdrawOutcomeEvidence,
} from './shared';

async function loadTrialResult(ctx: ServiceContext, trialResultId: string) {
  const [row] = await ctx.db
    .select({
      memberId: trialResults.memberId,
      outcome: trialResults.outcome,
      facetKey: trialResults.facetKey,
      publishedAt: trialResults.publishedAt,
      trialTitle: trials.title,
    })
    .from(trialResults)
    .innerJoin(trials, eq(trials.id, trialResults.trialId))
    .where(eq(trialResults.id, trialResultId));
  return row ?? null;
}

function resultLabel(row: { trialTitle: string; outcome: string }): string {
  return `${row.trialTitle} — ${row.outcome.toUpperCase()}`;
}

/**
 * Trial verification: a published trial_results row of the subject.
 * Approval records accepted evidence of kind 'trial' (tagged with the result's
 * facet when it is a known facet); revocation withdraws it.
 */
export const trialStrategy: VerificationStrategy = {
  type: 'trial',
  deciderCapabilities: [],
  singleApproval: true,

  async resolveTarget(ctx, subject, target) {
    const { trialResultId } = expectTarget(target, 'trial');
    const row = await loadTrialResult(ctx, trialResultId);
    if (!row || row.memberId !== subject.id) throw new NotFoundError('Trial result');
    if (!row.publishedAt) throw new InvalidStateError('This trial result is not published yet.');
    return {
      targetType: 'trial_result',
      targetId: trialResultId,
      targetKey: targetKeys.trial(trialResultId),
      targetLabel: resultLabel(row),
      facetKey: null,
      requestedRank: null,
      defaultClaim: `Trial result: ${resultLabel(row)}.`,
    };
  },

  async approve(tx, verification, input) {
    const trialResultId = requireTargetId(verification);
    const row = await loadTrialResult(tx, trialResultId);
    if (!row || row.memberId !== verification.subjectMemberId || !row.publishedAt)
      throw new InvalidStateError('This trial result is no longer available for verification.');
    const catalog = await loadCatalog(tx);
    const facetKey = row.facetKey && isValidFacet(catalog, row.facetKey) ? row.facetKey : null;
    const evidenceId = await recordOutcomeEvidence(tx, verification, {
      kind: 'trial',
      title: `Trial result — ${resultLabel(row)}`,
      description: `Verified trial result (${input.reference}).`,
      sourceType: 'trial_result',
      sourceId: trialResultId,
      facetKey,
      decidedAt: input.decidedAt,
    });
    return {
      outcome: { kind: 'evidence', evidenceId },
      grantedRank: null,
      subjectNotified: false,
    };
  },

  async revoke(tx, _verification, stored) {
    const outcome = expectOutcome(stored, 'evidence');
    const withdrawn = await withdrawOutcomeEvidence(tx, outcome.evidenceId);
    return {
      reverted: withdrawn,
      detail: withdrawn ? 'evidence_withdrawn' : 'evidence_already_withdrawn',
      subjectNotified: false,
    };
  },
};
