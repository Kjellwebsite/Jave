import { and, asc, eq, max, ne } from 'drizzle-orm';
import type { z } from 'zod';
import { trialParticipants, trialSubmissions, trialTeams } from '@jave/database';
import { publishEvent } from '../events/bus';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  isUniqueViolation,
  NotFoundError,
} from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { authorize, requireMember } from '../permissions/authorize';
import { getMemberById } from '../identity/users.service';
import { LIMITS, trialRef } from './constants';
import { enqueueProvision } from './effects';
import { assertTrialsEnabled, eligibilityProblem, isTrialStaff } from './guards';
import { findParticipation, findTeam, loadTrial, type ParticipantStatus } from './repository';
import { applyToTrialSchema, submitSchema, trialIdSchema } from './schemas';
import { closeTime } from './timing';

export interface ApplicationView {
  trialId: string;
  status: ParticipantStatus;
  appliedAt: Date;
}

/**
 * A TRIAL / VERIFIED member (or staff) applies with a short statement.
 * Re-applying after a withdrawal is allowed while recruiting (not for staff).
 */
export async function applyToTrial(
  ctx: ServiceContext,
  input: z.input<typeof applyToTrialSchema>,
): Promise<ApplicationView> {
  const data = parseInput(applyToTrialSchema, input);
  const actor = requireMember(ctx);
  await authorize(ctx, 'canViewMembers', { type: 'trial', id: data.trialId });
  await assertTrialsEnabled(ctx);
  const member = await getMemberById(ctx, actor.memberId);
  const problem = eligibilityProblem({
    roles: actor.roles,
    standing: member.standing,
    guildStatus: member.guildStatus,
  });
  if (problem) throw new ForbiddenError(problem);

  try {
    return await withTransaction(ctx, async (t) => {
      const trial = await loadTrial(t, data.trialId, 'share');
      // Drafts are staff-only: do not confirm they exist.
      if (trial.status === 'draft') throw new NotFoundError('Trial');
      if (trial.status !== 'recruiting')
        throw new InvalidStateError(`${trialRef(trial)} is not recruiting.`);
      const now = t.clock.now();
      if (trial.recruitmentClosesAt && trial.recruitmentClosesAt.getTime() <= now.getTime())
        throw new InvalidStateError(`Recruitment for ${trialRef(trial)} has closed.`);
      const existing = await findParticipation(t, trial.id, actor.memberId);
      if (existing && existing.status !== 'withdrawn')
        throw new ConflictError(`You already applied to ${trialRef(trial)}.`);
      // Staff can read a trial's sealed brief. Whoever wrote it never competes in it, and
      // staff who stepped out (and could then read it) cannot step back in.
      if (trial.createdByUserId === actor.userId)
        throw new ForbiddenError('You created this trial, so you cannot compete in it.');
      if (trial.editorUserIds.includes(actor.userId))
        throw new ForbiddenError(
          'You edited this trial’s brief or rubric, so you cannot compete in it.',
        );
      const staffApplicant = isTrialStaff(t);
      if (existing && staffApplicant)
        throw new ForbiddenError('Staff cannot re-apply to a trial after withdrawing.');
      const values = {
        status: 'applied' as const,
        statement: data.statement,
        appliedAt: now,
        selectedAt: null,
        teamId: null,
        teamRole: null,
      };
      const [row] = existing
        ? await t.db
            .update(trialParticipants)
            .set(values)
            .where(eq(trialParticipants.id, existing.id))
            .returning()
        : await t.db
            .insert(trialParticipants)
            .values({ ...values, trialId: trial.id, memberId: actor.memberId })
            .returning();
      if (staffApplicant)
        await recordAudit(t, {
          action: 'trial.staff_applied',
          targetType: 'trial',
          targetId: trial.id,
          context: { memberId: actor.memberId, roles: actor.roles },
        });
      await publishEvent(t, {
        type: 'trial.participant_applied',
        aggregateType: 'trial',
        aggregateId: trial.id,
        subjectMemberId: actor.memberId,
        payload: { ref: trialRef(trial), reapplied: existing !== null },
      });
      return { trialId: trial.id, status: row!.status, appliedAt: row!.appliedAt };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('You already applied to this trial.');
    throw error;
  }
}

/**
 * Leave a trial before it starts. A departing team lead hands the lead to the
 * earliest-selected teammate; a provisioned team channel is re-synced.
 */
export async function withdraw(
  ctx: ServiceContext,
  input: z.input<typeof trialIdSchema>,
): Promise<ApplicationView> {
  const { trialId } = parseInput(trialIdSchema, input);
  const actor = requireMember(ctx);
  return withTransaction(ctx, async (t) => {
    const trial = await loadTrial(t, trialId, 'update');
    const participation = await findParticipation(t, trial.id, actor.memberId);
    if (
      !participation ||
      participation.status === 'withdrawn' ||
      participation.status === 'removed'
    )
      throw new NotFoundError('Application');
    if (trial.status !== 'recruiting' && trial.status !== 'teams_assigned')
      throw new InvalidStateError(`Withdrawal from ${trialRef(trial)} closed when it started.`);

    const [row] = await t.db
      .update(trialParticipants)
      .set({ status: 'withdrawn', teamId: null, teamRole: null })
      .where(eq(trialParticipants.id, participation.id))
      .returning();
    if (participation.teamId) {
      if (participation.teamRole === 'lead') {
        const [successor] = await t.db
          .select({ id: trialParticipants.id })
          .from(trialParticipants)
          .where(
            and(
              eq(trialParticipants.teamId, participation.teamId),
              ne(trialParticipants.id, participation.id),
            ),
          )
          .orderBy(asc(trialParticipants.selectedAt), asc(trialParticipants.memberId))
          .limit(1);
        if (successor)
          await t.db
            .update(trialParticipants)
            .set({ teamRole: 'lead' })
            .where(eq(trialParticipants.id, successor.id));
      }
      const team = await findTeam(t, participation.teamId);
      if (team?.discordChannelId || team?.discordRoleId)
        await enqueueProvision(t, trial.id, team.id);
    }
    await publishEvent(t, {
      type: 'trial.participant_withdrawn',
      aggregateType: 'trial',
      aggregateId: trial.id,
      subjectMemberId: actor.memberId,
      payload: { ref: trialRef(trial), from: participation.status },
    });
    return { trialId: trial.id, status: row!.status, appliedAt: row!.appliedAt };
  });
}

export interface SubmissionReceipt {
  id: string;
  trialId: string;
  teamId: string;
  version: number;
  isLate: boolean;
  submittedAt: Date;
}

/**
 * A team member submits the team's work. Each submission is a new version;
 * the latest version is what evaluators assess. Accepted until
 * deadline + grace (flagged late after the deadline), never after closing.
 */
export async function submit(
  ctx: ServiceContext,
  input: z.input<typeof submitSchema>,
): Promise<SubmissionReceipt> {
  const data = parseInput(submitSchema, input);
  const actor = requireMember(ctx);
  await authorize(ctx, 'canViewMembers', { type: 'trial', id: data.trialId });
  return withTransaction(ctx, async (t) => {
    const trial = await loadTrial(t, data.trialId, 'share');
    const participation = await findParticipation(t, trial.id, actor.memberId);
    if (!participation || participation.status !== 'selected' || !participation.teamId)
      throw new ForbiddenError('Only members of a team in this trial can submit.');
    if (trial.status === 'teams_assigned')
      throw new InvalidStateError(`${trialRef(trial)} has not started.`);
    const now = t.clock.now();
    if (
      trial.status !== 'active' ||
      !trial.deadlineAt ||
      now.getTime() > closeTime(trial.deadlineAt, trial.graceMinutes).getTime()
    )
      throw new InvalidStateError(`Submissions for ${trialRef(trial)} are closed.`);

    // Serialize submissions per team so versions stay gap-free.
    await t.db
      .select({ id: trialTeams.id })
      .from(trialTeams)
      .where(eq(trialTeams.id, participation.teamId))
      .for('update');
    const [latest] = await t.db
      .select({ version: max(trialSubmissions.version) })
      .from(trialSubmissions)
      .where(eq(trialSubmissions.teamId, participation.teamId));
    const version = (latest?.version ?? 0) + 1;
    if (version > LIMITS.submissionVersions)
      throw new ConflictError(
        `Your team reached the limit of ${LIMITS.submissionVersions} submissions.`,
      );
    const isLate = now.getTime() > trial.deadlineAt.getTime();
    const [row] = await t.db
      .insert(trialSubmissions)
      .values({
        trialId: trial.id,
        teamId: participation.teamId,
        submittedByMemberId: actor.memberId,
        summary: data.summary,
        links: data.links,
        version,
        isLate,
        submittedAt: now,
      })
      .returning();
    await publishEvent(t, {
      type: 'trial.submission_received',
      aggregateType: 'trial',
      aggregateId: trial.id,
      subjectMemberId: actor.memberId,
      payload: { ref: trialRef(trial), teamId: participation.teamId, version, isLate },
    });
    return {
      id: row!.id,
      trialId: trial.id,
      teamId: participation.teamId,
      version,
      isLate,
      submittedAt: row!.submittedAt,
    };
  });
}
