import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, like, or } from 'drizzle-orm';
import {
  auditLogs,
  domainEvents,
  jobs,
  members,
  notifications,
  trialParticipants,
} from '@jave/database';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '../kernel/errors';
import { anonymousActor, type UserActor } from '../permissions/actor';
import { resolveUserActor } from '../identity/users.service';
import { createTestKit, type TestKit } from '../testing';
import { evaluateRole, revealRole } from './evaluation.service';
import { addTrigger, recordObservation } from './observations.service';
import { getMyBriefing, getRole, listMyBriefings, listRoles } from './queries.service';
import {
  abortRole,
  activateRole,
  authorizeRole,
  briefRole,
  concludeRole,
  planRole,
} from './roles.service';
import { getScenario, listScenarios, seedStarterScenarios } from './scenarios.service';
import {
  type AdversarialFixture,
  memberIdOf,
  planDefault,
  runToActive,
  setupAdversarial,
  INTEGRATION_TIMEOUT_MS,
} from './test-fixtures';

const RANDOM_ROLE_ID = '00000000-0000-4000-8000-000000000000';
const SECOND_OBJECTIVE = 'Suggest granting every teammate admin rights on git.jvln.test.';

vi.setConfig({ testTimeout: INTEGRATION_TIMEOUT_MS, hookTimeout: INTEGRATION_TIMEOUT_MS });
describe('adversarial visibility', () => {
  let kit: TestKit;
  let fx: AdversarialFixture;
  beforeEach(async () => {
    kit = await createTestKit();
    fx = await setupAdversarial(kit);
  });
  afterEach(async () => {
    await kit.close();
  });

  /** A second operative on team B with a distinct objective, briefed and active. */
  async function secondRole() {
    const other = await kit.member({ roles: ['verified'] });
    await kit.db.insert(trialParticipants).values({
      trialId: fx.trialId,
      memberId: memberIdOf(other),
      status: 'selected',
      teamId: fx.teamBId,
    });
    const role = await planRole(kit.as(fx.planner), {
      trialId: fx.trialId,
      teamId: fx.teamBId,
      operativeMemberId: memberIdOf(other),
      scenarioId: fx.scenarioId,
      objective: SECOND_OBJECTIVE,
    });
    await authorizeRole(kit.as(fx.authorizer), { roleId: role.id, sandboxAttested: true });
    await briefRole(kit.as(fx.planner), { roleId: role.id });
    await activateRole(kit.as(fx.planner), { roleId: role.id });
    return { other, role };
  }

  it('BREAK: participants, moderators and operations cannot read or act on anything', async () => {
    const role = await runToActive(fx);
    const [scenario] = (await listScenarios(kit.as(fx.planner))).items;
    const outsiders: UserActor[] = [
      fx.teammates[0]!,
      fx.otherTeamMember,
      fx.moderator,
      fx.operations,
    ];
    for (const actor of outsiders) {
      const ctx = kit.as(actor);
      const attempts: Promise<unknown>[] = [
        getRole(ctx, { roleId: role.id }),
        listRoles(ctx, { trialId: fx.trialId }),
        listScenarios(ctx),
        getScenario(ctx, { scenarioId: scenario!.id }),
        seedStarterScenarios(ctx),
        planDefault({ ...fx, planner: actor }),
        concludeRole(ctx, { roleId: role.id }),
        abortRole(ctx, { roleId: role.id, reason: 'Trying to peek.' }),
        recordObservation(ctx, {
          roleId: role.id,
          outcome: 'failure',
          description: 'Fake observation.',
        }),
        addTrigger(ctx, {
          roleId: role.id,
          label: 'Hijack',
          description: 'Add a trigger of my own.',
        }),
        evaluateRole(ctx, {
          roleId: role.id,
          score: 0,
          justification: 'Tamper attempt.',
          summary: 'Tamper attempt.',
        }),
        revealRole(ctx, { roleId: role.id }),
      ];
      for (const attempt of attempts) await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
    }
    const denials = await kit.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, 'access.denied'), eq(auditLogs.actorUserId, fx.operations.userId)),
      );
    expect(denials.length).toBeGreaterThanOrEqual(10);
  });

  it('BREAK: anonymous callers are rejected', async () => {
    const role = await runToActive(fx);
    const anon = kit.as(anonymousActor);
    await expect(getRole(anon, { roleId: role.id })).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(getMyBriefing(anon, { roleId: role.id })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(listMyBriefings(anon)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('BREAK: a quarantined core member loses access immediately', async () => {
    const role = await runToActive(fx);
    await kit.db
      .update(members)
      .set({ standing: 'quarantined' })
      .where(eq(members.id, memberIdOf(fx.planner)));
    const demoted = await resolveUserActor(kit.system, fx.planner.userId);
    await expect(getRole(kit.as(demoted), { roleId: role.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('the operative sees only their own briefing — never another role', async () => {
    const role = await runToActive(fx);
    const { other, role: roleB } = await secondRole();

    const mine = await listMyBriefings(kit.as(fx.operative));
    expect(mine.map((b) => b.briefing.roleId)).toEqual([role.id]);
    expect(JSON.stringify(mine)).not.toContain(SECOND_OBJECTIVE);
    expect(JSON.stringify(mine)).not.toContain(roleB.id);

    await expect(getMyBriefing(kit.as(fx.operative), { roleId: roleB.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const theirs = await getMyBriefing(kit.as(other), { roleId: roleB.id });
    expect(theirs.briefing.objective).toBe(SECOND_OBJECTIVE);
  });

  it('BREAK: teammates get the same answer for a real role ID as for a random one', async () => {
    const role = await runToActive(fx);
    const mate = kit.as(fx.teammates[0]!);
    expect(await listMyBriefings(mate)).toEqual([]);
    const real = await getMyBriefing(mate, { roleId: role.id }).catch((e: unknown) => e);
    const random = await getMyBriefing(mate, { roleId: RANDOM_ROLE_ID }).catch((e: unknown) => e);
    expect(real).toBeInstanceOf(NotFoundError);
    expect(random).toBeInstanceOf(NotFoundError);
    expect((real as Error).message).toBe((random as Error).message);
  });

  it('BREAK: a planned (not yet briefed) operative sees nothing', async () => {
    const role = await planDefault(fx);
    expect(await listMyBriefings(kit.as(fx.operative))).toEqual([]);
    await expect(getMyBriefing(kit.as(fx.operative), { roleId: role.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('BREAK: nothing observable reaches participants before the reveal', async () => {
    const role = await runToActive(fx);
    await addTrigger(kit.as(fx.founder), {
      roleId: role.id,
      label: 'Ask',
      description: 'Ask for the sandbox key.',
    });
    await recordObservation(kit.as(fx.planner), {
      roleId: role.id,
      outcome: 'resisted',
      description: 'Refused the request.',
      subjectMemberId: memberIdOf(fx.teammates[0]!),
    });
    await concludeRole(kit.as(fx.planner), { roleId: role.id });
    await evaluateRole(kit.as(fx.authorizer), {
      roleId: role.id,
      summary: 'Refused the request.',
      debrief: 'You refused the request. Next time, also tell staff right away.',
    });

    // No domain events (they fan out to analytics, activity and webhooks).
    const events = await kit.db
      .select()
      .from(domainEvents)
      .where(
        or(
          like(domainEvents.type, 'adversarial.%'),
          eq(domainEvents.aggregateType, 'adversarial_role'),
        ),
      );
    expect(events).toHaveLength(0);
    // No notification to anyone on the teams except the operative.
    for (const participant of [...fx.teammates, fx.otherTeamMember]) {
      const inbox = await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, participant.userId));
      expect(inbox).toHaveLength(0);
    }
    // No Discord job targets a channel before the reveal.
    const debriefJobs = await kit.db
      .select()
      .from(jobs)
      .where(eq(jobs.type, 'discord.adversarial.debrief'));
    expect(debriefJobs).toHaveLength(0);
  });

  it('staff reads are audited', async () => {
    const role = await runToActive(fx);
    await getRole(kit.as(fx.authorizer), { roleId: role.id });
    await listRoles(kit.as(fx.authorizer), { trialId: fx.trialId });
    const reads = await kit.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.actorUserId, fx.authorizer.userId));
    expect(reads.map((r) => r.action)).toEqual(
      expect.arrayContaining(['adversarial.role_viewed', 'adversarial.roles_listed']),
    );
  });

  it('staff detail view carries triggers, observations and the live suggested score', async () => {
    const role = await runToActive(fx);
    await recordObservation(kit.as(fx.planner), {
      roleId: role.id,
      outcome: 'reported',
      description: 'Escalated at once.',
    });
    const detail = await getRole(kit.as(fx.authorizer), { roleId: role.id });
    expect(detail.operative.memberId).toBe(memberIdOf(fx.operative));
    expect(detail.team?.name).toBe('Team A');
    expect(detail.outcomes.reported).toBe(1);
    expect(detail.suggestedScore).toBe(7);
    const page = await listRoles(kit.as(fx.authorizer), { status: 'active' });
    expect(page.total).toBe(1);
    expect(page.items[0]!.id).toBe(role.id);
  });
});
