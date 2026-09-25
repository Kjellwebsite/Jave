import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  adversarialEvaluations,
  adversarialRoles,
  adversarialTriggers,
  jobs,
  notifications,
  trialParticipants,
} from '@jave/database';
import { HOUR, MINUTE } from '../kernel/clock';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import { createTestKit, type TestKit } from '../testing';
import {
  loadBriefingDelivery,
  loadStopNotice,
  markBriefingDelivered,
  markStopNoticeDelivered,
} from './delivery.service';
import { ADVERSARIAL_ABORT_JOB, ADVERSARIAL_BRIEF_JOB } from './discord-jobs';
import { evaluateRole, revealRole } from './evaluation.service';
import { addTrigger, fireTrigger, recordObservation } from './observations.service';
import {
  abortRole,
  authorizeRole,
  briefRole,
  concludeRole,
  planRole,
  raiseRedFlag,
} from './roles.service';
import {
  type AdversarialFixture,
  memberIdOf,
  planDefault,
  runToActive,
  setTrialStatus,
  setupAdversarial,
  INTEGRATION_TIMEOUT_MS,
} from './test-fixtures';

const RANDOM_ROLE_ID = '00000000-0000-4000-8000-000000000000';

vi.setConfig({ testTimeout: INTEGRATION_TIMEOUT_MS, hookTimeout: INTEGRATION_TIMEOUT_MS });
describe('adversarial operations', () => {
  let kit: TestKit;
  let fx: AdversarialFixture;
  beforeEach(async () => {
    kit = await createTestKit();
    fx = await setupAdversarial(kit);
  });
  afterEach(async () => {
    await kit.close();
  });

  const loadRoleRow = async (id: string) =>
    (await kit.db.select().from(adversarialRoles).where(eq(adversarialRoles.id, id)))[0]!;
  const jobsOfType = (type: string) => kit.db.select().from(jobs).where(eq(jobs.type, type));
  const inbox = (userId: string, type: string) =>
    kit.db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, userId))
      .then((rows) => rows.filter((n) => n.type === type));

  describe('abort and RED FLAG', () => {
    it('aborting a planned role never contacts the operative', async () => {
      const role = await planDefault(fx);
      await abortRole(kit.as(fx.planner), { roleId: role.id, reason: 'Scenario mismatch.' });
      expect((await loadRoleRow(role.id)).status).toBe('aborted');
      expect(await jobsOfType(ADVERSARIAL_ABORT_JOB)).toHaveLength(0);
      expect(await inbox(fx.operative.userId, 'adversarial.stop')).toHaveLength(0);
    });

    it('aborting an active role sends an immediate STOP; the reason is sanitized, never blocking', async () => {
      const role = await runToActive(fx);
      const aborted = await abortRole(kit.as(fx.planner), {
        roleId: role.id,
        reason: `Participant distressed, see https://outside-host.com ‮ ${'deadbeef'.repeat(5)}`,
      });
      expect(aborted.status).toBe('aborted');
      expect(aborted.abortReason).not.toContain('deadbeef'.repeat(5));
      expect(aborted.abortReason).not.toContain('‮');
      expect(aborted.stopNoticeDelivery).toBe('pending');
      const [abortJob] = await jobsOfType(ADVERSARIAL_ABORT_JOB);
      expect(abortJob!.payload).toEqual({ roleId: role.id });
      expect(abortJob!.maxAttempts).toBeGreaterThan(8);
      const [stop] = await inbox(fx.operative.userId, 'adversarial.stop');
      expect(stop!.severity).toBe('critical');
      expect(stop!.body).not.toContain('distressed');
    });

    it('cancels a pending briefing when aborted before delivery', async () => {
      const role = await planDefault(fx);
      await kit.db
        .update(adversarialRoles)
        .set({
          authorizedAt: kit.clock.now(),
          authorizedByUserId: fx.authorizer.userId,
          sandboxAttested: true,
        })
        .where(eq(adversarialRoles.id, role.id));
      await briefRole(kit.as(fx.planner), { roleId: role.id });
      await abortRole(kit.as(fx.planner), { roleId: role.id, reason: 'Pulled before start.' });
      const [brief] = await jobsOfType(ADVERSARIAL_BRIEF_JOB);
      expect(brief!.status).toBe('cancelled');
      await expect(
        loadBriefingDelivery(kit.system, { roleId: role.id, revision: 1 }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });

    it('the operative raises RED FLAG: immediate stop, staff alerted, idempotent', async () => {
      const role = await runToActive(fx);
      const first = await raiseRedFlag(kit.as(fx.operative), {
        roleId: role.id,
        note: 'A teammate seems genuinely upset.',
      });
      expect(first).toEqual({ roleId: role.id, status: 'aborted', alreadyStopped: false });
      const row = await loadRoleRow(role.id);
      expect(row.redFlagRaisedAt).not.toBeNull();
      expect(row.redFlagRaisedByUserId).toBe(fx.operative.userId);
      expect(row.abortReason).toContain('RED FLAG raised by the operative');
      for (const manager of [fx.founder, fx.planner, fx.authorizer])
        expect(await inbox(manager.userId, 'adversarial.alert')).toHaveLength(1);
      expect(await jobsOfType(ADVERSARIAL_ABORT_JOB)).toHaveLength(1);
      const again = await raiseRedFlag(kit.as(fx.operative), { roleId: role.id });
      expect(again.alreadyStopped).toBe(true);
    });

    it('BREAK: simultaneous RED FLAGs both succeed; exactly one stops the exercise', async () => {
      const role = await runToActive(fx);
      const results = await Promise.all([
        raiseRedFlag(kit.as(fx.operative), { roleId: role.id }),
        raiseRedFlag(kit.as(fx.planner), { roleId: role.id }),
      ]);
      expect(results.filter((r) => !r.alreadyStopped)).toHaveLength(1);
      expect(await jobsOfType(ADVERSARIAL_ABORT_JOB)).toHaveLength(1);
    });

    it('BREAK: a teammate cannot raise RED FLAG on the role and learns nothing', async () => {
      const role = await runToActive(fx);
      const mate = kit.as(fx.teammates[0]!);
      const onReal = await raiseRedFlag(mate, { roleId: role.id }).catch((e: unknown) => e);
      const onRandom = await raiseRedFlag(mate, { roleId: RANDOM_ROLE_ID }).catch(
        (e: unknown) => e,
      );
      expect(onReal).toBeInstanceOf(NotFoundError);
      expect(onRandom).toBeInstanceOf(NotFoundError);
      expect((onReal as Error).message).toBe((onRandom as Error).message);
      expect((await loadRoleRow(role.id)).status).toBe('active');
    });

    it('BREAK: an operative who was only planned (never briefed) cannot see or stop the role', async () => {
      const role = await planDefault(fx);
      await expect(raiseRedFlag(kit.as(fx.operative), { roleId: role.id })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('BREAK: revealed roles cannot be aborted', async () => {
      const role = await runToActive(fx);
      await concludeRole(kit.as(fx.planner), { roleId: role.id });
      await recordObservation(kit.as(fx.planner), {
        roleId: role.id,
        outcome: 'resisted',
        description: 'Refused to share the key.',
      });
      await evaluateRole(kit.as(fx.authorizer), {
        roleId: role.id,
        summary: 'Solid refusal under pressure.',
        debrief: 'The team refused the request and kept the key out of chat.',
      });
      await setTrialStatus(kit, fx.trialId, 'completed');
      await revealRole(kit.as(fx.planner), { roleId: role.id });
      await expect(
        abortRole(kit.as(fx.planner), { roleId: role.id, reason: 'Too late.' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });

    it('an exercise stopped mid-way is still evaluated and revealed (the team was exposed)', async () => {
      const role = await runToActive(fx);
      await raiseRedFlag(kit.as(fx.planner), { roleId: role.id });
      await recordObservation(kit.as(fx.authorizer), {
        roleId: role.id,
        outcome: 'detected',
        description: 'Flagged the request as suspicious.',
      });
      await evaluateRole(kit.as(fx.authorizer), {
        roleId: role.id,
        summary: 'Stopped early; detection before the stop.',
        debrief: 'The exercise was stopped early. You spotted the request as suspicious.',
      });
      await setTrialStatus(kit, fx.trialId, 'evaluating');
      const revealed = await revealRole(kit.as(fx.planner), { roleId: role.id });
      expect(revealed.status).toBe('revealed');
      expect(revealed.abortedAt).not.toBeNull();
    });
  });

  describe('defense in depth', () => {
    it('BREAK: unsafe text smuggled into the database is caught at authorization and briefing', async () => {
      const role = await planDefault(fx);
      const [smuggled] = await kit.db
        .insert(adversarialTriggers)
        .values({
          roleId: role.id,
          label: 'Ask',
          description: 'Ask for their real email password.',
        })
        .returning();
      await expect(
        authorizeRole(kit.as(fx.authorizer), { roleId: role.id, sandboxAttested: true }),
      ).rejects.toThrow('Safety check failed');
      await kit.db.delete(adversarialTriggers).where(eq(adversarialTriggers.id, smuggled!.id));
      await authorizeRole(kit.as(fx.authorizer), { roleId: role.id, sandboxAttested: true });
      await kit.db
        .update(adversarialRoles)
        .set({ guardrails: 'Be nice.' })
        .where(eq(adversarialRoles.id, role.id));
      await expect(briefRole(kit.as(fx.planner), { roleId: role.id })).rejects.toThrow(
        'standard prohibition',
      );
      expect((await loadRoleRow(role.id)).status).toBe('planned');
    });

    it('BREAK: aborting cancels every pending briefing revision', async () => {
      const role = await runToActive(fx);
      await addTrigger(kit.as(fx.founder), {
        roleId: role.id,
        label: 'Second ask',
        description: 'Ask once more, then stop.',
      });
      await abortRole(kit.as(fx.planner), { roleId: role.id, reason: 'Stop everything.' });
      const briefs = await jobsOfType(ADVERSARIAL_BRIEF_JOB);
      expect(briefs).toHaveLength(2);
      expect(briefs.every((job) => job.status === 'cancelled')).toBe(true);
    });

    it('BREAK: an observation cannot reference another role’s trigger (IDOR)', async () => {
      const role = await runToActive(fx);
      const other = await kit.member({ roles: ['verified'] });
      await kit.db.insert(trialParticipants).values({
        trialId: fx.trialId,
        memberId: memberIdOf(other),
        status: 'selected',
        teamId: fx.teamBId,
      });
      const roleB = await planRole(kit.as(fx.planner), {
        trialId: fx.trialId,
        teamId: fx.teamBId,
        operativeMemberId: memberIdOf(other),
        scenarioId: fx.scenarioId,
      });
      const foreign = await addTrigger(kit.as(fx.planner), {
        roleId: roleB.id,
        label: 'B ask',
        description: 'Ask team B for the key.',
      });
      await expect(
        recordObservation(kit.as(fx.planner), {
          roleId: role.id,
          outcome: 'failure',
          description: 'Linked to the wrong trigger.',
          triggerId: foreign.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('delivery callbacks', () => {
    it('STOP notice: fixed text, undeliverable raises a critical alert, idempotent', async () => {
      const role = await runToActive(fx);
      await abortRole(kit.as(fx.planner), { roleId: role.id, reason: 'Internal staff reason.' });
      const notice = await loadStopNotice(kit.system, { roleId: role.id });
      expect(notice.operativeDiscordId).toBe(fx.operative.discordId);
      expect(`${notice.title} ${notice.body}`).not.toContain('Internal staff reason');
      expect(
        await markStopNoticeDelivered(kit.system, { roleId: role.id, outcome: 'undeliverable' }),
      ).toEqual({ recorded: true });
      expect(await inbox(fx.founder.userId, 'adversarial.alert')).toHaveLength(1);
      await markStopNoticeDelivered(kit.system, { roleId: role.id, outcome: 'sent' });
      expect(
        await markStopNoticeDelivered(kit.system, { roleId: role.id, outcome: 'sent' }),
      ).toEqual({ recorded: false });
    });

    it('briefing: stale revisions are ignored; closed DMs notify the planner', async () => {
      const role = await runToActive(fx);
      const delivery = await loadBriefingDelivery(kit.system, { roleId: role.id, revision: 1 });
      expect(delivery.operativeDiscordId).toBe(fx.operative.discordId);
      expect(delivery.text).toContain('GUARDRAILS');
      expect(
        await markBriefingDelivered(kit.system, {
          roleId: role.id,
          revision: 1,
          outcome: 'undeliverable',
        }),
      ).toEqual({ recorded: true });
      const staffNotes = await inbox(fx.planner.userId, 'adversarial.staff');
      expect(staffNotes.map((n) => n.title)).toEqual(
        expect.arrayContaining([`BRIEFING NOT DELIVERED — TRIAL #${fx.trialNumber}`]),
      );
      await addTrigger(kit.as(fx.founder), {
        roleId: role.id,
        label: 'Follow-up',
        description: 'Ask once more, then stop.',
      });
      expect(
        await markBriefingDelivered(kit.system, { roleId: role.id, revision: 1, outcome: 'sent' }),
      ).toEqual({ recorded: false });
      expect(
        await markBriefingDelivered(kit.system, { roleId: role.id, revision: 2, outcome: 'sent' }),
      ).toEqual({ recorded: true });
    });

    it('BREAK: loaders and callbacks are for the bot worker only', async () => {
      const role = await runToActive(fx);
      const founder = kit.as(fx.founder);
      await expect(
        loadBriefingDelivery(founder, { roleId: role.id, revision: 1 }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        markBriefingDelivered(kit.as(fx.operative), {
          roleId: role.id,
          revision: 1,
          outcome: 'sent',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('triggers, observations and time', () => {
    it('BREAK: triggers fire once, only while active and before the deadline', async () => {
      const role = await planDefault(fx);
      const trigger = await addTrigger(kit.as(fx.planner), {
        roleId: role.id,
        label: 'Ask',
        description: 'Ask for the sandbox deploy key.',
      });
      await expect(
        fireTrigger(kit.as(fx.planner), { roleId: role.id, triggerId: trigger.id }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      await kit.db
        .update(adversarialRoles)
        .set({ status: 'active', briefedAt: kit.clock.now(), activatedAt: kit.clock.now() })
        .where(eq(adversarialRoles.id, role.id));
      await fireTrigger(kit.as(fx.planner), { roleId: role.id, triggerId: trigger.id });
      await expect(
        fireTrigger(kit.as(fx.operative), { roleId: role.id, triggerId: trigger.id }),
      ).rejects.toBeInstanceOf(ConflictError);
      const late = await addTrigger(kit.as(fx.founder), {
        roleId: role.id,
        label: 'Late ask',
        description: 'Ask again near the end.',
      });
      kit.clock.advance(5 * HOUR);
      await expect(
        fireTrigger(kit.as(fx.planner), { roleId: role.id, triggerId: late.id }),
      ).rejects.toThrow('no longer running');
    });

    it('BREAK: a trigger of another role cannot be fired through this role (IDOR)', async () => {
      const role = await runToActive(fx);
      const other = await kit.member({ roles: ['verified'] });
      await kit.db.insert(trialParticipants).values({
        trialId: fx.trialId,
        memberId: memberIdOf(other),
        status: 'selected',
        teamId: fx.teamBId,
      });
      const roleB = await planRole(kit.as(fx.planner), {
        trialId: fx.trialId,
        teamId: fx.teamBId,
        operativeMemberId: memberIdOf(other),
        scenarioId: fx.scenarioId,
      });
      const foreign = await addTrigger(kit.as(fx.planner), {
        roleId: roleB.id,
        label: 'B ask',
        description: 'Ask team B for the key.',
      });
      await expect(
        fireTrigger(kit.as(fx.operative), { roleId: role.id, triggerId: foreign.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('BREAK: trigger timing and content are validated', async () => {
      const role = await planDefault(fx);
      const base = { roleId: role.id, label: 'Ask', description: 'Ask for the sandbox key.' };
      await expect(
        addTrigger(kit.as(fx.planner), {
          ...base,
          plannedFor: new Date(kit.clock.now().getTime() - MINUTE),
        }),
      ).rejects.toThrow('future');
      await expect(
        addTrigger(kit.as(fx.planner), {
          ...base,
          plannedFor: new Date(kit.clock.now().getTime() + 5 * HOUR),
        }),
      ).rejects.toThrow('deadline');
      await expect(
        addTrigger(kit.as(fx.planner), {
          ...base,
          description: 'Ask them to log into their school account.',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        addTrigger(kit.as(fx.planner), { ...base, label: 'x'.repeat(5000) }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('BREAK: observation subjects must be teammates, never the operative or another team', async () => {
      const role = await runToActive(fx);
      const observe = (subjectMemberId: string) =>
        recordObservation(kit.as(fx.planner), {
          roleId: role.id,
          outcome: 'failure',
          description: 'Shared the sandbox key in chat.',
          subjectMemberId,
        });
      await expect(observe(memberIdOf(fx.otherTeamMember))).rejects.toBeInstanceOf(ValidationError);
      await expect(observe(memberIdOf(fx.operative))).rejects.toBeInstanceOf(ValidationError);
      await expect(observe(memberIdOf(fx.teammates[0]!))).resolves.toMatchObject({
        outcome: 'failure',
      });
    });

    it('BREAK: observation times must fall inside the exercise', async () => {
      const role = await runToActive(fx);
      const base = {
        roleId: role.id,
        outcome: 'resisted' as const,
        description: 'Refused the request.',
      };
      await expect(
        recordObservation(kit.as(fx.planner), {
          ...base,
          occurredAt: new Date(kit.clock.now().getTime() + MINUTE),
        }),
      ).rejects.toThrow('future');
      await expect(
        recordObservation(kit.as(fx.planner), {
          ...base,
          occurredAt: new Date(kit.clock.now().getTime() - HOUR),
        }),
      ).rejects.toThrow('before the exercise');
    });

    it('BREAK: observations need an exercise that ran', async () => {
      const role = await planDefault(fx);
      await expect(
        recordObservation(kit.as(fx.planner), {
          roleId: role.id,
          outcome: 'resisted',
          description: 'Refused it.',
        }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });
  });

  describe('evaluation', () => {
    async function concluded() {
      const role = await runToActive(fx);
      await concludeRole(kit.as(fx.planner), { roleId: role.id });
      return role;
    }

    it('without observations a score and justification are required', async () => {
      const role = await concluded();
      const base = { roleId: role.id, summary: 'Nothing observable happened.' };
      await expect(evaluateRole(kit.as(fx.authorizer), base)).rejects.toThrow('No observations');
      await expect(evaluateRole(kit.as(fx.authorizer), { ...base, score: 6 })).rejects.toThrow(
        'justify',
      );
      const result = await evaluateRole(kit.as(fx.authorizer), {
        ...base,
        score: 6,
        justification: 'Observed in voice; not logged as observations.',
      });
      expect(result.suggestedScore).toBeNull();
      expect(result.overridden).toBe(true);
    });

    it('overriding the suggested score requires a justification; re-evaluation replaces', async () => {
      const role = await concluded();
      for (const outcome of ['reported', 'reported'] as const)
        await recordObservation(kit.as(fx.planner), {
          roleId: role.id,
          outcome,
          description: 'Escalated to staff.',
        });
      const accepted = await evaluateRole(kit.as(fx.authorizer), {
        roleId: role.id,
        summary: 'Strong escalation culture.',
      });
      expect(accepted.evaluation.securityCultureScore).toBe(9);
      await expect(
        evaluateRole(kit.as(fx.authorizer), {
          roleId: role.id,
          score: 10,
          summary: 'Even better.',
        }),
      ).rejects.toThrow('differs from the suggested 9');
      const override = await evaluateRole(kit.as(fx.authorizer), {
        roleId: role.id,
        score: 10,
        justification: 'Escalated within one minute, textbook response.',
        summary: 'Even better.',
      });
      expect(override.evaluation.securityCultureScore).toBe(10);
      expect(override.evaluation.overrideJustification).toContain('textbook');
    });

    it('BREAK: out-of-range scores, huge input and unsafe debriefs are rejected', async () => {
      const role = await concluded();
      const base = {
        roleId: role.id,
        summary: 'Summary text here.',
        justification: 'Reasoned override text.',
      };
      await expect(
        evaluateRole(kit.as(fx.authorizer), { ...base, score: 11 }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        evaluateRole(kit.as(fx.authorizer), { ...base, score: -1 }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        evaluateRole(kit.as(fx.authorizer), { ...base, score: 5, summary: 'y'.repeat(100_000) }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        evaluateRole(kit.as(fx.authorizer), {
          ...base,
          score: 5,
          debrief: 'Read more at https://outside-host.com/post',
        }),
      ).rejects.toThrow('Safety check failed');
    });

    it('BREAK: a staff operative cannot evaluate or observe their own role', async () => {
      // A second trial in the same database whose operative holds CORE.
      const fx2 = await setupAdversarial(kit, { operativeRoles: ['core'] });
      const role = await runToActive(fx2);
      await expect(
        recordObservation(kit.as(fx2.operative), {
          roleId: role.id,
          outcome: 'failure',
          description: 'They all failed.',
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await concludeRole(kit.as(fx2.planner), { roleId: role.id });
      await expect(
        evaluateRole(kit.as(fx2.operative), {
          roleId: role.id,
          score: 0,
          justification: 'I won completely.',
          summary: 'Everyone failed.',
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      const evaluations = await kit.db.select().from(adversarialEvaluations);
      expect(evaluations.filter((e) => e.roleId === role.id)).toHaveLength(0);
    });

    it('reveal needs a debrief; the evaluation is locked afterwards', async () => {
      const role = await concluded();
      await setTrialStatus(kit, fx.trialId, 'completed');
      await evaluateRole(kit.as(fx.authorizer), {
        roleId: role.id,
        score: 7,
        justification: 'Good instincts, slow escalation.',
        summary: 'Resisted but did not report.',
      });
      await expect(revealRole(kit.as(fx.planner), { roleId: role.id })).rejects.toThrow('debrief');
      await evaluateRole(kit.as(fx.authorizer), {
        roleId: role.id,
        score: 7,
        justification: 'Good instincts, slow escalation.',
        summary: 'Resisted but did not report.',
        debrief: 'You resisted the request. Next time, also report it to staff right away.',
      });
      await revealRole(kit.as(fx.planner), { roleId: role.id });
      await expect(
        evaluateRole(kit.as(fx.authorizer), {
          roleId: role.id,
          score: 1,
          justification: 'Changed my mind.',
          summary: 'Rewrite history.',
        }),
      ).rejects.toThrow('locked');
      await expect(revealRole(kit.as(fx.planner), { roleId: role.id })).rejects.toThrow(
        'already revealed',
      );
    });
  });
});
