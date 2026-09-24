import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, domainEvents, members, rankHistory } from '@jave/database';
import { ForbiddenError, NotFoundError } from '../kernel/errors';
import { anonymousActor, systemActor } from '../permissions/actor';
import { updateSettings } from '../settings/settings.service';
import { createTestKit, type TestKit } from '../testing';
import {
  applyRankConsequence,
  applyToTrial,
  assignTeams,
  cancelTrial,
  closeSubmissions,
  createTemplate,
  createTrial,
  evaluate,
  extendDeadline,
  getTeamProvisioningSpec,
  getTrialForParticipant,
  getTrialForStaff,
  listTemplates,
  listTrials,
  markTeamProvisioned,
  memberTrialHistory,
  openRecruitment,
  previewResults,
  publishResults,
  seedStarterTemplates,
  selectParticipants,
  setAdversarialEnabled,
  startTrial,
  submit,
} from './index';
import {
  configureDiscord,
  CUSTOM_TRIAL,
  members as makeMembers,
  recruitingTrial,
  runningTrial,
  STATEMENT,
  PGLITE_HOOK_TIMEOUT_MS,
  PGLITE_SUITE,
} from './testing/fixtures';

const SCORES = { shipped: 8, value: 6 };

describe('trials: BREAK — access control', PGLITE_SUITE, () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
    await configureDiscord(kit);
  }, PGLITE_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  }, PGLITE_HOOK_TIMEOUT_MS);

  async function deniedAudits(userId: string) {
    return kit.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.result, 'denied'), eq(auditLogs.actorUserId, userId)));
  }

  it('BREAK: a participant never sees the adversarial flag — or anything adversarial', async () => {
    await updateSettings(kit.system, 'trials', { adversarialEnabled: true });
    const core = await kit.member({ roles: ['core'] });
    const ops = await kit.member({ roles: ['operations'] });
    await seedStarterTemplates(kit.as(core));
    const redFlag = (await listTemplates(kit.as(core))).find(
      (t) => t.key === 'security-red-flag-hunt',
    )!;
    expect(redFlag.allowsAdversarial).toBe(true);
    // Operations manage trials but not adversarial roles: the template flag is hidden from them.
    const opsView = (await listTemplates(kit.as(ops))).find((t) => t.id === redFlag.id)!;
    expect('allowsAdversarial' in opsView).toBe(false);

    const people = await makeMembers(kit, 2);
    const trial = await createTrial(kit.as(core), {
      templateId: redFlag.id,
      adversarialEnabled: true,
    });
    await openRecruitment(kit.as(core), { trialId: trial.id });
    for (const p of people)
      await applyToTrial(kit.as(p), { trialId: trial.id, statement: STATEMENT });
    await selectParticipants(kit.as(core), {
      trialId: trial.id,
      mode: 'manual',
      memberIds: people.map((p) => p.memberId!),
    });
    await assignTeams(kit.as(core), { trialId: trial.id, strategy: 'random', seed: 'x' });
    await startTrial(kit.as(core), { trialId: trial.id });

    const view = await getTrialForParticipant(kit.as(people[0]!), { trialId: trial.id });
    expect(JSON.stringify(view).toLowerCase()).not.toContain('adversarial');
    const list = await listTrials(kit.as(people[0]!), {});
    expect(JSON.stringify(list).toLowerCase()).not.toContain('adversarial');

    // Staff without canManageAdversarial do not see it either; core does.
    const opsStaff = await getTrialForStaff(kit.as(ops), { trialId: trial.id });
    expect('adversarialEnabled' in opsStaff).toBe(false);
    const coreStaff = await getTrialForStaff(kit.as(core), { trialId: trial.id });
    expect(coreStaff.adversarialEnabled).toBe(true);

    // Events (some leave JAVE via webhooks) never carry it.
    const events = await kit.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.aggregateId, trial.id));
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events.map((e) => e.payload)).toLowerCase()).not.toContain('adversarial');
  });

  it('BREAK: enabling adversarial roles needs the capability, the global switch and a willing template', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const core = await kit.member({ roles: ['core'] });
    await expect(
      createTrial(kit.as(ops), { ...CUSTOM_TRIAL, adversarialEnabled: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createTrial(kit.as(core), { ...CUSTOM_TRIAL, adversarialEnabled: true }),
    ).rejects.toThrow('disabled in settings');
    await updateSettings(kit.system, 'trials', { adversarialEnabled: true });
    await seedStarterTemplates(kit.as(core));
    const ship = (await listTemplates(kit.as(core))).find((t) => t.key === 'build-48-hour-ship')!;
    await expect(
      createTrial(kit.as(core), { templateId: ship.id, adversarialEnabled: true }),
    ).rejects.toThrow('does not allow adversarial');
    const trial = await createTrial(kit.as(core), { templateId: ship.id });
    await expect(
      setAdversarialEnabled(kit.as(ops), { trialId: trial.id, enabled: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createTemplate(kit.as(ops), {
        key: 'sneaky',
        title: 'Sneaky',
        category: 'security',
        summary: 'A template that sneaks adversarial roles in.',
        brief: 'x'.repeat(60),
        durationMinutes: 60,
        rubric: [{ key: 'impact', label: 'Impact', weight: 1 }],
        allowsAdversarial: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('BREAK: members cannot run trials — every staff action is refused and audited', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b] = await makeMembers(kit, 2);
    const { trialId, assignment } = await runningTrial(kit, ops, [a!, b!]);
    const as = kit.as(a!);
    await expect(createTrial(as, CUSTOM_TRIAL)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      extendDeadline(as, { trialId, minutes: 600, reason: 'more time' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(closeSubmissions(as, { trialId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cancelTrial(as, { trialId, reason: 'sabotage' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      evaluate(as, { trialId, teamId: assignment.teams[0]!.id, scores: SCORES }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(publishResults(as, { trialId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getTrialForStaff(as, { trialId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(previewResults(as, { trialId })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await deniedAudits(a!.userId)).length).toBeGreaterThanOrEqual(8);
    await expect(listTrials(kit.as(anonymousActor), {})).rejects.toThrow();
  });

  it('BREAK: staff who take part cannot operate, view or evaluate their own trial', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const insider = await kit.member({ roles: ['operations'] });
    const [a, b, c] = await makeMembers(kit, 3);
    const trialId = await recruitingTrial(kit, ops, [insider, a!, b!, c!]);

    // Self-approval: an applicant cannot select participants.
    await expect(
      selectParticipants(kit.as(insider), {
        trialId,
        mode: 'manual',
        memberIds: [insider.memberId!],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await selectParticipants(kit.as(ops), {
      trialId,
      mode: 'manual',
      memberIds: [insider.memberId!, a!.memberId!, b!.memberId!, c!.memberId!],
    });
    const assignment = await assignTeams(kit.as(ops), { trialId, strategy: 'random', seed: 's' });
    await startTrial(kit.as(ops), { trialId });
    const own = assignment.teams.find((t) => t.memberIds.includes(insider.memberId!))!;
    const rival = assignment.teams.find((t) => t !== own)!;
    for (const team of assignment.teams) {
      const member = [a, b, c, insider].find((m) => team.memberIds.includes(m!.memberId!))!;
      await submit(kit.as(member), { trialId, summary: 'A working product with real users.' });
    }

    await expect(
      extendDeadline(kit.as(insider), { trialId, minutes: 600, reason: 'we need more time' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getTrialForStaff(kit.as(insider), { trialId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await closeSubmissions(kit.as(ops), { trialId });

    await expect(
      evaluate(kit.as(insider), { trialId, memberId: insider.memberId!, scores: SCORES }),
    ).rejects.toThrow('cannot evaluate yourself');
    await expect(
      evaluate(kit.as(insider), { trialId, teamId: own.id, scores: SCORES }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      evaluate(kit.as(insider), { trialId, teamId: rival.id, scores: SCORES }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(publishResults(kit.as(insider), { trialId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const blocked = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorUserId, insider.userId));
    const actions = blocked.map((row) => row.action);
    expect(actions).toContain('trial.self_evaluation_blocked');
    expect(
      actions.filter((x) => x === 'trial.conflict_of_interest_blocked').length,
    ).toBeGreaterThanOrEqual(5);

    // Uninvolved staff evaluate the same team without friction.
    await expect(
      evaluate(kit.as(ops), { trialId, teamId: own.id, scores: SCORES }),
    ).resolves.toMatchObject({ teamId: own.id });
  });

  it('BREAK: staff who could read the sealed brief cannot slip into the trial', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const otherOps = await kit.member({ roles: ['operations'] });
    const trialId = await recruitingTrial(kit, ops, []);
    // The author never competes.
    await expect(applyToTrial(kit.as(ops), { trialId, statement: STATEMENT })).rejects.toThrow(
      'You created this trial',
    );
    // Other staff may apply once — audited — but cannot withdraw, read, and re-apply.
    await applyToTrial(kit.as(otherOps), { trialId, statement: STATEMENT });
    const [audit] = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'trial.staff_applied'));
    expect(audit).toMatchObject({ actorUserId: otherOps.userId, targetId: trialId });
    const { withdraw } = await import('./participation.service');
    await withdraw(kit.as(otherOps), { trialId });
    await expect(getTrialForStaff(kit.as(otherOps), { trialId })).resolves.toBeTruthy();
    await expect(applyToTrial(kit.as(otherOps), { trialId, statement: STATEMENT })).rejects.toThrow(
      'cannot re-apply',
    );
  });

  it('BREAK: rank consequences need canModifyRanks, never self-apply, and never repeat', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const core = await kit.member({ roles: ['core'] });
    const [a, b] = await makeMembers(kit, 2);
    const { trialId, assignment } = await runningTrial(kit, ops, [a!, b!]);
    await submit(kit.as(a!), { trialId, summary: 'A working product with real users.' });
    await closeSubmissions(kit.as(ops), { trialId });
    await evaluate(kit.as(ops), {
      trialId,
      teamId: assignment.teams[0]!.id,
      scores: { shipped: 9, value: 9 },
    });
    await publishResults(kit.as(ops), { trialId });

    await expect(
      applyRankConsequence(kit.as(ops), { trialId, memberId: a!.memberId! }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await deniedAudits(ops.userId)).toHaveLength(1);
    await expect(
      applyRankConsequence(kit.as(a!), { trialId, memberId: a!.memberId! }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await kit.db.select().from(rankHistory)).toHaveLength(0);

    const receipt = await applyRankConsequence(kit.as(core), { trialId, memberId: a!.memberId! });
    expect(receipt.rank).toBe('A');
    await expect(
      applyRankConsequence(kit.as(core), { trialId, memberId: a!.memberId! }),
    ).rejects.toThrow('already applied');
  });

  it('BREAK: a trial result never lowers a verified rank', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const core = await kit.member({ roles: ['core'] });
    const other = await kit.member({ roles: ['core'] });
    const [a] = await makeMembers(kit, 1);
    const { setVerifiedRank } = await import('../identity/capabilities.service');
    await setVerifiedRank(kit.as(other), {
      memberId: a!.memberId!,
      facetKey: 'create.projects',
      rank: 'S',
      reason: 'Shipped a product used by millions',
    });
    const { trialId, assignment } = await runningTrial(kit, ops, [a!], { teamSize: 1 });
    await submit(kit.as(a!), { trialId, summary: 'A working product with real users.' });
    await closeSubmissions(kit.as(ops), { trialId });
    await evaluate(kit.as(ops), { trialId, teamId: assignment.teams[0]!.id, scores: SCORES });
    await publishResults(kit.as(ops), { trialId });
    await expect(
      applyRankConsequence(kit.as(core), { trialId, memberId: a!.memberId! }),
    ).rejects.toThrow('never lowers');
  });

  it('BREAK: IDOR — drafts, staff records and other members’ histories stay hidden', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b] = await makeMembers(kit, 2);
    const draft = await createTrial(kit.as(ops), CUSTOM_TRIAL);
    await expect(getTrialForParticipant(kit.as(a!), { trialId: draft.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await listTrials(kit.as(a!), {})).items).toEqual([]);
    expect((await listTrials(kit.as(a!), { status: 'draft' })).items).toEqual([]);
    expect((await listTrials(kit.as(ops), { status: 'draft' })).items).toHaveLength(1);
    await expect(memberTrialHistory(kit.as(a!), { memberId: b!.memberId! })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(memberTrialHistory(kit.as(a!), { memberId: a!.memberId! })).resolves.toEqual([]);

    // A team id from another trial cannot be evaluated through this one.
    const first = await runningTrial(kit, ops, [a!]);
    const second = await runningTrial(kit, ops, [b!]);
    await submit(kit.as(a!), { trialId: first.trialId, summary: 'A working product, used daily.' });
    await submit(kit.as(b!), {
      trialId: second.trialId,
      summary: 'A working product, used daily.',
    });
    await closeSubmissions(kit.as(ops), { trialId: first.trialId });
    await expect(
      evaluate(kit.as(ops), {
        trialId: first.trialId,
        teamId: second.assignment.teams[0]!.id,
        scores: SCORES,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      evaluate(kit.as(ops), { trialId: first.trialId, memberId: b!.memberId!, scores: SCORES }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('BREAK: only members of a team can submit, and only for their own team', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const [a, b, outsider, waitlisted] = await makeMembers(kit, 4);
    const trialId = await recruitingTrial(kit, ops, [a!, b!, waitlisted!]);
    await selectParticipants(kit.as(ops), {
      trialId,
      mode: 'manual',
      memberIds: [a!.memberId!, b!.memberId!],
    });
    await assignTeams(kit.as(ops), { trialId, strategy: 'random', seed: 's' });
    await startTrial(kit.as(ops), { trialId });
    const body = { trialId, summary: 'We did not do the work but want credit.' };
    await expect(submit(kit.as(outsider!), body)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(submit(kit.as(waitlisted!), body)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(submit(kit.as(ops), body)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(submit(kit.as(systemActor('x')), body)).rejects.toThrow();
  });

  it('BREAK: ineligible or quarantined members cannot apply or submit', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const plain = await kit.member({ roles: [] });
    const applicant = await kit.member({ roles: ['applicant'] });
    const [a, b] = await makeMembers(kit, 2);
    const trialId = await recruitingTrial(kit, ops, [a!]);
    await expect(applyToTrial(kit.as(plain), { trialId, statement: STATEMENT })).rejects.toThrow(
      'open to TRIAL and VERIFIED',
    );
    await expect(
      applyToTrial(kit.as(applicant), { trialId, statement: STATEMENT }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await kit.db
      .update(members)
      .set({ standing: 'restricted' })
      .where(eq(members.id, b!.memberId!));
    const { resolveUserActor } = await import('../identity/users.service');
    const restricted = await resolveUserActor(kit.system, b!.userId);
    await expect(
      applyToTrial(kit.as(restricted), { trialId, statement: STATEMENT }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await kit.db
      .update(members)
      .set({ standing: 'quarantined' })
      .where(eq(members.id, a!.memberId!));
    const quarantined = await resolveUserActor(kit.system, a!.userId);
    await expect(
      applyToTrial(kit.as(quarantined), { trialId, statement: STATEMENT }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('BREAK: Discord callbacks and specs are reserved for the system worker', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const founder = await kit.member({ roles: ['founder'] });
    const [a, b] = await makeMembers(kit, 2);
    const { assignment } = await runningTrial(kit, ops, [a!, b!]);
    const teamId = assignment.teams[0]!.id;
    for (const actor of [a!, founder]) {
      await expect(
        markTeamProvisioned(kit.as(actor), { teamId, channelId: '123456789012345678' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getTeamProvisioningSpec(kit.as(actor), { teamId })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    await expect(
      markTeamProvisioned(kit.system, { teamId, channelId: 'not-a-snowflake' }),
    ).rejects.toThrow('Discord ID');
  });
});
