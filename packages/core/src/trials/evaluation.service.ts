import { eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { trialEvaluations, trialResults, trials, trialScores } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { authorize, can, isSelf, requireUser } from '../permissions/authorize';
import { ANNOUNCE_PHASE, dedupeKeys, trialRef } from './constants';
import { enqueueAnnouncement, enqueueArchive, notifyEach } from './effects';
import { assertNoConflictOfInterest } from './guards';
import { notices } from './notices';
import { findParticipation, findTeam, loadTrial, submittedTeamIds } from './repository';
import { computeTrialResults } from './results';
import { evaluateSchema, publishResultsSchema, trialIdSchema } from './schemas';
import { type ComputedResult, isPassing, type TrialOutcome, weightedScore } from './scoring';
import { assertStatus, assertTransition } from './state-machine';

export interface EvaluationReceipt {
  evaluationId: string;
  trialId: string;
  teamId: string;
  memberId: string | null;
  overallScore: number;
}

async function auditSelfEvaluation(ctx: ServiceContext, trialId: string): Promise<void> {
  await recordAudit(
    ctx,
    {
      action: 'trial.self_evaluation_blocked',
      targetType: 'trial',
      targetId: trialId,
      result: 'denied',
    },
    { durable: true },
  ).catch((error: unknown) => ctx.logger.error({ err: error }, 'failed to audit self-evaluation'));
}

function assertScoresMatchRubric(
  rubricKeys: readonly string[],
  scores: Readonly<Record<string, number>>,
): void {
  const unknown = Object.keys(scores).filter((key) => !rubricKeys.includes(key));
  if (unknown.length > 0)
    throw new ValidationError(`Unknown criterion: ${unknown.join(', ')}.`, [
      { path: 'scores', message: `unknown ${unknown.join(', ')}` },
    ]);
  // Own keys only: a criterion named like an Object.prototype member is still missing.
  const missing = rubricKeys.filter((key) => !Object.hasOwn(scores, key));
  if (missing.length > 0)
    throw new ValidationError(`Score every criterion. Missing: ${missing.join(', ')}.`, [
      { path: 'scores', message: `missing ${missing.join(', ')}` },
    ]);
}

/**
 * Score a team or an individual participant on every rubric criterion (0–10).
 * Re-evaluating replaces the evaluator's earlier assessment of that target.
 * Evaluators never assess themselves or a trial they have a stake in.
 */
export async function evaluate(
  ctx: ServiceContext,
  input: z.input<typeof evaluateSchema>,
): Promise<EvaluationReceipt> {
  const data = parseInput(evaluateSchema, input);
  await authorize(ctx, 'canEvaluateTrials', { type: 'trial', id: data.trialId });
  const actor = requireUser(ctx);
  if (data.memberId && isSelf(actor, data.memberId)) {
    await auditSelfEvaluation(ctx, data.trialId);
    throw new ForbiddenError('You cannot evaluate yourself.');
  }
  await assertNoConflictOfInterest(ctx, data.trialId, 'evaluate it');

  return withTransaction(ctx, async (t) => {
    const trial = await loadTrial(t, data.trialId, 'update');
    assertStatus(trial, ['evaluating'], 'record evaluations');
    assertScoresMatchRubric(
      trial.rubric.map((criterion) => criterion.key),
      data.scores,
    );

    let teamId: string;
    if (data.memberId) {
      const participation = await findParticipation(t, trial.id, data.memberId);
      if (!participation || participation.status !== 'selected' || !participation.teamId)
        throw new NotFoundError('Participant');
      teamId = participation.teamId;
    } else {
      const team = await findTeam(t, data.teamId!);
      if (!team || team.trialId !== trial.id) throw new NotFoundError('Team');
      teamId = team.id;
    }
    if (!(await submittedTeamIds(t, trial.id)).has(teamId))
      throw new InvalidStateError(
        'That team never submitted — its result is INCOMPLETE and cannot be scored.',
      );

    const overallScore = weightedScore(trial.rubric, data.scores);
    const now = t.clock.now();
    const memberId = data.memberId ?? null;
    const [row] = await t.db
      .insert(trialEvaluations)
      .values({
        trialId: trial.id,
        teamId,
        memberId,
        evaluatorUserId: actor.userId,
        overallScore,
        notes: data.notes || null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate(
        memberId
          ? {
              target: [
                trialEvaluations.trialId,
                trialEvaluations.memberId,
                trialEvaluations.evaluatorUserId,
              ],
              targetWhere: sql`member_id is not null`,
              set: { overallScore, notes: data.notes || null, teamId, updatedAt: now },
            }
          : {
              target: [
                trialEvaluations.trialId,
                trialEvaluations.teamId,
                trialEvaluations.evaluatorUserId,
              ],
              targetWhere: sql`member_id is null`,
              set: { overallScore, notes: data.notes || null, updatedAt: now },
            },
      )
      .returning({ id: trialEvaluations.id });
    const evaluationId = row!.id;
    await t.db.delete(trialScores).where(eq(trialScores.evaluationId, evaluationId));
    await t.db.insert(trialScores).values(
      Object.entries(data.scores).map(([criterionKey, score]) => ({
        evaluationId,
        criterionKey,
        score,
      })),
    );
    await recordAudit(t, {
      action: 'trial.evaluated',
      targetType: 'trial',
      targetId: trial.id,
      context: { teamId, memberId, overallScore, scores: data.scores },
    });
    await publishEvent(t, {
      type: 'trial.evaluation_recorded',
      aggregateType: 'trial',
      aggregateId: trial.id,
      subjectMemberId: memberId,
      payload: { ref: trialRef(trial), teamId, target: memberId ? 'individual' : 'team' },
    });
    return { evaluationId, trialId: trial.id, teamId, memberId, overallScore };
  });
}

export interface ResultRow extends ComputedResult {
  displayName: string;
  handle: string;
  teamName: string;
}

export interface ResultsView {
  trialId: string;
  published: boolean;
  results: ResultRow[];
  counts: Record<TrialOutcome, number>;
}

function countOutcomes(results: readonly ComputedResult[]): Record<TrialOutcome, number> {
  const counts: Record<TrialOutcome, number> = { distinction: 0, pass: 0, fail: 0, incomplete: 0 };
  for (const result of results) counts[result.outcome]++;
  return counts;
}

/** What publishing would produce right now. Staff with a stake cannot look. */
export async function previewResults(
  ctx: ServiceContext,
  input: z.input<typeof trialIdSchema>,
): Promise<ResultsView> {
  const { trialId } = parseInput(trialIdSchema, input);
  if (!can(ctx, 'canEvaluateTrials'))
    await authorize(ctx, 'canManageTrials', { type: 'trial', id: trialId });
  await assertNoConflictOfInterest(ctx, trialId, 'preview its results');
  const trial = await loadTrial(ctx, trialId);
  assertStatus(trial, ['evaluating', 'completed'], 'preview results');
  const snapshot = await computeTrialResults(ctx, trial);
  const byMember = new Map(snapshot.competitors.map((c) => [c.memberId, c]));
  const teamName = new Map(snapshot.teams.map((team) => [team.id, team.name]));
  return {
    trialId,
    published: trial.status === 'completed',
    results: snapshot.results.map((result) => ({
      ...result,
      displayName: byMember.get(result.memberId)?.displayName ?? '',
      handle: byMember.get(result.memberId)?.handle ?? '',
      teamName: teamName.get(result.teamId) ?? '',
    })),
    counts: countOutcomes(snapshot.results),
  };
}

/**
 * evaluating → completed. Writes one result per competitor, publishes
 * trial.result_published (and trial.passed for passing outcomes) per member,
 * trial.completed once, notifies everyone and archives the team channels.
 * Refuses while submitted work is still unevaluated unless acknowledged.
 */
export async function publishResults(
  ctx: ServiceContext,
  input: z.input<typeof publishResultsSchema>,
): Promise<ResultsView> {
  const data = parseInput(publishResultsSchema, input);
  await authorize(ctx, 'canManageTrials', { type: 'trial', id: data.trialId });
  await assertNoConflictOfInterest(ctx, data.trialId, 'publish its results');

  return withTransaction(ctx, async (t) => {
    const trial = await loadTrial(t, data.trialId, 'update');
    if (trial.status === 'completed')
      throw new ConflictError(`Results for ${trialRef(trial)} are already published.`);
    assertTransition(trial, 'completed', 'publish results');
    const snapshot = await computeTrialResults(t, trial);
    const teamName = new Map(snapshot.teams.map((team) => [team.id, team.name]));
    const unevaluated = snapshot.results.filter((r) => r.incompleteReason === 'not_evaluated');
    if (unevaluated.length > 0 && !data.acknowledgeIncomplete) {
      const names = [...new Set(unevaluated.map((r) => teamName.get(r.teamId) ?? '?'))];
      throw new InvalidStateError(
        `${unevaluated.length} participant(s) in ${names.join(', ')} have no evaluation. Evaluate them, or publish with acknowledgeIncomplete to record them as INCOMPLETE.`,
        { unevaluatedTeams: names },
      );
    }

    const now = t.clock.now();
    for (const result of snapshot.results) {
      const values = {
        teamId: result.teamId,
        teamScore: result.teamScore,
        individualScore: result.individualScore,
        finalScore: result.finalScore,
        outcome: result.outcome,
        facetKey: result.facetKey,
        recommendedRank: result.recommendedRank,
        publishedAt: now,
        updatedAt: now,
      };
      await t.db
        .insert(trialResults)
        .values({ ...values, trialId: trial.id, memberId: result.memberId, createdAt: now })
        .onConflictDoUpdate({ target: [trialResults.trialId, trialResults.memberId], set: values });
    }
    await t.db
      .update(trials)
      .set({ status: 'completed', completedAt: now })
      .where(eq(trials.id, trial.id));

    for (const result of snapshot.results) {
      await publishEvent(t, {
        type: 'trial.result_published',
        aggregateType: 'trial',
        aggregateId: trial.id,
        subjectMemberId: result.memberId,
        payload: { ref: trialRef(trial), outcome: result.outcome, finalScore: result.finalScore },
      });
      if (isPassing(result.outcome)) {
        await publishEvent(t, {
          type: 'trial.passed',
          aggregateType: 'trial',
          aggregateId: trial.id,
          subjectMemberId: result.memberId,
          payload: {
            ref: trialRef(trial),
            category: trial.category,
            outcome: result.outcome,
            facetKey: result.facetKey,
          },
        });
      }
    }
    const counts = countOutcomes(snapshot.results);
    await publishEvent(t, {
      type: 'trial.completed',
      aggregateType: 'trial',
      aggregateId: trial.id,
      payload: {
        ref: trialRef(trial),
        title: trial.title,
        category: trial.category,
        participants: snapshot.results.length,
        ...counts,
      },
    });
    const byMember = new Map(snapshot.results.map((r) => [r.memberId, r]));
    await notifyEach(t, snapshot.competitors, 'trial.result', (c) => {
      const result = byMember.get(c.memberId)!;
      return {
        ...notices.result(
          trial,
          result.outcome,
          result.finalScore,
          snapshot.passThreshold,
          result.incompleteReason,
        ),
        dedupeKey: dedupeKeys.notifyResult(trial.id, c.memberId),
        data: { trialId: trial.id, outcome: result.outcome, finalScore: result.finalScore },
      };
    });
    await recordAudit(t, {
      action: 'trial.results_published',
      targetType: 'trial',
      targetId: trial.id,
      context: { counts, acknowledgedIncomplete: unevaluated.length > 0 },
    });
    await enqueueArchive(t, trial.id);
    await enqueueAnnouncement(t, trial.id, ANNOUNCE_PHASE.final);

    const competitor = new Map(snapshot.competitors.map((c) => [c.memberId, c]));
    return {
      trialId: trial.id,
      published: true,
      results: snapshot.results.map((result) => ({
        ...result,
        displayName: competitor.get(result.memberId)?.displayName ?? '',
        handle: competitor.get(result.memberId)?.handle ?? '',
        teamName: teamName.get(result.teamId) ?? '',
      })),
      counts,
    };
  });
}
