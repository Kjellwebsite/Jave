import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  adversarialRoles,
  adversarialTriggers,
  domainEvents,
  jobs,
  members,
  notifications,
} from '@jave/database';
import {
  ConflictError,
  DisabledError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
} from '../kernel/errors';
import { updateSettings } from '../settings/settings.service';
import { createTestKit, type TestKit } from '../testing';
import { loadBriefingDelivery, loadDebrief } from './delivery.service';
import {
  ADVERSARIAL_ABORT_JOB,
  ADVERSARIAL_BRIEF_JOB,
  adversarialBriefPayloadSchema,
} from './discord-jobs';
import { evaluateRole, revealRole } from './evaluation.service';
import { recordObservation } from './observations.service';
import { getMyBriefing, getRole, listRoles } from './queries.service';
import { raiseRedFlag } from './red-flag.service';
import { abortRole, authorizeRole, concludeRole } from './roles.service';
import { updateScenario } from './scenarios.service';
import { addTrigger, approveTrigger, withdrawTrigger } from './triggers.service';
import {
  addApprovedTrigger,
  type AdversarialFixture,
  authorizeCurrent,
  INTEGRATION_TIMEOUT_MS,
  interleaveBeforeTransaction,
  memberIdOf,
  planDefault,
  runToActive,
  setTrialStatus,
  setupAdversarial,
} from './test-fixtures';

const STARTER_TITLE = 'Urgent Token Request';
const EDITED_TITLE = 'Rewritten Library Title';
const FOLLOW_UP = { label: 'Follow-up', description: 'Ask the team once more, calmly.' };

