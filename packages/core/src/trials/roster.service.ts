import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { trialParticipants, trialTeams, trials } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { InvalidStateError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { actorMemberId } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import { ANNOUNCE_PHASE, dedupeKeys, trialRef } from './constants';
import {
  enqueueAnnouncement,
  enqueueProvision,
  notifyEach,
  retireTeam,
  scheduleAutoStart,
} from './effects';
import { assertNoConflictOfInterest, eligibilityProblem, leadPriority } from './guards';
import { notices } from './notices';
import {
  activeRolesByMember,
  loadParticipantDetails,
  loadTeams,
  loadTrial,
  type ParticipantDetail,
} from './repository';
import { assignTeamsSchema, selectParticipantsSchema } from './schemas';
import { assertStatus, assertTransition } from './state-machine';
import {
  type AssignmentStrategy,
  createRng,
  generateSeed,
  planTeams,
  seededShuffle,
} from './team-assignment';

export interface SelectionResult {
  trialId: string;
  mode: 'manual' | 'random';
  /** Seed of a random draw (null for manual selection). Recorded in the audit log. */
  seed: string | null;
  selectedMemberIds: string[];
  /** Eligible applicants left in the pool. */
  poolSize: number;
}

/**
 * Choose who takes part. Replaces the current selection: chosen applicants
 * become SELECTED, previously selected ones return to APPLIED. Eligibility is
 * re-checked now (roles and standing may have changed since applying).
 * Random draws are reproducible from the recorded seed.
 */
export async function selectParticipants(
  ctx: ServiceContext,
  input: z.input<typeof selectParticipantsSchema>,
): Promise<SelectionResult> {
  const data = parseInput(selectParticipantsSchema, input);
  await authorize(ctx, 'canManageTrials', { type: 'trial', id: data.trialId });
  await assertNoConflictOfInterest(ctx, data.trialId, 'select its participants');
  const selfId = actorMemberId(ctx.actor);

  return withTransaction(ctx, async (t) => {
    const trial = await loadTrial(t, data.trialId, 'update');
    assertStatus(trial, ['recruiting'], 'select participants');
    // The actor is never part of the pool, even if they applied after the conflict check.
    const pool = (
      await loadParticipantDetails(t, trial.id, ['applied', 'selected', 'waitlisted'])
    ).filter((p) => p.memberId !== selfId);
    const roles = await activeRolesByMember(
      t,
      pool.map((p) => p.memberId),
    );
    const eligible = pool.filter(
      (p) =>
        eligibilityProblem({
          roles: roles.get(p.memberId) ?? [],
          standing: p.standing,
          guildStatus: p.guildStatus,
        }) === null,
    );

    let chosen: ParticipantDetail[];
    let seed: string | null = null;
    if (data.mode === 'manual') {
      const byId = new Map(eligible.map((p) => [p.memberId, p]));
      const invalid = data.memberIds.filter((id) => !byId.has(id));
      if (invalid.length > 0)
        throw new ValidationError(
          `${invalid.length} of the listed members are not eligible applicants of ${trialRef(trial)}.`,
          invalid.map((id) => ({ path: 'memberIds', message: id })),
        );
      chosen = data.memberIds.map((id) => byId.get(id)!);
    } else {
      seed = data.seed ?? generateSeed();
      const ordered = [...eligible].sort((a, b) => a.memberId.localeCompare(b.memberId));
      chosen = seededShuffle(ordered, createRng(`select:${seed}`)).slice(0, data.count);
    }
    if (trial.maxParticipants !== null && chosen.length > trial.maxParticipants)
      throw new ValidationError(
        `${trialRef(trial)} takes at most ${trial.maxParticipants} participants.`,
      );

    const now = t.clock.now();
    const chosenIds = new Set(chosen.map((p) => p.memberId));
    const newlySelected = chosen.filter((p) => p.status !== 'selected');
    const deselected = pool.filter((p) => p.status === 'selected' && !chosenIds.has(p.memberId));
    if (newlySelected.length > 0)
      await t.db
        .update(trialParticipants)
        .set({ status: 'selected', selectedAt: now })
        .where(
          and(
            eq(trialParticipants.trialId, trial.id),
            inArray(
              trialParticipants.memberId,
              newlySelected.map((p) => p.memberId),
            ),
          ),
        );
    if (deselected.length > 0)
      await t.db
        .update(trialParticipants)
        .set({ status: 'applied', selectedAt: null })
        .where(
          and(
            eq(trialParticipants.trialId, trial.id),
            inArray(
              trialParticipants.memberId,
              deselected.map((p) => p.memberId),
            ),
          ),
        );

    await recordAudit(t, {
      action: 'trial.participants_selected',
      targetType: 'trial',
      targetId: trial.id,
      context: {
        mode: data.mode,
        seed,
        selected: chosen.map((p) => p.memberId),
        deselected: deselected.map((p) => p.memberId),
        poolSize: eligible.length,
      },
    });
    for (const participant of newlySelected) {
      await publishEvent(t, {
        type: 'trial.participant_selected',
        aggregateType: 'trial',
        aggregateId: trial.id,
        subjectMemberId: participant.memberId,
        payload: { ref: trialRef(trial) },
      });
    }
    return {
      trialId: trial.id,
      mode: data.mode,
      seed,
      selectedMemberIds: chosen.map((p) => p.memberId),
      poolSize: eligible.length,
    };
  });
}

export interface AssignedTeamView {
  id: string;
  name: string;
  ordinal: number;
  leadMemberId: string;
  memberIds: string[];
}

export interface AssignmentResult {
  trialId: string;
  strategy: AssignmentStrategy;
  seed: string;
  teamSize: number;
  teams: AssignedTeamView[];
  waitlisted: number;
  /** Selected members who were no longer eligible and were removed from the trial. */
  removed: number;
}

/**
 * Split the selected participants into teams (see `planTeams`). Allowed while
 * recruiting and again before the start (a reshuffle replaces every team; the
 * Discord resources of the old teams are torn down). Selected members who are
 * no longer eligible are marked REMOVED instead of being placed on a team.
 */
export async function assignTeams(
  ctx: ServiceContext,
  input: z.input<typeof assignTeamsSchema>,
): Promise<AssignmentResult> {
  const data = parseInput(assignTeamsSchema, input);
  await authorize(ctx, 'canManageTrials', { type: 'trial', id: data.trialId });
  await assertNoConflictOfInterest(ctx, data.trialId, 'assign its teams');

  return withTransaction(ctx, async (t) => {
    const trial = await loadTrial(t, data.trialId, 'update');
    assertTransition(trial, 'teams_assigned', 'assign teams');
    const candidates = await loadParticipantDetails(t, trial.id, ['selected']);
    const roles = await activeRolesByMember(
      t,
      candidates.map((p) => p.memberId),
    );
    // Standing, server presence and roles can change after selection: re-check.
    const eligible = (p: ParticipantDetail) =>
      eligibilityProblem({
        roles: roles.get(p.memberId) ?? [],
        standing: p.standing,
        guildStatus: p.guildStatus,
      }) === null;
    const selected = candidates.filter(eligible);
    const removed = candidates.filter((p) => !eligible(p));
    if (candidates.length === 0)
      throw new InvalidStateError(
        `${trialRef(trial)} has no selected participants. Select participants first.`,
      );
    if (selected.length === 0)
      throw new InvalidStateError(
        `None of the selected participants of ${trialRef(trial)} is still eligible.`,
      );
    if (removed.length > 0)
      await t.db
        .update(trialParticipants)
        .set({ status: 'removed', teamId: null, teamRole: null })
        .where(
          and(
            eq(trialParticipants.trialId, trial.id),
            inArray(
              trialParticipants.memberId,
              removed.map((p) => p.memberId),
            ),
          ),
        );
    const teamSize = data.teamSize ?? trial.teamSize;
    const seed = data.seed ?? generateSeed();
    const plan = planTeams(
      selected.map((p) => ({
        memberId: p.memberId,
        primaryDomain: p.primaryDomain,
        leadPriority: leadPriority(roles.get(p.memberId) ?? []),
      })),
      { teamSize, strategy: data.strategy, seed },
    );

    const previous = await loadTeams(t, trial.id);
    for (const team of previous) await retireTeam(t, team);
    if (previous.length > 0) await t.db.delete(trialTeams).where(eq(trialTeams.trialId, trial.id));

    const inserted = await t.db
      .insert(trialTeams)
      .values(plan.map((team) => ({ trialId: trial.id, name: team.name, ordinal: team.ordinal })))
      .returning({ id: trialTeams.id, ordinal: trialTeams.ordinal });
    const idByOrdinal = new Map(inserted.map((row) => [row.ordinal, row.id]));
    const teams: AssignedTeamView[] = plan.map((team) => ({
      id: idByOrdinal.get(team.ordinal)!,
      name: team.name,
      ordinal: team.ordinal,
      leadMemberId: team.leadMemberId,
      memberIds: team.memberIds,
    }));
    for (const team of teams) {
      await t.db
        .update(trialParticipants)
        .set({ teamId: team.id, teamRole: 'member' })
        .where(
          and(
            eq(trialParticipants.trialId, trial.id),
            inArray(trialParticipants.memberId, team.memberIds),
          ),
        );
      await t.db
        .update(trialParticipants)
        .set({ teamRole: 'lead' })
        .where(
          and(
            eq(trialParticipants.trialId, trial.id),
            eq(trialParticipants.memberId, team.leadMemberId),
          ),
        );
    }
    await t.db
      .update(trialParticipants)
      .set({ status: 'waitlisted', teamId: null, teamRole: null })
      .where(and(eq(trialParticipants.trialId, trial.id), eq(trialParticipants.status, 'applied')));
    await t.db
      .update(trials)
      .set({
        status: 'teams_assigned',
        teamSize,
        assignmentStrategy: data.strategy,
        assignmentSeed: seed,
      })
      .where(eq(trials.id, trial.id));

    await recordAudit(t, {
      action: 'trial.teams_assigned',
      targetType: 'trial',
      targetId: trial.id,
      context: {
        strategy: data.strategy,
        seed,
        teamSize,
        reshuffle: previous.length > 0,
        removedIneligible: removed.map((p) => p.memberId),
        teams: teams.map((team) => ({
          name: team.name,
          lead: team.leadMemberId,
          members: team.memberIds,
        })),
      },
    });
    await publishEvent(t, {
      type: 'trial.teams_assigned',
      aggregateType: 'trial',
      aggregateId: trial.id,
      payload: {
        ref: trialRef(trial),
        teams: teams.length,
        participants: selected.length,
        strategy: data.strategy,
      },
    });
    for (const team of teams) await enqueueProvision(t, trial.id, team.id);
    if (trial.scheduledStartAt) await scheduleAutoStart(t, trial.id, trial.scheduledStartAt);
    if (trial.status === 'recruiting')
      await enqueueAnnouncement(t, trial.id, ANNOUNCE_PHASE.closed);

    const teamByMember = new Map(
      teams.flatMap((team) => team.memberIds.map((memberId) => [memberId, team] as const)),
    );
    await notifyEach(t, selected, 'trial.update', (p) => {
      const team = teamByMember.get(p.memberId)!;
      return {
        ...notices.selected(trial, team.name, team.leadMemberId === p.memberId),
        dedupeKey: dedupeKeys.notifyTeam(trial.id, team.id, p.memberId),
        data: { trialId: trial.id, teamId: team.id },
      };
    });
    await notifyEach(t, removed, 'trial.update', (p) => ({
      ...notices.removed(trial),
      dedupeKey: dedupeKeys.notifyRemoved(trial.id, p.memberId),
      data: { trialId: trial.id },
    }));
    const waitlisted = await loadParticipantDetails(t, trial.id, ['waitlisted']);
    await notifyEach(t, waitlisted, 'trial.update', (p) => ({
      ...notices.waitlisted(trial),
      dedupeKey: dedupeKeys.notifyWaitlisted(trial.id, p.memberId),
      data: { trialId: trial.id },
    }));

    return {
      trialId: trial.id,
      strategy: data.strategy,
      seed,
      teamSize,
      teams,
      waitlisted: waitlisted.length,
      removed: removed.length,
    };
  });
}
