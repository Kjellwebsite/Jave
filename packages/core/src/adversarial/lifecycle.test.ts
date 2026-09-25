import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import {
  adversarialRoles,
  auditLogs,
  domainEvents,
  jobs,
  members,
  notificationDeliveries,
  notifications,
  trialParticipants,
  trials,
  trialTeams,
} from '@jave/database';
import { HOUR } from '../kernel/clock';
import {
  ConflictError,
  DisabledError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import { updateSettings } from '../settings/settings.service';
import { createTestKit, type TestKit } from '../testing';
import { loadDebrief, markDebriefPosted } from './delivery.service';
import { ADVERSARIAL_BRIEF_JOB, ADVERSARIAL_DEBRIEF_JOB } from './discord-jobs';
import { evaluateRole, revealRole } from './evaluation.service';
import { addTrigger, fireTrigger, recordObservation } from './observations.service';
import { getMyBriefing } from './queries.service';
import {
  abortRole,
  activateRole,
  authorizeRole,
  briefRole,
  concludeRole,
  planRole,
} from './roles.service';
import { STOP_WORD } from './safety';
import {
  type AdversarialFixture,
  memberIdOf,
  planDefault,
  setTrialStatus,
  setupAdversarial,
  TEAM_A_CHANNEL,
  INTEGRATION_TIMEOUT_MS,
} from './test-fixtures';

vi.setConfig({ testTimeout: INTEGRATION_TIMEOUT_MS, hookTimeout: INTEGRATION_TIMEOUT_MS });
describe('adversarial lifecycle', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  async function notificationsFor(userId: string, type?: string) {
    const rows = await kit.db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, userId));
    return type ? rows.filter((n) => n.type === type) : rows;
  }

  it('runs the full flow with audit, jobs, event and notifications', async () => {
    const fx = await setupAdversarial(kit);
    const staff = kit.as(fx.planner);
    const role = await planDefault(fx);
    expect(role.status).toBe('planned');
    expect(role.guardrails).toContain(STOP_WORD);

    // The second signature is requested from other authorizers only.
    expect(await notificationsFor(fx.authorizer.userId, 'adversarial.staff')).toHaveLength(1);
    expect(await notificationsFor(fx.planner.userId, 'adversarial.staff')).toHaveLength(0);
    expect(await notificationsFor(fx.operative.userId)).toHaveLength(0);

    const trigger = await addTrigger(staff, {
      roleId: role.id,
      label: 'Token ask',
      description: 'Ask for the sandbox deploy key in the team channel.',
      plannedFor: new Date(kit.clock.now().getTime() + HOUR),
    });
    const authorized = await authorizeRole(kit.as(fx.authorizer), {
      roleId: role.id,
      sandboxAttested: true,
    });
    expect(authorized.authorizedByUserId).toBe(fx.authorizer.userId);
    expect(authorized.sandboxAttested).toBe(true);

    const briefed = await briefRole(staff, { roleId: role.id });
    expect(briefed.status).toBe('briefed');
    const [briefJob] = await kit.db.select().from(jobs).where(eq(jobs.type, ADVERSARIAL_BRIEF_JOB));
    expect(briefJob!.payload).toEqual({ roleId: role.id, revision: 1 });
    const [pointer] = await notificationsFor(fx.operative.userId, 'adversarial.briefing');
    expect(pointer!.title).toBe('CONFIDENTIAL BRIEFING');
    // Inbox pointer only: the DM carries the briefing itself.
    expect(
      await kit.db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.notificationId, pointer!.id)),
    ).toHaveLength(0);

    const mine = await getMyBriefing(kit.as(fx.operative), { roleId: role.id });
    expect(mine.briefing.guardrails).toBe(role.guardrails);
    expect(mine.briefing.stopWord).toBe(STOP_WORD);
    expect(mine.briefing.triggers.map((t) => t.label)).toEqual(['Token ask']);
    expect(mine.text).toContain('GUARDRAILS');

    await activateRole(staff, { roleId: role.id });
    await fireTrigger(kit.as(fx.operative), { roleId: role.id, triggerId: trigger.id });
    await recordObservation(staff, {
      roleId: role.id,
      outcome: 'reported',
      description: 'Declined and reported the request to staff.',
      subjectMemberId: memberIdOf(fx.teammates[0]!),
      triggerId: trigger.id,
    });
    await recordObservation(kit.as(fx.authorizer), {
      roleId: role.id,
      outcome: 'failure',
      description: 'Pasted the sandbox key into the channel.',
      subjectMemberId: memberIdOf(fx.teammates[1]!),
    });
    await concludeRole(staff, { roleId: role.id });

    await expect(revealRole(staff, { roleId: role.id })).rejects.toBeInstanceOf(InvalidStateError);
    const result = await evaluateRole(kit.as(fx.authorizer), {
      roleId: role.id,
      summary: 'One report, one failure. Mixed response under time pressure.',
      debrief:
        'Never paste keys in chat, even sandbox ones. Escalating to staff was the right call.',
    });
    expect(result.suggestedScore).toBe(5);
    expect(result.evaluation.securityCultureScore).toBe(5);
    expect(result.overridden).toBe(false);

    await setTrialStatus(kit, fx.trialId, 'evaluating');
    const revealed = await revealRole(staff, { roleId: role.id });
    expect(revealed.status).toBe('revealed');

    const [event] = await kit.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'adversarial.revealed'));
    expect(event!.subjectMemberId).toBe(memberIdOf(fx.operative));
    expect(
      await kit.db.select().from(jobs).where(eq(jobs.type, ADVERSARIAL_DEBRIEF_JOB)),
    ).toHaveLength(1);
    for (const mate of fx.teammates)
      expect(await notificationsFor(mate.userId, 'adversarial.revealed')).toHaveLength(1);
    expect(await notificationsFor(fx.otherTeamMember.userId)).toHaveLength(0);

    const delivery = await loadDebrief(kit.system, { roleId: role.id });
    expect(delivery.channelId).toBe(TEAM_A_CHANNEL);
    expect(delivery.text).toContain('SECURITY CULTURE — 5/10');
    expect(delivery.text).not.toContain(fx.teammates[1]!.displayName);
    const posted = {
      roleId: role.id,
      outcome: 'sent',
      channelId: TEAM_A_CHANNEL,
      messageId: '400000000000000001',
    } as const;
    expect(await markDebriefPosted(kit.system, posted)).toEqual({ recorded: true });
    expect(await markDebriefPosted(kit.system, posted)).toEqual({ recorded: false });

    const actions = (await kit.db.select({ action: auditLogs.action }).from(auditLogs)).map(
      (a) => a.action,
    );
    for (const action of [
      'adversarial.role_planned',
      'adversarial.trigger_added',
      'adversarial.role_authorized',
      'adversarial.role_briefed',
      'adversarial.briefing_viewed',
      'adversarial.role_activated',
      'adversarial.trigger_fired',
      'adversarial.observation_recorded',
      'adversarial.role_concluded',
      'adversarial.role_evaluated',
      'adversarial.role_revealed',
      'adversarial.debrief_posted',
    ])
      expect(actions).toContain(action);
  });

  describe('two-person rule', () => {
    let fx: AdversarialFixture;
    beforeEach(async () => {
      fx = await setupAdversarial(kit, { operativeRoles: ['core'] });
    });

    it('BREAK: the planner cannot authorize their own role — not even a founder', async () => {
      const role = await planRole(kit.as(fx.founder), {
        trialId: fx.trialId,
        teamId: fx.teamAId,
        operativeMemberId: memberIdOf(fx.operative),
        scenarioId: fx.scenarioId,
      });
      await expect(
        authorizeRole(kit.as(fx.founder), { roleId: role.id, sandboxAttested: true }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const blocked = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'adversarial.two_person_rule_blocked'));
      expect(blocked).toHaveLength(1);
      expect(blocked[0]!.result).toBe('denied');
    });

    it('BREAK: a staff operative cannot authorize — or even see — their own planned role', async () => {
      const role = await planDefault(fx);
      await expect(
        authorizeRole(kit.as(fx.operative), { roleId: role.id, sandboxAttested: true }),
      ).rejects.toBeInstanceOf(NotFoundError);
      const blocked = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'adversarial.conflict_of_interest_blocked'));
      expect(blocked).toHaveLength(1);
      expect((await kit.db.select().from(adversarialRoles))[0]!.authorizedAt).toBeNull();
    });

    it('BREAK: operations cannot authorize; attestation is mandatory', async () => {
      const role = await planDefault(fx);
      await expect(
        authorizeRole(kit.as(fx.operations), { roleId: role.id, sandboxAttested: true }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        authorizeRole(kit.as(fx.authorizer), {
          roleId: role.id,
          sandboxAttested: false as unknown as true,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('BREAK: cannot brief before authorization', async () => {
      const role = await planDefault(fx);
      await expect(briefRole(kit.as(fx.planner), { roleId: role.id })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
    });

    it('BREAK: concurrent authorizations — exactly one wins', async () => {
      const role = await planDefault(fx);
      const results = await Promise.allSettled([
        authorizeRole(kit.as(fx.authorizer), { roleId: role.id, sandboxAttested: true }),
        authorizeRole(kit.as(fx.founder), { roleId: role.id, sandboxAttested: true }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [rejected] = results.filter((r) => r.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    });

    it('BREAK: concurrent briefings enqueue exactly one briefing', async () => {
      const role = await planDefault(fx);
      await authorizeRole(kit.as(fx.authorizer), { roleId: role.id, sandboxAttested: true });
      const results = await Promise.allSettled([
        briefRole(kit.as(fx.planner), { roleId: role.id }),
        briefRole(kit.as(fx.authorizer), { roleId: role.id }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        await kit.db.select().from(jobs).where(eq(jobs.type, ADVERSARIAL_BRIEF_JOB)),
      ).toHaveLength(1);
    });

    it('BREAK: after authorization the planner cannot change the plan; another authorizer can', async () => {
      const role = await planDefault(fx);
      await authorizeRole(kit.as(fx.authorizer), { roleId: role.id, sandboxAttested: true });
      await briefRole(kit.as(fx.planner), { roleId: role.id });
      const trigger = {
        roleId: role.id,
        label: 'Second ask',
        description: 'Repeat the ask once, calmly.',
      };
      await expect(addTrigger(kit.as(fx.planner), trigger)).rejects.toBeInstanceOf(ForbiddenError);
      // A staff operative takes part in the trial: the role does not exist for them.
      await expect(addTrigger(kit.as(fx.operative), trigger)).rejects.toBeInstanceOf(NotFoundError);
      await addTrigger(kit.as(fx.founder), trigger);
      const [updated] = await kit.db
        .select()
        .from(adversarialRoles)
        .where(eq(adversarialRoles.id, role.id));
      expect(updated!.briefingRevision).toBe(2);
      const briefJobs = await kit.db
        .select()
        .from(jobs)
        .where(eq(jobs.type, ADVERSARIAL_BRIEF_JOB));
      expect(briefJobs.map((j) => j.payload.revision).sort()).toEqual([1, 2]);
    });
  });

  describe('kill switch and trial gates', () => {
    const plan = (fx: AdversarialFixture) =>
      planRole(kit.as(fx.planner), {
        trialId: fx.trialId,
        teamId: fx.teamAId,
        operativeMemberId: memberIdOf(fx.operative),
        scenarioId: fx.scenarioId,
      });

    it('BREAK: the global kill switch (default off) blocks planning', async () => {
      const fx = await setupAdversarial(kit, { killSwitch: false });
      await expect(plan(fx)).rejects.toBeInstanceOf(DisabledError);
    });

    it('BREAK: turning the kill switch off blocks briefing immediately (no cache window)', async () => {
      const fx = await setupAdversarial(kit);
      const role = await planDefault(fx);
      await authorizeRole(kit.as(fx.authorizer), { roleId: role.id, sandboxAttested: true });
      await updateSettings(kit.as(fx.founder), 'trials', { adversarialEnabled: false });
      await expect(briefRole(kit.as(fx.planner), { roleId: role.id })).rejects.toBeInstanceOf(
        DisabledError,
      );
    });

    it('BREAK: trial flag off, forbidding template, or finished trial block planning', async () => {
      const off = await setupAdversarial(kit, { trialAdversarialEnabled: false });
      await expect(plan(off)).rejects.toThrow('not enabled for this trial');
      await kit.db
        .update(trials)
        .set({ adversarialEnabled: true })
        .where(eq(trials.id, off.trialId));
      for (const status of ['completed', 'cancelled', 'evaluating'] as const) {
        await setTrialStatus(kit, off.trialId, status);
        await expect(plan(off)).rejects.toBeInstanceOf(InvalidStateError);
      }
    });

    it('respects the template allowsAdversarial flag', async () => {
      const forbids = await setupAdversarial(kit, { template: 'forbids' });
      await expect(plan(forbids)).rejects.toThrow('template does not allow');
      // A second trial in the same database, from a template that allows roles.
      const allows = await setupAdversarial(kit, { template: 'allows' });
      await expect(plan(allows)).resolves.toMatchObject({ status: 'planned' });
    });

    it('activation needs an active trial before its deadline', async () => {
      const fx = await setupAdversarial(kit, { trialStatus: 'teams_assigned' });
      const role = await planDefault(fx);
      await authorizeRole(kit.as(fx.authorizer), { roleId: role.id, sandboxAttested: true });
      await briefRole(kit.as(fx.planner), { roleId: role.id });
      await expect(activateRole(kit.as(fx.planner), { roleId: role.id })).rejects.toThrow(
        'must be active',
      );
      await setTrialStatus(kit, fx.trialId, 'active');
      kit.clock.advance(5 * HOUR);
      await expect(activateRole(kit.as(fx.planner), { roleId: role.id })).rejects.toThrow(
        'deadline has passed',
      );
    });
  });

  describe('operative constraints', () => {
    let fx: AdversarialFixture;
    beforeEach(async () => {
      fx = await setupAdversarial(kit);
    });
    const planFor = (memberId: string, teamId = fx.teamAId) =>
      planRole(kit.as(fx.planner), {
        trialId: fx.trialId,
        teamId,
        operativeMemberId: memberId,
        scenarioId: fx.scenarioId,
      });

    it('BREAK: the planner cannot plan in a trial they take part in (including as operative)', async () => {
      await kit.db.insert(trialParticipants).values({
        trialId: fx.trialId,
        memberId: memberIdOf(fx.planner),
        status: 'selected',
        teamId: fx.teamAId,
      });
      await expect(planFor(memberIdOf(fx.planner))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(planFor(memberIdOf(fx.operative))).rejects.toThrow('take part in this trial');
    });

    it('BREAK: operative must be VERIFIED or staff, selected, on the target team, in good standing', async () => {
      await expect(planFor(memberIdOf(fx.teammates[1]!))).rejects.toThrow('VERIFIED or staff');
      await expect(planFor(memberIdOf(fx.otherTeamMember))).rejects.toThrow('selected participant');
      const outsider = await kit.member({ roles: ['verified'] });
      await expect(planFor(memberIdOf(outsider))).rejects.toThrow('selected participant');
      await kit.db
        .update(members)
        .set({ standing: 'quarantined' })
        .where(eq(members.id, memberIdOf(fx.operative)));
      await expect(planFor(memberIdOf(fx.operative))).rejects.toThrow('good standing');
    });

    it('BREAK: a team from another trial is rejected (IDOR)', async () => {
      const [other] = await kit.db
        .insert(trials)
        .values({ title: 'Other', category: 'build', brief: 'x', rubric: [], durationMinutes: 60 })
        .returning({ id: trials.id });
      const [foreignTeam] = await kit.db
        .insert(trialTeams)
        .values({ trialId: other!.id, name: 'Foreign', ordinal: 1 })
        .returning({ id: trialTeams.id });
      await expect(planFor(memberIdOf(fx.operative), foreignTeam!.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('BREAK: one live role per team and per operative; concurrent plans conflict', async () => {
      const results = await Promise.allSettled([
        planFor(memberIdOf(fx.operative)),
        planFor(memberIdOf(fx.operative)),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [rejected] = results.filter((r) => r.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
      const [first] = await kit.db.select().from(adversarialRoles);
      await abortRole(kit.as(fx.planner), { roleId: first!.id, reason: 'Re-planning.' });
      await expect(planFor(memberIdOf(fx.operative))).resolves.toMatchObject({ status: 'planned' });
    });

    it('an operative removed from the team can no longer be briefed', async () => {
      const role = await planDefault(fx);
      await authorizeRole(kit.as(fx.authorizer), { roleId: role.id, sandboxAttested: true });
      await kit.db
        .update(trialParticipants)
        .set({ status: 'withdrawn' })
        .where(
          and(
            eq(trialParticipants.trialId, fx.trialId),
            inArray(trialParticipants.memberId, [memberIdOf(fx.operative)]),
          ),
        );
      await expect(briefRole(kit.as(fx.planner), { roleId: role.id })).rejects.toThrow(
        'selected participant',
      );
    });

    it('BREAK: a custom objective must pass the safety validator', async () => {
      await expect(
        planRole(kit.as(fx.planner), {
          trialId: fx.trialId,
          teamId: fx.teamAId,
          operativeMemberId: memberIdOf(fx.operative),
          scenarioId: fx.scenarioId,
          objective: 'Ask teammates for their Discord password to test them.',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