vi.setConfig({ testTimeout: INTEGRATION_TIMEOUT_MS, hookTimeout: INTEGRATION_TIMEOUT_MS });
describe('adversarial plan integrity', () => {
  let kit: TestKit;
  let fx: AdversarialFixture;
  beforeEach(async () => {
    kit = await createTestKit();
    fx = await setupAdversarial(kit);
  });
  afterEach(async () => {
    await kit.close();
  });

  const roleRow = async (id: string) =>
    (await kit.db.select().from(adversarialRoles).where(eq(adversarialRoles.id, id)))[0]!;
  const triggerRow = async (id: string) =>
    (await kit.db.select().from(adversarialTriggers).where(eq(adversarialTriggers.id, id)))[0]!;
  const jobsOfType = (type: string) => kit.db.select().from(jobs).where(eq(jobs.type, type));
  const alertsFor = async (userId: string) =>
    (
      await kit.db.select().from(notifications).where(eq(notifications.recipientUserId, userId))
    ).filter((n) => n.type === 'adversarial.alert');

  async function revealWithDebrief(roleId: string) {
    await evaluateRole(kit.as(fx.authorizer), {
      roleId,
      score: 6,
      justification: 'Observed in voice chat; not logged as observations.',
      summary: 'Held the line without escalating.',
      debrief: 'You held the line. Next time, also report the request to staff.',
    });
    await setTrialStatus(kit, fx.trialId, 'completed');
    await revealRole(kit.as(fx.planner), { roleId });
    const [event] = await kit.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'adversarial.revealed'));
    return { event: event!, debrief: await loadDebrief(kit.system, { roleId }) };
  }

  describe('the plan signed is the plan reviewed', () => {
    it('BREAK: a trigger added between review and signature refuses the authorization', async () => {
      const role = await planDefault(fx);
      const reviewed = (await getRole(kit.as(fx.authorizer), { roleId: role.id })).role;
      expect(reviewed.planRevision).toBe(1);
      let smuggledId = '';
      const authorizer = interleaveBeforeTransaction(kit.as(fx.authorizer), async () => {
        smuggledId = (await addTrigger(kit.as(fx.planner), { roleId: role.id, ...FOLLOW_UP })).id;
      });
      await expect(
        authorizeRole(authorizer, {
          roleId: role.id,
          planRevision: reviewed.planRevision,
          sandboxAttested: true,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect((await roleRow(role.id)).authorizedAt).toBeNull();
      expect((await triggerRow(smuggledId)).approvedAt).toBeNull();

      // Reviewing again and signing the new revision approves exactly what was seen.
      const again = (await getRole(kit.as(fx.authorizer), { roleId: role.id })).role;
      expect(again.planRevision).toBe(2);
      await authorizeRole(kit.as(fx.authorizer), {
        roleId: role.id,
        planRevision: again.planRevision,
        sandboxAttested: true,
      });
      expect((await triggerRow(smuggledId)).approvedByUserId).toBe(fx.authorizer.userId);
    });

    it('BREAK: withdrawing a trigger also changes the revision; forged revisions never match', async () => {
      const role = await planDefault(fx);
      const trigger = await addTrigger(kit.as(fx.planner), { roleId: role.id, ...FOLLOW_UP });
      await withdrawTrigger(kit.as(fx.planner), { roleId: role.id, triggerId: trigger.id });
      const sign = (planRevision: number) =>
        authorizeRole(kit.as(fx.authorizer), {
          roleId: role.id,
          planRevision,
          sandboxAttested: true,
        });
      await expect(sign(2)).rejects.toBeInstanceOf(ConflictError);
      await expect(sign(99)).rejects.toBeInstanceOf(ConflictError);
      await expect(sign(3)).resolves.toMatchObject({ authorizedByUserId: fx.authorizer.userId });
    });

    it('BREAK: an authorizer who wrote a trigger cannot sign the plan', async () => {
      const role = await planDefault(fx);
      const own = await addTrigger(kit.as(fx.authorizer), { roleId: role.id, ...FOLLOW_UP });
      await expect(authorizeCurrent(fx, role.id)).rejects.toBeInstanceOf(ForbiddenError);
      await authorizeCurrent(fx, role.id, fx.founder);
      expect((await triggerRow(own.id)).approvedByUserId).toBe(fx.founder.userId);
    });

    it('BREAK: pending triggers can be withdrawn; approved ones are part of the signed plan', async () => {
      const role = await runToActive(fx);
      const pending = await addTrigger(kit.as(fx.founder), { roleId: role.id, ...FOLLOW_UP });
      const approved = await addApprovedTrigger(fx, {
        roleId: role.id,
        label: 'Second ask',
        description: 'Ask once more, then stop.',
      });
      await expect(
        withdrawTrigger(kit.as(fx.planner), { roleId: role.id, triggerId: approved.id }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      await withdrawTrigger(kit.as(fx.planner), { roleId: role.id, triggerId: pending.id });
      await expect(
        approveTrigger(kit.as(fx.authorizer), {
          roleId: role.id,
          triggerId: pending.id,
          sandboxAttested: true,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('BREAK: triggers are approved with the role before authorization; kill switch blocks approval', async () => {
      const role = await planDefault(fx);
      const early = await addTrigger(kit.as(fx.founder), { roleId: role.id, ...FOLLOW_UP });
      const approve = () =>
        approveTrigger(kit.as(fx.authorizer), {
          roleId: role.id,
          triggerId: early.id,
          sandboxAttested: true,
        });
      await expect(approve()).rejects.toThrow('approved with the role');
      await authorizeCurrent(fx, role.id);
      const late = await addTrigger(kit.as(fx.founder), {
        roleId: role.id,
        label: 'Late ask',
        description: 'Ask again near the end.',
      });
      await updateSettings(kit.as(fx.founder), 'trials', { adversarialEnabled: false });
      await expect(
        approveTrigger(kit.as(fx.authorizer), {
          roleId: role.id,
          triggerId: late.id,
          sandboxAttested: true,
        }),
      ).rejects.toBeInstanceOf(DisabledError);
    });
  });

  describe('briefings and debriefs follow the authorized snapshot', () => {
    it('BREAK: editing the scenario library after authorization changes nothing the operative or team sees', async () => {
      const role = await runToActive(fx);
      await updateScenario(kit.as(fx.planner), {
        scenarioId: fx.scenarioId,
        title: EDITED_TITLE,
        technique: 'data_handling',
      });
      const snapshot = { title: STARTER_TITLE, technique: 'social_engineering' };

      const mine = await getMyBriefing(kit.as(fx.operative), { roleId: role.id });
      expect(mine.briefing.scenario).toEqual(snapshot);
      expect(mine.text).not.toContain(EDITED_TITLE);
      const delivery = await loadBriefingDelivery(kit.system, { roleId: role.id, revision: 1 });
      expect(delivery.text).toContain(STARTER_TITLE);
      expect(delivery.text).not.toContain(EDITED_TITLE);
      const listed = await listRoles(kit.as(fx.authorizer), { trialId: fx.trialId });
      expect(listed.items[0]!.scenario).toMatchObject(snapshot);

      await concludeRole(kit.as(fx.planner), { roleId: role.id });
      const { event, debrief } = await revealWithDebrief(role.id);
      expect(event.payload).toMatchObject({ technique: 'social_engineering' });
      expect(debrief.text).toContain(STARTER_TITLE);
      expect(debrief.text).not.toContain(EDITED_TITLE);
    });
  });

  describe('briefings never reach an ineligible operative', () => {
    it('BREAK: a quarantined operative gets no briefing DM and no new revision', async () => {
      const role = await runToActive(fx);
      await kit.db
        .update(members)
        .set({ standing: 'quarantined' })
        .where(eq(members.id, memberIdOf(fx.operative)));

      await expect(
        loadBriefingDelivery(kit.system, { roleId: role.id, revision: 1 }),
      ).rejects.toThrow('good standing');
      // The worker dead-letters the pending job instead of sending it.
      let sent = 0;
      await kit.drain({
        [ADVERSARIAL_BRIEF_JOB]: async (ctx, payload) => {
          await loadBriefingDelivery(ctx, adversarialBriefPayloadSchema.parse(payload));
          sent++;
        },
      });
      expect(sent).toBe(0);
      const [job] = await jobsOfType(ADVERSARIAL_BRIEF_JOB);
      expect(job!.status).toBe('dead');

      const pending = await addTrigger(kit.as(fx.founder), { roleId: role.id, ...FOLLOW_UP });
      await expect(
        approveTrigger(kit.as(fx.authorizer), {
          roleId: role.id,
          triggerId: pending.id,
          sandboxAttested: true,
        }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      expect((await roleRow(role.id)).briefingRevision).toBe(1);
      expect(await jobsOfType(ADVERSARIAL_BRIEF_JOB)).toHaveLength(1);
      expect((await triggerRow(pending.id)).approvedAt).toBeNull();
    });

    it('BREAK: with the kill switch off, no briefing is sent even before the sweep aborts the role', async () => {
      const role = await runToActive(fx);
      await updateSettings(kit.as(fx.founder), 'trials', { adversarialEnabled: false });
      await expect(
        loadBriefingDelivery(kit.system, { roleId: role.id, revision: 1 }),
      ).rejects.toThrow('disabled');
    });
  });

  describe('RED FLAG and abort after a normal end', () => {
    it('RED FLAG after the conclusion is escalated without rewriting the outcome', async () => {
      const role = await runToActive(fx);
      await concludeRole(kit.as(fx.planner), { roleId: role.id });
      const result = await raiseRedFlag(kit.as(fx.operative), {
        roleId: role.id,
        note: 'Something felt off afterwards.',
      });
      expect(result).toEqual({ roleId: role.id, status: 'concluded', alreadyStopped: true });
      const row = await roleRow(role.id);
      expect(row.status).toBe('concluded');
      expect(row.abortedAt).toBeNull();
      expect(row.redFlagRaisedAt).not.toBeNull();
      expect(row.stopNoticeDelivery).toBeNull();
      expect(await jobsOfType(ADVERSARIAL_ABORT_JOB)).toHaveLength(0);
      const [alert] = await alertsFor(fx.founder.userId);
      expect(alert!.body).toContain('after the exercise concluded');
      expect(alert!.body).toContain('Nothing is running');
      expect(alert!.body).toContain('Something felt off afterwards.');

      // Idempotent: a second flag neither transitions nor re-alerts.
      await raiseRedFlag(kit.as(fx.operative), { roleId: role.id });
      expect(await alertsFor(fx.founder.userId)).toHaveLength(1);

      const { event, debrief } = await revealWithDebrief(role.id);
      expect(event.payload).toMatchObject({ stoppedEarly: false });
      expect(debrief.debrief.stoppedEarly).toBe(false);
      expect(debrief.text).not.toContain('stopped early');
    });

    it('a concluded exercise aborted by staff is not reported as stopped early', async () => {
      const role = await runToActive(fx);
      await concludeRole(kit.as(fx.planner), { roleId: role.id });
      const aborted = await abortRole(kit.as(fx.planner), {
        roleId: role.id,
        reason: 'Pulled from the quarterly report.',
      });
      expect(aborted.status).toBe('aborted');
      expect(aborted.stopNoticeDelivery).toBeNull();
      const { event, debrief } = await revealWithDebrief(role.id);
      expect(event.payload).toMatchObject({ stoppedEarly: false });
      expect(debrief.text).not.toContain('stopped early');
    });

    it('an exercise stopped while active is reported as stopped early', async () => {
      const role = await runToActive(fx);
      await raiseRedFlag(kit.as(fx.operative), { roleId: role.id });
      await recordObservation(kit.as(fx.authorizer), {
        roleId: role.id,
        outcome: 'detected',
        description: 'Flagged the request as suspicious.',
      });
      const { event, debrief } = await revealWithDebrief(role.id);
      expect(event.payload).toMatchObject({ stoppedEarly: true });
      expect(debrief.text).toContain('The exercise was stopped early.');
    });
  });
});
